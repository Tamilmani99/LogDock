# LogDock

**A Local-First Observability & Incident Response Platform**

LogDock is a self-hosted observability dashboard built to monitor running infrastructure, explore application logs, track resource utilization, and manage incidents from a unified interface.

It combines Docker container monitoring, real Windows host metrics, centralized logging, application performance measurements, and incident automation in one dashboard.

---
## Screenshots

### Overview



### Metrics



### Failure Lab


## Features

### Infrastructure Overview
- Live infrastructure health overview.
- Monitored service and container status.
- Container uptime and restart information.
- Dynamic system status and refresh indicators.
- Application response-time measurements.

### Services Monitoring
- Discover Docker containers automatically.
- Monitor container status and health.
- View restart counts and container information.
- Automatically refresh service information.

### Metrics & Performance
- Real Windows host CPU utilization.
- Memory utilization and availability.
- Disk space and free-space monitoring.
- Network traffic measurements.
- Application request rate and response latency.
- Historical metrics visualized through charts.

### Logs Explorer
- Centralized Docker container logs.
- Live log collection through Grafana Alloy.
- Log storage and querying through Loki.
- Service-based log identification and filtering.

### Incident Management
- Automatic incident detection for unhealthy or stopped containers.
- Incident creation and lifecycle tracking.
- Automatic incident resolution after service recovery.
- Incident severity and status information.
- Persistent incident storage using SQLite.

### Failure Lab
- Controlled failure simulation for selected infrastructure services.
- Stop and restart supported services from the dashboard.
- Observe service status changes.
- Verify incident detection and automatic recovery.

### Security & Reliability
- API token authentication.
- Protected API endpoints.
- Restricted local service port exposure.
- Docker socket access through a dedicated socket proxy.
- Persistent application and Loki storage.
- Container health checks and restart policies.

### Responsive Dashboard
- Desktop, tablet, and mobile layouts.
- Responsive navigation and dashboard sections.
- Compact monitoring views for smaller screens.

---

## Technology Stack

| Component | Technology |
|---|---|
| Frontend | React, TypeScript, Vite |
| Styling | CSS |
| Charts | Recharts |
| Icons | Lucide React |
| Backend | Python, FastAPI |
| Database | SQLite |
| Containerization | Docker, Docker Compose |
| Infrastructure Metrics | Prometheus |
| Windows Metrics Collection | Telegraf |
| Log Collection | Grafana Alloy |
| Log Storage | Grafana Loki |
| Docker API Access | Docker Socket Proxy |

---

## Architecture

```text
                    LOGDOCK DASHBOARD
                  React + TypeScript
                          |
                          v
                    FastAPI Backend
                     Port 8001
                          |
          +---------------+----------------+
          |               |                |
          v               v                v
      Prometheus         Loki            SQLite
      Port 9090        Port 3100       Persistent Data
          ^               ^
          |               |
     Windows Host      Grafana Alloy
       Telegraf             |
      Port 9400             |
          |                 |
          v                 v
     Host Metrics      Docker Containers
                           |
                           v
                    Docker Socket Proxy
```

The backend queries Prometheus for infrastructure and application metrics, retrieves logs from Loki, accesses Docker through the socket proxy, and stores incident and application data in SQLite.

---

## Project Structure

```text
LogDock/
|
|-- backend/
|   |-- app/
|   |   |-- main.py
|   |-- Dockerfile
|   |-- requirements.txt
|
|-- frontend/
|   |-- public/
|   |-- src/
|   |   |-- assets/
|   |   |-- App.tsx
|   |   |-- App.css
|   |   |-- index.css
|   |   |-- main.tsx
|   |-- package.json
|
|-- monitoring/
|   |-- alloy-config.alloy
|   |-- loki-config.yml
|   |-- prometheus.yml
|
|-- compose.yaml
|-- .env.example
|-- .gitignore
|-- README.md
```

---

## Requirements

- Windows 11 or a compatible operating system.
- Docker Desktop with Docker Compose.
- Node.js and npm.
- Git (optional, for repository management).
- Telegraf on Windows for real host metrics.

---

## Installation & Setup

### 1. Clone the repository

```bash
git clone YOUR_REPOSITORY_URL
cd LogDock
```

Replace `YOUR_REPOSITORY_URL` with the actual GitHub repository URL.

### 2. Configure the API token

Create a local environment file from the example:

**Windows PowerShell:**

```powershell
Copy-Item .env.example .env
```

Open `.env` and replace the placeholder with a strong, private token:

```env
LOGDOCK_API_TOKEN=your-private-token
```

Never commit your `.env` file or share your actual token.

### 3. Start the infrastructure

From the project root:

```bash
docker compose up -d --build
```

Check container status:

```bash
docker compose ps
```

View logs:

```bash
docker compose logs -f
```

### 4. Start the frontend

Open another terminal:

```powershell
cd frontend
npm install
npm run dev
```

Open the Vite development URL shown in your terminal, normally:

```text
http://localhost:5173
```

### 5. Connect to LogDock

Enter the same API token configured in `.env` into the dashboard's API authorization field.

Once authenticated, the dashboard can access the protected backend APIs.

---

## Windows Host Metrics with Telegraf

LogDock uses Telegraf to collect real Windows host metrics and expose them in Prometheus format.

Install Telegraf on the Windows host and configure its Prometheus output.

Example configuration:

```toml
[[outputs.prometheus_client]]
  listen = "0.0.0.0:9400"
  path = "/metrics"
  expiration_interval = "30s"
```

The Prometheus configuration scrapes:

```yaml
- job_name: "logdock-windows"
  static_configs:
    - targets: ["host.docker.internal:9400"]
```

The backend also exposes application metrics, which Prometheus collects through its backend scrape target.

For security, restrict Telegraf's inbound access using Windows Firewall rules. Do not expose its metrics endpoint publicly.

---

## API Authentication

LogDock protects its API endpoints using an API token.

The frontend sends the token through the following HTTP header:

```http
X-API-Token: your-private-token
```

The token is configured using the `LOGDOCK_API_TOKEN` environment variable.

The authentication verification endpoint is:

```text
GET /api/auth/verify
```

The backend's Prometheus metrics endpoint is:

```text
/metrics
```

---

## Useful Docker Commands

Check running services:

```bash
docker compose ps
```

Follow all service logs:

```bash
docker compose logs -f
```

Follow backend logs:

```bash
docker compose logs -f backend
```

Restart the infrastructure:

```bash
docker compose restart
```

Stop the infrastructure:

```bash
docker compose down
```

Rebuild and restart:

```bash
docker compose up -d --build
```

**Note:** `docker compose down` does not remove named volumes by default. Avoid `docker compose down -v` unless you intentionally want to delete persistent data.

---

## Security Notes

- Keep `.env` private.
- Use a strong API token.
- Never commit credentials, database files, or private configuration.
- Keep Docker Desktop and dependencies updated.
- Keep Docker management endpoints restricted.
- Do not expose internal monitoring services directly to untrusted networks.
- Review firewall rules before changing network exposure.

LogDock is designed for local-first use. Additional hardening is necessary before deploying it to a publicly accessible or production environment.

---

## Current Project Status

LogDock currently includes working infrastructure monitoring, host metrics, application performance monitoring, centralized logs, incident management, and controlled failure simulation.

The project is actively developed, with future enhancements possible for distributed tracing, advanced alerting, and additional observability capabilities.

---

## License

Choose and add a license before distributing or accepting external contributions.

---

**Built with React, FastAPI, Docker, Prometheus, Grafana Alloy, and Loki.**