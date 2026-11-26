import math
import time
from prometheus_client import Counter, Histogram, make_asgi_app
import os
import hmac
from fastapi import Depends, FastAPI, Header, HTTPException, Request, Security
from fastapi.security import APIKeyHeader
from fastapi.responses import JSONResponse
from pathlib import Path
import sqlite3
import asyncio
import httpx
import docker
from docker.errors import DockerException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from datetime import datetime, timedelta, timezone

app = FastAPI(
    title="LogDock API",
    description="Local observability and incident response platform",
    version="0.2.0",
)

# =====================================
# APPLICATION PERFORMANCE METRICS
# =====================================

REQUEST_COUNT = Counter(
    "logdock_http_requests",
    "Total number of HTTP API requests",
    ["method", "path", "status"],
)

REQUEST_LATENCY = Histogram(
    "logdock_http_request_duration_seconds",
    "HTTP API request duration in seconds",
    ["method", "path"],
)

# Expose metrics for Prometheus scraping.
app.mount("/metrics", make_asgi_app())

# =====================================
# API AUTHENTICATION
# =====================================

API_TOKEN = os.getenv("LOGDOCK_API_TOKEN")

api_key_header = APIKeyHeader(
    name="X-API-Token",
    auto_error=False,
)

def require_api_token(
    x_api_token: str | None = Security(api_key_header),
):
    if not API_TOKEN or not hmac.compare_digest(
        x_api_token or "",
        API_TOKEN,
    ):
        raise HTTPException(
            status_code=401,
            detail="Unauthorized",
        )

@app.get("/api/auth/verify")
def verify_api_token(
    _: None = Depends(require_api_token),
):
    return {
        "authenticated": True,
    }

# =====================================
# GLOBAL API AUTHENTICATION
# =====================================

@app.middleware("http")
async def protect_api_routes(request: Request, call_next):
    path = request.url.path

    # Leave CORS preflight requests to the CORS middleware.
    if request.method == "OPTIONS":
        return await call_next(request)

    # The verification endpoint performs its own token check.
    if path == "/api/auth/verify":
        return await call_next(request)

    # Require authentication for every other API route.
    if path.startswith("/api/"):
        provided_token = request.headers.get("x-api-token", "")

        if not API_TOKEN or not hmac.compare_digest(
            provided_token,
            API_TOKEN,
        ):
            return JSONResponse(
                status_code=401,
                content={"detail": "Unauthorized"},
            )

    return await call_next(request)

# =====================================
# APPLICATION REQUEST TRACKING
# =====================================

@app.middleware("http")
async def track_application_metrics(request: Request, call_next):
    path = request.url.path

    # Track API requests only.
    # Exclude preflight requests and the metrics history endpoint.
    if (
        not path.startswith("/api/")
        or path == "/api/metrics/application/history"
        or request.method == "OPTIONS"
    ):
        return await call_next(request)

    start_time = time.perf_counter()

    response = await call_next(request)

    duration = time.perf_counter() - start_time

    route = request.scope.get("route")
    route_path = getattr(route, "path", path)

    REQUEST_COUNT.labels(
        request.method,
        route_path,
        str(response.status_code),
    ).inc()

    REQUEST_LATENCY.labels(
        request.method,
        route_path,
    ).observe(duration)

    return response

# =====================================
# CORS CONFIGURATION
# =====================================

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5300",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.post("/api/system/backup")
def create_database_backup(
    _: None = Depends(require_api_token),
):
    if not DATABASE_PATH.exists():
        raise HTTPException(
            status_code=404,
            detail="LogDock database does not exist.",
        )

    timestamp = datetime.now(timezone.utc).strftime(
        "%Y%m%d_%H%M%S"
    )

    backup_path = BACKUP_DIR / f"logdock_{timestamp}.db"

    source = None
    destination = None

    try:
        source = sqlite3.connect(DATABASE_PATH)
        destination = sqlite3.connect(backup_path)

        source.backup(destination)

        destination.close()
        destination = None

        source.close()
        source = None

        # Retain only the 10 newest backups
        backup_files = sorted(
            BACKUP_DIR.glob("logdock_*.db"),
            key=lambda path: path.name,
            reverse=True,
        )

        deleted_backups = []

        for old_backup in backup_files[BACKUP_RETENTION_LIMIT:]:
            try:
                old_backup.unlink()
                deleted_backups.append(old_backup.name)
            except OSError:
                continue

        return {
            "status": "success",
            "filename": backup_path.name,
            "size_bytes": backup_path.stat().st_size,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "retention_limit": BACKUP_RETENTION_LIMIT,
            "deleted_old_backups": deleted_backups,
        }

    except sqlite3.Error as error:
        if backup_path.exists():
            backup_path.unlink()

        raise HTTPException(
            status_code=500,
            detail=f"Database backup failed: {error}",
        )

    finally:
        if destination is not None:
            destination.close()

        if source is not None:
            source.close()


@app.get("/api/system/backups")
def list_database_backups(
    _: None = Depends(require_api_token),
):
    backups = []

    for backup_path in sorted(
        BACKUP_DIR.glob("logdock_*.db"),
        reverse=True,
    ):
        connection = None

        try:
            connection = sqlite3.connect(
                f"file:{backup_path}?mode=ro",
                uri=True,
            )

            integrity = connection.execute(
                "PRAGMA integrity_check"
            ).fetchone()[0]

            backups.append({
                "filename": backup_path.name,
                "size_bytes": backup_path.stat().st_size,
                "integrity": integrity,
            })

        except sqlite3.Error as error:
            backups.append({
                "filename": backup_path.name,
                "size_bytes": backup_path.stat().st_size,
                "integrity": f"error: {error}",
            })

        finally:
            if connection is not None:
                connection.close()

    return {
        "count": len(backups),
        "data": backups,
    }


# DOCKER CONTAINER MONITORING
@app.get("/api/services/containers")
def get_docker_containers():
    if docker_client is None:
        raise HTTPException(
            status_code=503,
            detail="Docker connection is unavailable.",
        )

    try:
        containers = docker_client.containers.list(all=True)

        container_data = []

        for container in containers:
            container.reload()

            state = container.attrs.get("State", {})
            labels = container.attrs.get("Config", {}).get("Labels", {}) or {}

            container_data.append({
                "id": container.short_id,
                "name": container.name,
                "service": labels.get(
                    "com.docker.compose.service",
                    container.name,
                ),
                "status": container.status.upper(),
                "health": state.get("Health", {}).get(
                    "Status",
                    "not_configured",
                ),
                "restart_count": container.attrs.get("RestartCount", 0),
                "created": container.attrs.get("Created"),
                "started_at": state.get("StartedAt"),
            })
        return {
            "count": len(container_data),
            "data": container_data,
        }

    except DockerException as error:
        raise HTTPException(
            status_code=503,
            detail=f"Unable to retrieve Docker containers: {error}",
        )

# =====================================
# FAILURE LAB CONTROLS
# =====================================

def get_failure_lab_container(service_name: str):
    if service_name not in FAILURE_LAB_ALLOWED_SERVICES:
        raise HTTPException(
            status_code=400,
            detail="This service is not allowed in Failure Lab.",
        )

    if docker_client is None:
        raise HTTPException(
            status_code=503,
            detail="Docker connection is unavailable.",
        )

    try:
        containers = docker_client.containers.list(
            all=True,
            filters={
                "label": [
                    "com.docker.compose.project=logdock",
                    f"com.docker.compose.service={service_name}",
                ]
            },
        )

        if not containers:
            raise HTTPException(
                status_code=404,
                detail="The requested LogDock container was not found.",
            )

        return containers[0]

    except DockerException as error:
        raise HTTPException(
            status_code=503,
            detail=f"Unable to access Docker: {error}",
        )

@app.post("/api/failure-lab/{service_name}/stop")
def failure_lab_stop(
    service_name: str,
    _: None = Depends(require_api_token),
):
    container = get_failure_lab_container(service_name)

    try:
        container.stop(timeout=10)

        return {
            "service": service_name,
            "container": container.name,
            "action": "stop",
            "status": "stopped",
        }

    except DockerException as error:
        raise HTTPException(
            status_code=503,
            detail=f"Unable to stop container: {error}",
        )


@app.post("/api/failure-lab/{service_name}/start")
def failure_lab_start(
    service_name: str,
    _: None = Depends(require_api_token),
):
    container = get_failure_lab_container(service_name)

    try:
        container.start()

        return {
            "service": service_name,
            "container": container.name,
            "action": "start",
            "status": "started",
        }

    except DockerException as error:
        raise HTTPException(
            status_code=503,
            detail=f"Unable to start container: {error}",
        )

# =====================================
# DATABASE CONFIGURATION
# =====================================

DATA_DIR = Path("/app/data")
DATA_DIR.mkdir(parents=True, exist_ok=True)

DATABASE_PATH = DATA_DIR / "logdock.db"

BACKUP_DIR = DATA_DIR / "backups"
BACKUP_RETENTION_LIMIT = 10
BACKUP_DIR.mkdir(parents=True, exist_ok=True)

PROMETHEUS_URL = "http://prometheus:9090"
LOKI_URL = "http://loki:3100"

def require_api_token(x_api_token: str | None = Header(default=None)):
    if not API_TOKEN or x_api_token != API_TOKEN:
        raise HTTPException(status_code=401, detail="Unauthorized")

# =====================================
# FAILURE LAB CONFIGURATION
# =====================================

FAILURE_LAB_ALLOWED_SERVICES = {
    "prometheus",
    "loki",
    "alloy",
}

# DOCKER CLIENT
try:
    docker_client = docker.DockerClient(
        base_url="http://socket-proxy:2375",
        timeout=10,
    )
except Exception:
    docker_client = None

def get_connection():
    connection = sqlite3.connect(DATABASE_PATH)
    connection.row_factory = sqlite3.Row
    return connection


def initialize_database():
    with get_connection() as connection:
        connection.execute("""
            CREATE TABLE IF NOT EXISTS incidents (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                service TEXT NOT NULL,
                severity TEXT NOT NULL,
                status TEXT NOT NULL,
                time TEXT NOT NULL,
                description TEXT NOT NULL,
                assignee TEXT NOT NULL
            )
        """)

        connection.execute("""
            CREATE TABLE IF NOT EXISTS docker_incident_state (
                container_id TEXT PRIMARY KEY,
                incident_id TEXT,
                is_active INTEGER NOT NULL DEFAULT 0,
                last_status TEXT NOT NULL
            )
        """)

        existing = connection.execute(
            "SELECT COUNT(*) FROM incidents"
        ).fetchone()[0]

        if existing == 0:
            initial_incidents = [
                (
                    "INC-024",
                    "Database connection pool exhausted",
                    "database",
                    "CRITICAL",
                    "OPEN",
                    "11:46",
                    "The database connection pool reached its maximum capacity. New connections are being rejected, potentially affecting dependent services.",
                    "Unassigned",
                ),
                (
                    "INC-023",
                    "Elevated API gateway latency",
                    "api-gateway",
                    "HIGH",
                    "ACKNOWLEDGED",
                    "11:32",
                    "Upstream requests are experiencing increased response times and intermittent timeouts.",
                    "Operations",
                ),
                (
                    "INC-022",
                    "Payment provider connection failures",
                    "payment-service",
                    "HIGH",
                    "OPEN",
                    "10:58",
                    "The payment service is unable to establish stable connections with its external provider.",
                    "Unassigned",
                ),
                (
                    "INC-021",
                    "Background worker execution delays",
                    "worker",
                    "MEDIUM",
                    "RESOLVED",
                    "09:45",
                    "Background jobs exceeded their expected execution time. Worker capacity was restored.",
                    "Operations",
                ),
            ]

            connection.executemany("""
                INSERT INTO incidents
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """, initial_incidents)


initialize_database()


# =====================================
# REQUEST MODELS
# =====================================

class IncidentCreate(BaseModel):
    title: str
    service: str
    severity: str
    description: str
    assignee: str = "Unassigned"


# =====================================
# HELPER
# =====================================

def get_incident_or_404(connection, incident_id):
    incident = connection.execute(
        "SELECT * FROM incidents WHERE id = ?",
        (incident_id,),
    ).fetchone()

    if incident is None:
        raise HTTPException(
            status_code=404,
            detail="Incident not found",
        )

    return incident


# =====================================
# GENERAL ENDPOINTS
# =====================================

@app.get("/")
def root():
    return {
        "name": "LogDock",
        "message": "Observability platform API is running.",
    }


@app.get("/health")
def health_check():
    return {
        "status": "healthy",
        "service": "logdock-api",
    }

@app.get("/api/metrics/prometheus")
async def prometheus_health():
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.get(
                f"{PROMETHEUS_URL}/api/v1/query",
                params={"query": "up"},
            )

        response.raise_for_status()

        return {
            "status": "healthy",
            "source": "prometheus",
            "data": response.json(),
        }

    except httpx.HTTPError as error:
        raise HTTPException(
            status_code=502,
            detail=f"Prometheus unavailable: {error}",
        )

@app.get("/api/metrics/cpu")
async def cpu_metrics():
    query = "win_cpu_Percent_Processor_Time"

    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.get(
                f"{PROMETHEUS_URL}/api/v1/query",
                params={"query": query},
            )

        response.raise_for_status()

        prometheus_data = response.json()

        return {
            "metric": "cpu_usage_percent",
            "unit": "percent",
            "data": prometheus_data["data"]["result"],
        }

    except httpx.HTTPError as error:
        raise HTTPException(
            status_code=502,
            detail=f"Prometheus unavailable: {error}",
        )

@app.get("/api/metrics/cpu/history")
async def cpu_metrics_history():
    end_time = datetime.now(timezone.utc)
    start_time = end_time - timedelta(hours=1)

    query = "win_cpu_Percent_Processor_Time"

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(
                f"{PROMETHEUS_URL}/api/v1/query_range",
                params={
                    "query": query,
                    "start": start_time.timestamp(),
                    "end": end_time.timestamp(),
                    "step": "15s",
                },
            )

        response.raise_for_status()

        prometheus_data = response.json()

        return {
            "metric": "cpu_usage_percent",
            "unit": "percent",
            "data": prometheus_data["data"]["result"],
        }

    except httpx.HTTPError as error:
        raise HTTPException(
            status_code=502,
            detail=f"Prometheus unavailable: {error}",
        )

@app.get("/api/metrics/application/history")
async def application_metrics_history():
    end_time = datetime.now(timezone.utc)
    start_time = end_time - timedelta(hours=3)

    requests_query = (
        'sum(rate(logdock_http_requests_total[1m])) * 60'
    )

    latency_query = (
        'sum(rate(logdock_http_request_duration_seconds_sum[1m])) '
        '/ '
        'sum(rate(logdock_http_request_duration_seconds_count[1m])) '
        '* 1000'
    )

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            requests_response, latency_response = await asyncio.gather(
                client.get(
                    f"{PROMETHEUS_URL}/api/v1/query_range",
                    params={
                        "query": requests_query,
                        "start": start_time.timestamp(),
                        "end": end_time.timestamp(),
                        "step": "15s",
                    },
                ),
                client.get(
                    f"{PROMETHEUS_URL}/api/v1/query_range",
                    params={
                        "query": latency_query,
                        "start": start_time.timestamp(),
                        "end": end_time.timestamp(),
                        "step": "15s",
                    },
                ),
            )

        requests_response.raise_for_status()
        latency_response.raise_for_status()

        requests_result = requests_response.json()["data"]["result"]
        latency_result = latency_response.json()["data"]["result"]

        points = {}

        for result in requests_result:
            for timestamp, value in result.get("values", []):
                timestamp = float(timestamp)
                request_value = float(value)

                if not math.isfinite(request_value):
                    request_value = 0.0

                points.setdefault(timestamp, {
                    "requests": 0,
                    "latency": 0,
                })

                points[timestamp]["requests"] = request_value

        for result in latency_result:
            for timestamp, value in result.get("values", []):
                timestamp = float(timestamp)
                latency_value = float(value)

                if not math.isfinite(latency_value):
                    latency_value = 0.0

                points.setdefault(timestamp, {
                    "requests": 0,
                    "latency": 0,
                })

                points[timestamp]["latency"] = latency_value

        data = [
            {
                "timestamp": timestamp,
                "requests": round(values["requests"], 2),
                "latency": round(values["latency"], 2),
            }
            for timestamp, values in sorted(points.items())
        ]

        return {
            "metric": "application_performance",
            "period": "3h",
            "data": data,
        }

    except httpx.HTTPError as error:
        raise HTTPException(
            status_code=502,
            detail=f"Prometheus unavailable: {error}",
        )

@app.get("/api/metrics/memory")
async def memory_metrics():
    queries = {
        "available_bytes": "win_memory_Available_Bytes",
        "committed_bytes": "win_memory_Committed_Bytes",
        "committed_percent": "win_memory_Percent_Committed_Bytes_In_Use",
    }

    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            results = {}

            for name, query in queries.items():
                response = await client.get(
                    f"{PROMETHEUS_URL}/api/v1/query",
                    params={"query": query},
                )

                response.raise_for_status()

                results[name] = response.json()["data"]["result"]

        return {
            "metric": "memory",
            "unit": "bytes_and_percent",
            "data": results,
        }

    except httpx.HTTPError as error:
        raise HTTPException(
            status_code=502,
            detail=f"Prometheus unavailable: {error}",
        )


@app.get("/api/metrics/memory/history")
async def memory_metrics_history():
    end_time = datetime.now(timezone.utc)
    start_time = end_time - timedelta(hours=1)

    query = "win_memory_Percent_Committed_Bytes_In_Use"

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(
                f"{PROMETHEUS_URL}/api/v1/query_range",
                params={
                    "query": query,
                    "start": start_time.timestamp(),
                    "end": end_time.timestamp(),
                    "step": "15s",
                },
            )

        response.raise_for_status()

        prometheus_data = response.json()

        return {
            "metric": "memory_usage_percent",
            "unit": "percent",
            "data": prometheus_data["data"]["result"],
        }

    except httpx.HTTPError as error:
        raise HTTPException(
            status_code=502,
            detail=f"Prometheus unavailable: {error}",
        )

@app.get("/api/metrics/disk")
async def disk_metrics():
    queries = {
        "free_space_percent": "win_disk_Percent_Free_Space",
        "free_megabytes": "win_disk_Free_Megabytes",
    }

    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            results = {}

            for name, query in queries.items():
                response = await client.get(
                    f"{PROMETHEUS_URL}/api/v1/query",
                    params={"query": query},
                )

                response.raise_for_status()

                results[name] = response.json()["data"]["result"]

        return {
            "metric": "disk",
            "unit": "percent_and_megabytes",
            "data": results,
        }

    except httpx.HTTPError as error:
        raise HTTPException(
            status_code=502,
            detail=f"Prometheus unavailable: {error}",
        )

@app.get("/api/metrics/network")
async def network_metrics():
    queries = {
        "bytes_received_per_second": "win_network_Bytes_Received_persec",
        "bytes_sent_per_second": "win_network_Bytes_Sent_persec",
    }

    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            results = {}

            for name, query in queries.items():
                response = await client.get(
                    f"{PROMETHEUS_URL}/api/v1/query",
                    params={"query": query},
                )

                response.raise_for_status()

                results[name] = response.json()["data"]["result"]

        return {
            "metric": "network",
            "unit": "bytes_per_second",
            "data": results,
        }

    except httpx.HTTPError as error:
        raise HTTPException(
            status_code=502,
            detail=f"Prometheus unavailable: {error}",
        )

@app.get("/api/database/health")
def database_health():
    with get_connection() as connection:
        connection.execute("SELECT 1")

    return {
        "status": "healthy",
        "database": "sqlite",
    }

# =====================================
# AUTOMATIC DOCKER INCIDENT MONITORING
# =====================================

async def docker_monitor_loop():
    while True:
        try:
            if docker_client is not None:
                containers = docker_client.containers.list(all=True)

                for container in containers:
                    container.reload()

                    labels = (
                        container.attrs.get("Config", {}).get("Labels", {})
                        or {}
                    )

                    # Monitor only LogDock Compose containers
                    if labels.get("com.docker.compose.project") != "logdock":
                        continue

                    state = container.attrs.get("State", {})
                    container_status = container.status.lower()
                    health = state.get("Health", {}).get(
                        "Status",
                        "not_configured",
                    )

                    failure_type = None

                    if health == "unhealthy":
                        failure_type = "unhealthy"
                    elif container_status in ("exited", "dead"):
                        failure_type = "stopped"

                    container_id = container.id
                    container_name = container.name
                    service_name = labels.get(
                        "com.docker.compose.service",
                        container_name,
                    )

                    with get_connection() as connection:
                        tracked = connection.execute(
                            """
                            SELECT incident_id, is_active
                            FROM docker_incident_state
                            WHERE container_id = ?
                            """,
                            (container_id,),
                        ).fetchone()

                        if failure_type:
                            if tracked and tracked["is_active"]:
                                connection.execute(
                                    """
                                    UPDATE docker_incident_state
                                    SET last_status = ?
                                    WHERE container_id = ?
                                    """,
                                    (container_status, container_id),
                                )
                                continue

                            latest = connection.execute(
                                """
                                SELECT id FROM incidents
                                ORDER BY id DESC LIMIT 1
                                """
                            ).fetchone()

                            next_number = (
                                int(latest["id"].split("-")[1]) + 1
                                if latest else 1
                            )

                            incident_id = f"INC-{next_number:03d}"

                            if failure_type == "unhealthy":
                                title = f"Container unhealthy: {service_name}"
                                severity = "CRITICAL"
                                description = (
                                    f"Docker reports that container "
                                    f"{container_name} is unhealthy. "
                                    f"Container health: {health}."
                                )
                            else:
                                title = f"Container stopped: {service_name}"
                                severity = "HIGH"
                                description = (
                                    f"Docker reports that container "
                                    f"{container_name} has stopped. "
                                    f"Container status: {container_status}."
                                )

                            connection.execute(
                                """
                                INSERT INTO incidents (
                                    id, title, service, severity,
                                    status, time, description, assignee
                                )
                                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                                """,
                                (
                                    incident_id,
                                    title,
                                    service_name,
                                    severity,
                                    "OPEN",
                                    datetime.now(timezone.utc).strftime("%H:%M"),
                                    description,
                                    "Unassigned",
                                ),
                            )

                            connection.execute(
                                """
                                INSERT OR REPLACE INTO docker_incident_state (
                                    container_id,
                                    incident_id,
                                    is_active,
                                    last_status
                                )
                                VALUES (?, ?, 1, ?)
                                """,
                                (
                                    container_id,
                                    incident_id,
                                    container_status,
                                ),
                            )

                        elif tracked and tracked["is_active"]:
                            incident_id = tracked["incident_id"]

                            # Automatically resolve after recovery
                            connection.execute(
                                """
                                UPDATE incidents
                                SET status = 'RESOLVED'
                                WHERE id = ? AND status != 'RESOLVED'
                                """,
                                (incident_id,),
                            )

                            connection.execute(
                                """
                                UPDATE docker_incident_state
                                SET is_active = 0,
                                    last_status = ?
                                WHERE container_id = ?
                                """,
                                (container_status, container_id),
                            )

        except DockerException as error:
            print(f"Docker monitoring error: {error}")

        except Exception as error:
            print(f"Automatic incident monitoring error: {error}")

        await asyncio.sleep(10)


# Start background monitoring with FastAPI
docker_monitor_task = None


@app.on_event("startup")
async def start_docker_monitor():
    global docker_monitor_task

    docker_monitor_task = asyncio.create_task(
        docker_monitor_loop()
    )


@app.on_event("shutdown")
async def stop_docker_monitor():
    global docker_monitor_task

    if docker_monitor_task is not None:
        docker_monitor_task.cancel()

        try:
            await docker_monitor_task
        except asyncio.CancelledError:
            pass

        docker_monitor_task = None

# =====================================
# INCIDENT ENDPOINTS
# =====================================

@app.get("/api/incidents")
def list_incidents():
    with get_connection() as connection:
        incidents = connection.execute(
            "SELECT * FROM incidents ORDER BY id DESC"
        ).fetchall()

    return [dict(incident) for incident in incidents]

@app.post("/api/incidents", status_code=201)
def create_incident(payload: IncidentCreate):
    with get_connection() as connection:
        latest = connection.execute(
            "SELECT id FROM incidents ORDER BY id DESC LIMIT 1"
        ).fetchone()

        next_number = (
            int(latest["id"].split("-")[1]) + 1
            if latest else 1
        )

        incident_id = f"INC-{next_number:03d}"

        connection.execute("""
            INSERT INTO incidents (
                id, title, service, severity,
                status, time, description, assignee
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            incident_id,
            payload.title,
            payload.service,
            payload.severity,
            "OPEN",
            "Just now",
            payload.description,
            payload.assignee,
        ))

        incident = get_incident_or_404(
            connection,
            incident_id,
        )

    return dict(incident)


@app.patch("/api/incidents/{incident_id}/acknowledge")
def acknowledge_incident(incident_id: str):
    with get_connection() as connection:
        get_incident_or_404(connection, incident_id)

        connection.execute("""
            UPDATE incidents
            SET status = 'ACKNOWLEDGED'
            WHERE id = ?
        """, (incident_id,))

        incident = get_incident_or_404(
            connection,
            incident_id,
        )

    return dict(incident)


@app.patch("/api/incidents/{incident_id}/resolve")
def resolve_incident(incident_id: str):
    with get_connection() as connection:
        get_incident_or_404(connection, incident_id)

        connection.execute("""
            UPDATE incidents
            SET status = 'RESOLVED'
            WHERE id = ?
        """, (incident_id,))

        incident = get_incident_or_404(
            connection,
            incident_id,
        )

    return dict(incident)

@app.get("/api/logs")
async def get_logs(
    limit: int = 100,
    since: str = "1h",
    _: None = Depends(require_api_token),
):
    query = '{service_name=~".+"}'

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.get(
                f"{LOKI_URL}/loki/api/v1/query_range",
                params={
                    "query": query,
                    "limit": limit,
                    "since": since,
                    "direction": "backward",
                },
            )

        response.raise_for_status()
        loki_data = response.json()

        logs = []

        for stream in loki_data["data"]["result"]:
            labels = stream.get("stream", {})

            for timestamp, message in stream.get("values", []):
                lower_message = message.lower()

                if "critical" in lower_message:
                    level = "CRITICAL"
                elif "error" in lower_message or "exception" in lower_message:
                    level = "ERROR"
                elif "warning" in lower_message or "warn" in lower_message:
                    level = "WARNING"
                else:
                    level = "INFO"

                logs.append({
                    "id": str(timestamp),
                    "time": datetime.fromtimestamp(
                        int(timestamp) / 1_000_000_000,
                        tz=timezone.utc,
                    ).isoformat(),
                    "level": level,
                    "service": labels.get("service_name", "unknown_service"),
                    "container": labels.get("container", "unknown_container"),
                    "message": message,
                    "traceId": labels.get("trace_id", "—"),
                })

        return {
            "count": len(logs),
            "data": logs,
        }

    except httpx.HTTPError as error:
        raise HTTPException(
            status_code=502,
            detail=f"Loki unavailable: {error}",
        )

    except (KeyError, ValueError, TypeError) as error:
        raise HTTPException(
            status_code=502,
            detail=f"Invalid response received from Loki: {error}",
        )
