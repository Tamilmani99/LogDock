import { useMemo, useState, useRef, useEffect } from "react";
import {
  Activity,
  AlertTriangle,
  FlaskConical,
  Bell,
  Boxes,
  ChevronDown,
  CircleHelp,
  Clock3,
  Gauge,
  LayoutDashboard,
  Search,
  Server,
  Settings,
  ShieldCheck,
  Terminal,
  Zap,
} from "lucide-react";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import "./App.css";

const API_BASE_URL = "http://localhost:8001";

const navigation = [
  { label: "Overview", icon: LayoutDashboard, active: true },
  { label: "Services", icon: Boxes },
  { label: "Metrics", icon: Gauge },
  { label: "Logs", icon: Terminal },
  { label: "Incidents", icon: AlertTriangle },
  { label: "Failure Lab", icon: FlaskConical },
];

const incidentRecords = [
  {
    id: "INC-024",
    title: "Database connection pool exhausted",
    service: "database",
    severity: "CRITICAL",
    status: "OPEN",
    time: "11:46",
    description:
      "The database connection pool reached its maximum capacity. New connections are being rejected, potentially affecting dependent services.",
    assignee: "Unassigned",
  },
  {
    id: "INC-023",
    title: "Elevated API gateway latency",
    service: "api-gateway",
    severity: "HIGH",
    status: "ACKNOWLEDGED",
    time: "11:32",
    description:
      "Upstream requests are experiencing increased response times and intermittent timeouts.",
    assignee: "Operations",
  },
  {
    id: "INC-022",
    title: "Payment provider connection failures",
    service: "payment-service",
    severity: "HIGH",
    status: "OPEN",
    time: "10:58",
    description:
      "The payment service is unable to establish stable connections with its external provider.",
    assignee: "Unassigned",
  },
  {
    id: "INC-021",
    title: "Background worker execution delays",
    service: "worker",
    severity: "MEDIUM",
    status: "RESOLVED",
    time: "09:45",
    description:
      "Background jobs exceeded their expected execution time. Worker capacity was restored.",
    assignee: "Operations",
  },
];

// LIVE LOG TYPE
type LiveLog = {
  id: string;
  time: string;
  level: string;
  service: string;
  container: string;
  message: string;
  traceId: string;
};

type DockerContainer = {
  started_at: string | null;
  id: string;
  name: string;
  service: string;
  status: string;
  health: string;
  restart_count: number;
  created: string | null;
};

type DockerContainersResponse = {
  count: number;
  data: DockerContainer[];
};


// PROMETHEUS METRIC TYPE
type MetricResult = {
  metric: Record<string, string>;
  value: [number, string];
};

// PROMETHEUS METRIC HELPERS
const getMetricValue = (metric?: MetricResult) => {
  return Number(metric?.value?.[1] ?? 0);
};

const sumMetricValues = (metrics: MetricResult[] = []) => {
  return metrics.reduce(
    (total, metric) => total + getMetricValue(metric),
    0
  );
};

function App() {

  const [apiToken, setApiToken] = useState("");
  const authenticatedFetch = (
  url: string,
  options: RequestInit = {}
) => {
  return fetch(url, {
    ...options,
    headers: {
      ...options.headers,
      "X-API-Token": apiToken,
    },
  });
};
  const [tokenInput, setTokenInput] = useState("");
  const [tokenStatus, setTokenStatus] = useState<
    "disconnected" | "checking" | "connected" | "error"
  >("disconnected");

  const [logs, setLogs] = useState<LiveLog[]>([]);
  const [dockerContainers, setDockerContainers] = useState<DockerContainer[]>([]);

const containersByService = new Map<string, DockerContainer[]>();

dockerContainers.forEach((container) => {
  const serviceName = container.service || container.name;
  const existingContainers = containersByService.get(serviceName) || [];

  existingContainers.push(container);
  containersByService.set(serviceName, existingContainers);
});

const overviewServices = Array.from(containersByService.entries()).map(
  ([serviceName, containers]) => {
    const runningContainers = containers.filter(
      (container) => container.status.toLowerCase() === "running"
    );

    const healthyContainers = runningContainers.filter(
      (container) => container.health.toLowerCase() === "healthy"
    );

    const unhealthyContainers = runningContainers.filter(
      (container) => container.health.toLowerCase() === "unhealthy"
    );

    const stoppedContainers = containers.length - runningContainers.length;

    const allRunning = runningContainers.length === containers.length;
    const allHealthy = healthyContainers.length === containers.length;

    let serviceStatus = "Down";

    if (runningContainers.length > 0) {
      if (unhealthyContainers.length > 0 || !allRunning) {
        serviceStatus = "Degraded";
      } else if (allHealthy) {
        serviceStatus = "Operational";
      } else {
        serviceStatus = "Running";
      }
    }

    const startTimes = runningContainers
      .map((container) => container.started_at)
      .filter((value): value is string => Boolean(value))
      .map((value) => new Date(value).getTime())
      .filter((value) => Number.isFinite(value));

    const uptime =
      startTimes.length > 0
        ? (() => {
            const elapsedSeconds = Math.max(
              0,
              Math.floor(
                (Date.now() - Math.max(...startTimes)) / 1000
              )
            );

            const days = Math.floor(elapsedSeconds / 86400);
            const hours = Math.floor((elapsedSeconds % 86400) / 3600);
            const minutes = Math.floor((elapsedSeconds % 3600) / 60);

            return days > 0
              ? `${days}d ${hours}h`
              : hours > 0
                ? `${hours}h ${minutes}m`
                : `${minutes}m`;
          })()
        : "—";

    const latency = "—";

    return {
      name: serviceName,
      detail: `${runningContainers.length}/${containers.length} running · ${healthyContainers.length} healthy · ${unhealthyContainers.length} unhealthy · ${stoppedContainers} stopped`,
      status: serviceStatus,
      latency,
      uptime,
    };
  }
);

const healthyServices = overviewServices.filter(
  (service) => service.status === "Operational"
).length;

const degradedServices = overviewServices.filter(
  (service) => service.status === "Degraded"
).length;

const downServices = overviewServices.filter(
  (service) => service.status === "Down"
).length;

  const [containersLoading, setContainersLoading] = useState(true);
  const [containersError, setContainersError] = useState<string | null>(null);
  const [containersUpdated, setContainersUpdated] = useState<Date | null>(null);
  const [logsLoading, setLogsLoading] = useState(true);
  const [logsError, setLogsError] = useState<string | null>(null);
  const [cpuMetrics, setCpuMetrics] = useState<MetricResult[]>([]);
  const [cpuHistory, setCpuHistory] = useState<
    {
      metric: Record<string, string>;
      values: [number, string][];
    }[]
  >([]);

const [applicationHistory, setApplicationHistory] = useState<
    {
      timestamp: number;
      requests: number;
      latency: number;
    }[]
  >([]);
const [applicationMetricsError, setApplicationMetricsError] = useState<string | null>(null);
const [applicationMetricsUpdated, setApplicationMetricsUpdated] = useState<Date | null>(null);

  const requestData = applicationHistory.map((point) => ({
  time: new Date(point.timestamp * 1000).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  }),
  requests: point.requests,
  latency: point.latency,
}));

  const [memoryHistory, setMemoryHistory] = useState<
    {
      metric: Record<string, string>;
      values: [number, string][];
    }[]
  >([]);

  const [memoryMetrics, setMemoryMetrics] = useState<
    Record<string, MetricResult[]>
  >({});

  const [diskMetrics, setDiskMetrics] = useState<
    Record<string, MetricResult[]>
  >({});

  const [networkMetrics, setNetworkMetrics] = useState<
    Record<string, MetricResult[]>
  >({});

  const [metricsLoading, setMetricsLoading] = useState(true);
  const [metricsError, setMetricsError] = useState<string | null>(null);

    // DERIVED LIVE HOST METRICS

    const cpuUsage = getMetricValue(cpuMetrics[0]);

    // FORMAT HISTORICAL CPU AND MEMORY DATA FOR RECHARTS
    const cpuHistoryChartData = useMemo(() => {
      if (!cpuHistory.length) return [];

      const memoryValues = memoryHistory[0]?.values ?? [];

      return cpuHistory.flatMap((series) =>
        series.values.map(([timestamp, value]) => {
          const nearestMemory = memoryValues.reduce<
            [number, string] | null
          >((nearest, current) => {
            if (
              !nearest ||
              Math.abs(current[0] - timestamp) <
                Math.abs(nearest[0] - timestamp)
            ) {
              return current;
            }

            return nearest;
          }, null);

          const memoryValue =
            nearestMemory &&
            Math.abs(nearestMemory[0] - timestamp) <= 10
              ? Number(nearestMemory[1])
              : null;

          return {
            time: new Date(timestamp * 1000).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            }),
            cpu: Number(value),
            memory: memoryValue,
          };
        })
      );
    }, [cpuHistory, memoryHistory]);

  const memoryUsagePercent = sumMetricValues(
    memoryMetrics.committed_percent
  );

  const diskFreePercent = diskMetrics.free_space_percent ?? [];

  const diskFreeMB = diskMetrics.free_megabytes ?? [];

  // FORMAT NETWORK DATA FOR THE DASHBOARD
  const networkIncoming = networkMetrics.bytes_received_per_second ?? [];
  const networkOutgoing = networkMetrics.bytes_sent_per_second ?? [];

  const networkChartData = useMemo(() => {
    const incoming = networkIncoming;
    const outgoing = networkOutgoing;

    const timestamps = new Set<number>();

    incoming.forEach((metric) => {
      if (metric.value?.[0]) {
        timestamps.add(metric.value[0]);
      }
    });

    outgoing.forEach((metric) => {
      if (metric.value?.[0]) {
        timestamps.add(metric.value[0]);
      }
    });

    return Array.from(timestamps)
      .sort((a, b) => a - b)
      .map((timestamp) => {
        const incomingMetric = incoming.find(
          (metric) => metric.value?.[0] === timestamp
        );

        const outgoingMetric = outgoing.find(
          (metric) => metric.value?.[0] === timestamp
        );

        return {
          time: new Date(timestamp * 1000).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          }),
          incoming: incomingMetric
            ? getMetricValue(incomingMetric) / (1024 * 1024)
            : 0,
          outgoing: outgoingMetric
            ? getMetricValue(outgoingMetric) / (1024 * 1024)
            : 0,
        };
      });
  }, [networkIncoming, networkOutgoing]);

  // FORMAT DISK DATA FOR THE DASHBOARD
  const diskDrives = diskFreePercent
    .filter((metric) =>
      /^[A-Z]:$/.test(metric.metric.exported_instance ?? "")
    )
    .map((percentMetric) => {
      const drive = percentMetric.metric.exported_instance ?? "";

      const freeSpaceMetric = diskFreeMB.find(
        (metric) => metric.metric.exported_instance === drive
      );

      const freePercent = getMetricValue(percentMetric);
      const freeMB = getMetricValue(freeSpaceMetric);

      return {
        drive,
        freePercent,
        usedPercent: 100 - freePercent,
        freeGB: freeMB / 1024,
      };
    });

  const networkIncomingBytes = sumMetricValues(
    networkMetrics.bytes_received_per_second
  );

  const networkOutgoingBytes = sumMetricValues(
    networkMetrics.bytes_sent_per_second
  );

  const networkIncomingMB = networkIncomingBytes / (1024 ** 2);

  const networkOutgoingMB = networkOutgoingBytes / (1024 ** 2);

  // LOG SEARCH STATE
  const [logSearch, setLogSearch] = useState("");
  const [logLevel, setLogLevel] = useState("ALL");
  const [logService, setLogService] = useState("ALL");

  // EXPANDED LOG STATE
  const [expandedLog, setExpandedLog] = useState<string | null>(null);

  // INCIDENT MANAGEMENT STATE
  const [incidentsList, setIncidentsList] = useState(incidentRecords);
  const [selectedIncident, setSelectedIncident] = useState<string | null>(null);

  const incidents = incidentsList.slice(0, 3).map((incident) => ({
  ...incident,
  color:
    incident.status.toUpperCase() === "RESOLVED"
      ? "success"
      : "warning",
}));

  // INCIDENT SEARCH AND FILTERS
  const [incidentSearch, setIncidentSearch] = useState("");
  const [incidentSeverityFilter, setIncidentSeverityFilter] = useState("ALL");
  const [incidentStatusFilter, setIncidentStatusFilter] = useState("ALL");

  const [incidentsLoading, setIncidentsLoading] = useState(true);
  const [incidentsError, setIncidentsError] = useState<string | null>(null);

  const [showCreateIncident, setShowCreateIncident] = useState(false);

const [newIncident, setNewIncident] = useState({
  title: "",
  service: "api-gateway",
  severity: "HIGH",
  description: "",
  assignee: "Unassigned",
});

const [creatingIncident, setCreatingIncident] = useState(false);

  const fetchIncidents = async () => {
    try {
      setIncidentsError(null);

      const response = await authenticatedFetch(`${API_BASE_URL}/api/incidents`);

      if (!response.ok) {
        throw new Error("Failed to load incidents from LogDock API.");
      }

      const data = await response.json();

      setIncidentsList(data);
    } catch (error) {
      console.error("Incident loading error:", error);
      setIncidentsError("Unable to connect to the LogDock backend.");
    } finally {
      setIncidentsLoading(false);
    }
  };

    // FETCH REAL HOST METRICS
    const fetchHostMetrics = async () => {
    try {
      setMetricsError(null);

    // FETCH CURRENT HOST METRICS
    const [cpuResponse, memoryResponse, diskResponse, networkResponse] =
      await Promise.all([
        authenticatedFetch(`${API_BASE_URL}/api/metrics/cpu`),
        authenticatedFetch(`${API_BASE_URL}/api/metrics/memory`),
        authenticatedFetch(`${API_BASE_URL}/api/metrics/disk`),
        authenticatedFetch(`${API_BASE_URL}/api/metrics/network`),
      ]);

    if (
      !cpuResponse.ok ||
      !memoryResponse.ok ||
      !diskResponse.ok ||
      !networkResponse.ok
    ) {
      throw new Error("Failed to fetch host metrics.");
    }

    const [cpuData, memoryData, diskData, networkData] =
      await Promise.all([
        cpuResponse.json(),
        memoryResponse.json(),
        diskResponse.json(),
        networkResponse.json(),
      ]);

    setCpuMetrics(cpuData.data);
    setMemoryMetrics(memoryData.data);
    setDiskMetrics(diskData.data);
    setNetworkMetrics(networkData.data);

    // FETCH HISTORICAL CPU AND MEMORY DATA
    try {
      const [historyResponse, memoryHistoryResponse] =
        await Promise.all([
          authenticatedFetch(`${API_BASE_URL}/api/metrics/cpu/history`),
          authenticatedFetch(`${API_BASE_URL}/api/metrics/memory/history`),
        ]);

      if (!historyResponse.ok || !memoryHistoryResponse.ok) {
        throw new Error("Failed to fetch historical metrics.");
      }

      const [historyData, memoryHistoryData] = await Promise.all([
        historyResponse.json(),
        memoryHistoryResponse.json(),
      ]);

      setCpuHistory(historyData.data);
      setMemoryHistory(memoryHistoryData.data);
    } catch (historyError) {
      console.error("Historical metrics loading error:", historyError);
    }
  } catch (error) {
    console.error("Host metrics loading error:", error);
    setMetricsError("Unable to load live host metrics.");
  } finally {
    setMetricsLoading(false);
  }
};

// FETCH APPLICATION PERFORMANCE HISTORY
const fetchApplicationMetrics = async () => {
  try {
    const response = await authenticatedFetch(
      `${API_BASE_URL}/api/metrics/application/history`
    );

    if (!response.ok) {
      throw new Error("Failed to fetch application metrics.");
    }

    const result = await response.json();

    setApplicationHistory(result.data);
    setApplicationMetricsError(null);
    setApplicationMetricsUpdated(new Date());
  } catch (error) {
    console.error("Application metrics loading error:", error);
    setApplicationMetricsError(
      "Unable to refresh application performance metrics."
    );
  }
};

// FETCH LIVE DOCKER LOGS
const fetchLogs = async () => {
  try {
    setLogsError(null);

    const response = await authenticatedFetch(
      `${API_BASE_URL}/api/logs?limit=100&since=1h`
    );

    if (!response.ok) {
      throw new Error("Failed to fetch logs.");
    }

    const result = await response.json();

    setLogs(result.data);
  } catch (error) {
    console.error("Logs loading error:", error);
    setLogsError("Unable to load live logs.");
  } finally {
    setLogsLoading(false);
  }
};

const fetchDockerContainers = async () => {
  try {
    setContainersError(null);

    const response = await authenticatedFetch(
      `${API_BASE_URL}/api/services/containers`
    );

    if (!response.ok) {
      throw new Error("Failed to fetch Docker containers.");
    }

    const result: DockerContainersResponse = await response.json();

    setDockerContainers(result.data);
    setContainersUpdated(new Date());
  } catch (error) {
    console.error("Docker containers loading error:", error);
    setContainersError("Unable to load Docker containers.");
  } finally {
    setContainersLoading(false);
  }
};

const verifyApiToken = async () => {
  const candidate = tokenInput.trim();

  if (!candidate) {
    setTokenStatus("error");
    return;
  }

  setTokenStatus("checking");

  try {
    const response = await fetch(
      `${API_BASE_URL}/api/auth/verify`,
      {
        headers: {
          "X-API-Token": candidate,
        },
      }
    );

    if (!response.ok) {
      setTokenStatus("error");
      setApiToken("");
      return;
    }

    setApiToken(candidate);
    setTokenInput("");
    setTokenStatus("connected");
  } catch (error) {
    console.error("API authentication error:", error);
    setApiToken("");
    setTokenStatus("error");
  }
};

const disconnectApiToken = () => {
  setApiToken("");
  setTokenInput("");
  setTokenStatus("disconnected");
};

const createIncident = async () => {
  if (!newIncident.title.trim() || !newIncident.description.trim()) {
    setIncidentsError("Please enter an incident title and description.");
    return;
  }

  try {
    setCreatingIncident(true);
    setIncidentsError(null);

    const response = await fetch(`${API_BASE_URL}/api/incidents`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Token": apiToken,
      },
      body: JSON.stringify({
        ...newIncident,
        title: newIncident.title.trim(),
        description: newIncident.description.trim(),
      }),
    });

    if (!response.ok) {
      throw new Error("Failed to create incident.");
    }

    const createdIncident = await response.json();

    setIncidentsList((current) => [
      createdIncident,
      ...current,
    ]);

    setSelectedIncident(createdIncident.id);

    setNewIncident({
      title: "",
      service: "api-gateway",
      severity: "HIGH",
      description: "",
      assignee: "Unassigned",
    });

    setShowCreateIncident(false);
  } catch (error) {
    console.error("Create incident error:", error);
    setIncidentsError("Unable to create the incident. Please try again.");
  } finally {
    setCreatingIncident(false);
  }
};

  // AUTOMATIC INCIDENT REFRESH
  useEffect(() => {
    if (!apiToken) return;

    fetchIncidents();

    const incidentsInterval = setInterval(() => {
      fetchIncidents();
    }, 5000);

    return () => clearInterval(incidentsInterval);
  }, [apiToken]);

  // AUTOMATIC HOST METRICS REFRESH
  useEffect(() => {
    if (!apiToken) return;

    fetchHostMetrics();

    const metricsInterval = setInterval(() => {
      fetchHostMetrics();
    }, 5000);

    return () => clearInterval(metricsInterval);
  }, [apiToken]);

// AUTO-REFRESH APPLICATION PERFORMANCE
useEffect(() => {
  if (!apiToken) return;

  fetchApplicationMetrics();

  const applicationMetricsInterval = setInterval(() => {
    fetchApplicationMetrics();
  }, 15000);

  return () => clearInterval(applicationMetricsInterval);
}, [apiToken]);

// AUTOMATIC LOG REFRESH
useEffect(() => {
  if (!apiToken) return;

  fetchLogs();

  const logsInterval = setInterval(() => {
    fetchLogs();
  }, 5000);

  return () => clearInterval(logsInterval);
}, [apiToken]);

// AUTOMATIC DOCKER CONTAINER REFRESH
useEffect(() => {
  if (!apiToken) return;

  fetchDockerContainers();

  const containersInterval = setInterval(() => {
    fetchDockerContainers();
  }, 5000);

  return () => clearInterval(containersInterval);
}, [apiToken]);

  // SERVICE MONITORING STATE
  const [selectedService, setSelectedService] = useState("api-gateway");
  const [activeSection, setActiveSection] = useState("overview");
  const [manualActiveSection, setManualActiveSection] = useState<string | null>(null);

  const activeService =
    dockerContainers.find(
      (service) => service.name === selectedService
    ) ?? dockerContainers[0] ?? null;

  useEffect(() => {
    if (
      dockerContainers.length > 0 &&
      !dockerContainers.some(
        (service) => service.name === selectedService
      )
    ) {
      setSelectedService(dockerContainers[0].name);
    }
  }, [dockerContainers, selectedService]);

  const relatedServiceIncidents = activeService
    ? incidentsList.filter(
        (incident) =>
          (incident.service === activeService.service ||
            incident.service === activeService.name) &&
          incident.status !== "RESOLVED"
      )
    : [];

    useEffect(() => {
      const sections = [
        "overview",
        "services",
        "metrics",
        "logs",
        "incidents",
        "failure-lab",
      ];

      const handleScroll = () => {
        const scrollPosition = window.scrollY + 180;

        let currentSection = "overview";

        sections.forEach((sectionId) => {
          const section = document.getElementById(sectionId);

          if (section && section.offsetTop <= scrollPosition) {
            currentSection = sectionId;
          }
        });

        setActiveSection(currentSection);
      };

      window.addEventListener("scroll", handleScroll);
      handleScroll();

      return () => {
        window.removeEventListener("scroll", handleScroll);
      };
    }, []);


  // SERVICE INSPECTOR SCROLL
  const serviceInspectorRef = useRef<HTMLElement | null>(null);

  // FILTER LOGS
  const filteredLogs = useMemo(() => {
    return logs.filter((log) => {
      const searchTerm = logSearch.toLowerCase();

      const matchesSearch =
        log.message.toLowerCase().includes(searchTerm) ||
        log.traceId.toLowerCase().includes(searchTerm) ||
        log.id.toLowerCase().includes(searchTerm) ||
        log.level.toLowerCase().includes(searchTerm) ||
        log.service.toLowerCase().includes(searchTerm);

      const matchesLevel =
        logLevel === "ALL" || log.level === logLevel;

      const matchesService =
        logService === "ALL" || log.service === logService;

      return matchesSearch && matchesLevel && matchesService;
    });
  }, [logs, logSearch, logLevel, logService]);

  // ACKNOWLEDGE INCIDENT

  const acknowledgeIncident = async (id: string) => {
    try {
      const response = await authenticatedFetch(
        `${API_BASE_URL}/api/incidents/${id}/acknowledge`,
        {
          method: "PATCH",
        }
      );

      if (!response.ok) {
        throw new Error("Failed to acknowledge incident.");
      }

      const updatedIncident = await response.json();

      setIncidentsList((current) =>
        current.map((incident) =>
          incident.id === id ? updatedIncident : incident
        )
      );

      setIncidentsError(null);
    } catch (error) {
      console.error("Acknowledge error:", error);
      setIncidentsError("Unable to acknowledge this incident.");
    }
  };


  // RESOLVE INCIDENT

  const resolveIncident = async (id: string) => {
    try {
      const response = await authenticatedFetch(
        `${API_BASE_URL}/api/incidents/${id}/resolve`,
        {
          method: "PATCH",
        }
      );

      if (!response.ok) {
        throw new Error("Failed to resolve incident.");
      }

      const updatedIncident = await response.json();

      setIncidentsList((current) =>
        current.map((incident) =>
          incident.id === id ? updatedIncident : incident
        )
      );

      setIncidentsError(null);
    } catch (error) {
      console.error("Resolve error:", error);
      setIncidentsError("Unable to resolve this incident.");
    }
  };


  // SELECTED INCIDENT
  const activeIncident =
    incidentsList.find(
      (incident) => incident.id === selectedIncident
    ) ?? null;

  // FILTERED INCIDENTS
  const filteredIncidents = incidentsList.filter((incident) => {
    const searchTerm = incidentSearch.toLowerCase().trim();

    const matchesSearch =
      incident.id.toLowerCase().includes(searchTerm) ||
      incident.title.toLowerCase().includes(searchTerm) ||
      incident.service.toLowerCase().includes(searchTerm);

    const matchesSeverity =
      incidentSeverityFilter === "ALL" ||
      incident.severity === incidentSeverityFilter;

    const matchesStatus =
      incidentStatusFilter === "ALL" ||
      incident.status === incidentStatusFilter;

    return matchesSearch && matchesSeverity && matchesStatus;
  });

  // INCIDENT COUNTS
  const openIncidentCount = incidentsList.filter(
    (incident) => incident.status === "OPEN"
  ).length;

  const acknowledgedIncidentCount = incidentsList.filter(
    (incident) => incident.status === "ACKNOWLEDGED"
  ).length;

  const resolvedIncidentCount = incidentsList.filter(
    (incident) => incident.status === "RESOLVED"
  ).length;

  return (

    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark"><Activity size={21} /></div>
          <div>
            <div className="brand-name">logdock<span>.</span></div>
            <div className="brand-caption">OBSERVABILITY PLATFORM</div>
          </div>
        </div>

        <div className="workspace">
          <div className="workspace-avatar">L</div>
          <div className="workspace-info">
            <strong>Local Workspace</strong>
            <span>Development environment</span>
          </div>
          <ChevronDown size={15} />
        </div>

        <div className="nav-label">WORKSPACE</div>
        <nav className="navigation">
          {navigation.map(({ label, icon: Icon }) => (
            <a
              href={
                label === "Overview"
                  ? "#overview"
                  : label === "Services"
                    ? "#services"
                    : label === "Metrics"
                      ? "#metrics"
                      : label === "Logs"
                        ? "#logs"
                        : label === "Incidents"
                          ? "#incidents"
                          : label === "Failure Lab"
                            ? "#failure-lab"
                            : "#"
              }

              className={`nav-item ${
                (manualActiveSection ?? activeSection) ===
                (label === "Failure Lab" ? "failure-lab" : label.toLowerCase())
                  ? "active"
                  : ""
              }`}
              key={label}
              onClick={() => {
                const sectionId =
                  label === "Failure Lab" ? "failure-lab" : label.toLowerCase();

                setManualActiveSection(sectionId);
                setActiveSection(sectionId);
              }}
            >
              <Icon size={18} strokeWidth={1.8} />
              <span>{label}</span>
              {label === "Incidents" && <span className="nav-count">1</span>}
            </a>
          ))}
        </nav>

        <div className="nav-label tools-label">CONFIGURATION</div>
        <nav className="navigation">
          <a href="#" className="nav-item">
            <Settings size={18} strokeWidth={1.8} />
            <span>Settings</span>
          </a>
          <a href="#" className="nav-item">
            <CircleHelp size={18} strokeWidth={1.8} />
            <span>Documentation</span>
          </a>
        </nav>

        <div className="sidebar-bottom">
          <div className="sidebar-status">
            <span className="live-dot" />
            <span>Local agent connected</span>
          </div>
          <div className="profile">
            <div className="profile-avatar">LD</div>
            <div className="profile-info">
              <strong>LogDock Admin</strong>
              <span>Administrator</span>
            </div>
            <Settings size={17} />
          </div>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div className="breadcrumbs">
            <span>Workspace</span>
            <span className="breadcrumb-divider">/</span>
            <strong>Overview</strong>
          </div>

<div className="topbar-actions">
  <div className="environment">
    <span className="environment-dot" />
    Local environment
    <ChevronDown size={14} />
  </div>

  <div className="topbar-auth">
    {tokenStatus === "connected" ? (
      <>
        <span className="topbar-auth-status connected">
          <i />
          AUTHORIZED
        </span>

        <button
          type="button"
          className="topbar-auth-button"
          onClick={disconnectApiToken}
        >
          Disconnect
        </button>
      </>
    ) : (
      <>
        <input
          type="password"
          value={tokenInput}
          onChange={(event) => {
            setTokenInput(event.target.value);
            if (tokenStatus === "error") {
              setTokenStatus("disconnected");
            }
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              verifyApiToken();
            }
          }}
          placeholder="API token"
          aria-label="LogDock API token"
          autoComplete="off"
        />

        <button
          type="button"
          className="topbar-auth-button"
          onClick={verifyApiToken}
          disabled={tokenStatus === "checking" || !tokenInput.trim()}
        >
          {tokenStatus === "checking" ? "Checking..." : "Connect"}
        </button>
      </>
    )}
  </div>

  <button className="icon-button" aria-label="Search">
    <Search size={18} />
  </button>

  <button className="icon-button notification-button" aria-label="Notifications">
    <Bell size={18} />
    <span />
  </button>

  <div className="topbar-divider" />
  <div className="topbar-avatar">LD</div>
</div>
        </header>

        <div className="dashboard" id="overview">
          <section className="page-heading">
            <div>
              <div className="eyebrow">SYSTEM OVERVIEW <span className="eyebrow-line" /></div>
              <h1>
                {new Date().getHours() < 12
                  ? "Good morning."
                  : new Date().getHours() < 17
                    ? "Good afternoon."
                    : "Good evening."}
              </h1>
              <p>Here's what's happening across your infrastructure.</p>
            </div>
            <div className="heading-meta">
              <div
                className={`live-indicator ${
                  tokenStatus !== "connected"
                    ? "offline"
                    : containersError
                      ? "degraded"
                      : ""
                }`}
              >
                <span className="live-dot" />
                {tokenStatus === "checking"
                  ? "VERIFYING ACCESS"
                  : tokenStatus !== "connected"
                    ? "AUTHORIZATION REQUIRED"
                    : containersLoading
                      ? "CONNECTING..."
                      : containersError
                        ? "MONITORING DEGRADED"
                        : "LIVE MONITORING"}
              </div>

              <span className="updated-time">
                <Clock3 size={13} />
                {containersUpdated
                  ? `Updated at ${containersUpdated.toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                    })}`
                  : "Waiting for first update"}
              </span>
            </div>
          </section>


<section className="system-banner">
  <div className="banner-icon">
    <ShieldCheck size={21} />
  </div>

  <div className="banner-copy">
    <strong>
      {containersLoading
        ? "Checking infrastructure health..."
        : containersError
          ? "Infrastructure status unavailable"
          : downServices + degradedServices === 0
            ? "Your infrastructure is healthy"
            : "Your infrastructure needs attention"}
    </strong>

    <span>
      {containersError
        ? containersError
        : containersLoading
          ? "Retrieving live Docker container status."
          : `${healthyServices} healthy, ${degradedServices} degraded, ${downServices} down out of ${overviewServices.length} services.`}
    </span>
  </div>

  <div className="banner-right">
    <span className="banner-status">
      {containersLoading
        ? "CHECKING"
        : containersError
          ? "UNAVAILABLE"
          : downServices + degradedServices > 0
            ? `${downServices + degradedServices} NEED ATTENTION`
            : `${healthyServices} HEALTHY`}
    </span>

    <span className="banner-arrow">→</span>
  </div>
</section>

          <section className="metrics-grid">
            <article className="metric-card">
              <div className="metric-top">
                <span>Services online</span>
                <div className="metric-icon green"><Server size={17} /></div>
              </div>
              <div className="metric-value">3<span className="metric-total">/4</span></div>
              <div className="metric-foot"><span className="positive-dot" /> 75% operational</div>
              <div className="mini-bars">
                {[30, 45, 38, 60, 48, 72, 58, 80, 68, 88, 74, 92].map((height, i) => <i key={i} style={{ height: `${height}%` }} />)}
              </div>
            </article>

            <article className="metric-card">
              <div className="metric-top">
                <span>Request rate</span>
                <div className="metric-icon blue"><Zap size={17} /></div>
              </div>
              <div className="metric-value">1,284 <span className="metric-unit">rpm</span></div>
              <div className="metric-foot"><span className="positive-text">↑ 8.4%</span> vs previous hour</div>
              <div className="mini-bars blue-bars">
                {[45, 52, 38, 65, 55, 74, 63, 82, 68, 92, 78, 88].map((height, i) => <i key={i} style={{ height: `${height}%` }} />)}
              </div>
            </article>

            <article className="metric-card">
              <div className="metric-top">
                <span>Error rate</span>
                <div className="metric-icon amber"><AlertTriangle size={17} /></div>
              </div>
              <div className="metric-value">0.82<span className="metric-unit">%</span></div>
              <div className="metric-foot"><span className="warning-text">↑ 0.12%</span> vs previous hour</div>
              <div className="mini-bars amber-bars">
                {[25, 32, 29, 38, 45, 38, 52, 48, 65, 55, 72, 80].map((height, i) => <i key={i} style={{ height: `${height}%` }} />)}
              </div>
            </article>


<article className="metric-card">
  <div className="metric-top">
    <span>Avg. response time</span>
    <div className="metric-icon purple"><Clock3 size={17} /></div>
  </div>

  <div className="metric-value">
    {applicationHistory.length > 0
      ? applicationHistory[applicationHistory.length - 1].latency.toFixed(1)
      : "—"}
    <span className="metric-unit"> ms</span>
  </div>

  <div className="metric-foot">
    {applicationHistory.length > 0
      ? "Latest Prometheus measurement"
      : "Waiting for application metrics"}
  </div>

  <div className="mini-bars purple-bars">
    {applicationHistory.slice(-12).map((point, i, values) => {
      const maxLatency = Math.max(
        ...values.map((item) => item.latency),
        1
      );

      const height = Math.max(
        12,
        (point.latency / maxLatency) * 100
      );

      return (
        <i
          key={`${point.timestamp}-${i}`}
          style={{ height: `${height}%` }}
        />
      );
    })}
  </div>
</article>

          </section>

          <section className="content-grid">
            <article className="panel services-panel">
              <div className="panel-heading">
                <div>
                  <h2>Service health</h2>
                  <p>Current state of monitored services</p>
                </div>
                <button className="text-action">View all services <span>→</span></button>
              </div>

              <div className="table-header">
                <span>SERVICE</span>
                <span>STATUS</span>
                <span>LATENCY</span>
                <span>UPTIME</span>
              </div>

<div className="service-list">
  {overviewServices.map((service) => (
    <div className="service-row" key={service.name}>
      <div className="service-name">
        <div className="service-symbol">
          <Boxes size={16} />
        </div>
        <div>
          <strong>{service.name}</strong>
          <span>{service.detail}</span>
        </div>
      </div>

      <div>
        <span
          className={`status-pill ${
            service.status === "Operational"
              ? "operational"
              : "degraded"
          }`}
        >
          <i />
          {service.status}
        </span>
      </div>

      <span
        className={
          service.status === "Operational"
            ? "latency-value"
            : "latency-warning"
        }
      >
        {service.name === "backend" && applicationHistory.length > 0
          ? `${applicationHistory[applicationHistory.length - 1].latency.toFixed(1)} ms`
          : service.latency}
      </span>

      <span className="uptime-value">{service.uptime}</span>
    </div>
  ))}
</div>

              <div className="panel-footer">
                <span>Showing {overviewServices.length} monitored services</span>
                <span><span className="live-dot" /> Monitoring active</span>
              </div>
            </article>

            <article className="panel incident-panel">
              <div className="panel-heading">
                <div>
                  <h2>Recent activity</h2>
                  <p>Latest incidents and events</p>
                </div>
                <button className="more-button">···</button>
              </div>

              <div className="incident-list">
                {incidents.map((incident) => (
                  <div className="incident-row" key={incident.id}>
                    <div className={`incident-marker ${incident.color}`} />
                    <div className="incident-copy">
                      <div className="incident-meta">
                        <span>{incident.id}</span>
                        <span>·</span>
                        <span>{incident.time}</span>
                      </div>
                      <strong>{incident.title}</strong>
                      <div className="incident-bottom">
                        <span>{incident.service}</span>
                        <span className={`incident-severity ${incident.color}`}>
                          {incident.severity} · {incident.status}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="incident-footer">
                <button className="text-action">Open incident center <span>→</span></button>
              </div>
            </article>
          </section>

<section className="services-section" id="services">
  <div className="section-heading">
    <div>
      <div className="eyebrow">
        SERVICE OBSERVABILITY <span className="eyebrow-line" />
      </div>
      <h2>Service monitoring</h2>
      <p>Monitor application components and inspect their operational health.</p>
    </div>
    <div className="logs-live-indicator">
      <span className="period-dot" />
      SERVICE REGISTRY
    </div>
  </div>

<div className="service-monitor-grid">
  {dockerContainers.map((service) => {
    const isRunning = service.status === "RUNNING";

    const healthStatus =
      service.health === "healthy"
        ? "HEALTHY"
        : service.health === "unhealthy"
          ? "UNHEALTHY"
          : service.health === "starting"
            ? "STARTING"
            : isRunning
              ? "RUNNING"
              : "STOPPED";

    return (
      <button
        type="button"
        key={service.id}
        className={`panel service-monitor-card ${
          selectedService === service.name ? "selected" : ""
        }`}
        onClick={() => {
          setSelectedService(service.name);

          setTimeout(() => {
            serviceInspectorRef.current?.scrollIntoView({
              behavior: "smooth",
              block: "center",
            });
          }, 100);
        }}
      >
        <div className="service-monitor-top">
          <div>
            <span className="chart-unit">DOCKER CONTAINER</span>
            <h3>{service.name}</h3>
          </div>

          <span
            className={`service-health-badge health-${healthStatus.toLowerCase()}`}
          >
            <span />
            {healthStatus}
          </span>
        </div>

        <div className="service-uptime">
          <span>CONTAINER ID</span>
          <strong>{service.id}</strong>
        </div>

        <div className="service-resource">
          <div className="service-resource-heading">
            <span>Docker service</span>
            <strong>{service.service}</strong>
          </div>
        </div>

        <div className="service-resource">
          <div className="service-resource-heading">
            <span>Restart count</span>
            <strong>{service.restart_count}</strong>
          </div>
        </div>

        <div className="service-card-footer">
          <span>State <strong>{service.status}</strong></span>
          <span>{service.health}</span>
        </div>
      </button>
    );
  })}
</div>

{containersLoading && (
  <div className="logs-empty">Loading Docker containers...</div>
)}

{containersError && (
  <div className="logs-error-state">
    <AlertTriangle size={18} />
    <div>
      <strong>Unable to load Docker containers</strong>
      <p>{containersError}</p>
      <small>Check that the backend and Docker services are running.</small>
    </div>
  </div>
)}

{!containersLoading &&
  !containersError &&
  dockerContainers.length === 0 && (
    <div className="logs-empty">
      No Docker containers found.
    </div>
  )}

  <article
    ref={serviceInspectorRef}
    className="panel service-inspector"
  >
    {activeService ? (
      <>
        <div className="panel-heading">
          <div>
            <span className="chart-unit">DOCKER CONTAINER INSPECTOR</span>
            <h2>{activeService.name}</h2>
          </div>

          <span
            className={`service-health-badge health-${
              activeService.status === "RUNNING" ? "healthy" : "degraded"
            }`}
          >
            <span />
            {activeService.status}
          </span>
        </div>

        <div className="service-inspector-content">
          <p>
            Live information retrieved directly from the Docker Engine.
          </p>

          <div className="service-inspector-stats">
            <div>
              <span>CONTAINER ID</span>
              <strong>{activeService.id}</strong>
            </div>

            <div>
              <span>DOCKER SERVICE</span>
              <strong>{activeService.service}</strong>
            </div>

            <div>
              <span>HEALTH</span>
              <strong>{activeService.health}</strong>
            </div>

            <div>
              <span>RESTART COUNT</span>
              <strong>{activeService.restart_count}</strong>
            </div>

            <div>
              <span>CONTAINER STATUS</span>
              <strong>{activeService.status}</strong>
            </div>

            <div>
              <span>CREATED</span>
              <strong>
                {activeService.created
                  ? new Date(activeService.created).toLocaleString()
                  : "Unavailable"}
              </strong>
            </div>
          </div>

          <div className="service-activity">
            <div className="service-activity-heading">
              <div>
                <span className="chart-unit">CONTAINER TELEMETRY</span>
                <h3>Resource activity</h3>
              </div>
            </div>

            <p className="dependency-empty">
              Container-specific CPU, memory and performance history
              will be integrated in a later monitoring step.
            </p>
          </div>

          <div className="service-dependencies">
            <div className="service-dependencies-heading">
              <div>
                <span className="chart-unit">SERVICE RELATIONSHIPS</span>
                <h3>Dependencies</h3>
              </div>
            </div>

            <p className="dependency-empty">
              Container dependency relationships are not yet configured.
            </p>
          </div>

          <div className="service-related-incidents">
            <div className="service-related-heading">
              <div>
                <span className="chart-unit">INCIDENT MANAGEMENT</span>
                <h3>Related incidents</h3>
              </div>

              <span className="dependency-count">
                {relatedServiceIncidents.length} ACTIVE
              </span>
            </div>

            {relatedServiceIncidents.length > 0 ? (
              <div className="related-incident-list">
                {relatedServiceIncidents.map((incident) => (
                  <div className="related-incident-row" key={incident.id}>
                    <div className="related-incident-info">
                      <span className="related-incident-id">
                        {incident.id}
                      </span>

                      <strong>{incident.title}</strong>

                      <span>
                        {incident.severity} · {incident.status}
                      </span>
                    </div>

                    <button
                      type="button"
                      className="related-incident-action"
                      onClick={() => {
                        setSelectedIncident(incident.id);

                        setTimeout(() => {
                          document.getElementById("incidents")?.scrollIntoView({
                            behavior: "smooth",
                            block: "start",
                          });
                        }, 100);
                      }}
                    >
                      Investigate
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="related-incident-empty">
                No active incidents are associated with this container.
              </p>
            )}
          </div>
        </div>
      </>
    ) : (
      <div className="logs-empty">
        Select a Docker container to inspect its details.
      </div>
    )}
  </article>

</section>

<section className="metrics-section" id="metrics">
  <div className="section-heading">
    <div>
      <div className="eyebrow">
        PERFORMANCE INSIGHTS <span className="eyebrow-line" />
      </div>
      <h2>Infrastructure metrics</h2>
      <p>Resource utilization and application performance over time.</p>
    </div>
    <div className="metrics-period">
      <span className="period-dot" />
      Last 3 hours
    </div>
  </div>

  <div className="metrics-summary-grid">

  <article className="metric-card">
    <div className="metric-top">
      <span>CPU utilization</span>
      <div className="metric-icon green">
        <Gauge size={17} />
      </div>
    </div>

    <div className="metric-value">
      {metricsLoading ? "..." : cpuUsage.toFixed(1)}
      <span className="metric-unit">%</span>
    </div>

    <div className="metric-foot">
      {metricsError
        ? "Unable to load CPU metrics"
        : "Live Windows host utilization"}
    </div>
  </article>

  <article className="metric-card">
    <div className="metric-top">
      <span>Memory usage</span>
      <div className="metric-icon blue">
        <Activity size={17} />
      </div>
    </div>

    <div className="metric-value">
      {metricsLoading ? "..." : memoryUsagePercent.toFixed(1)}
      <span className="metric-unit">%</span>
    </div>

    <div className="metric-foot">
      {metricsError
        ? "Unable to load memory metrics"
        : "Live Windows host utilization"}
    </div>
  </article>

  <article className="metric-card">
    <div className="metric-top">
      <span>Network incoming</span>
      <div className="metric-icon purple">
        <Activity size={17} />
      </div>
    </div>

    <div className="metric-value">
      {metricsLoading ? "..." : networkIncomingMB.toFixed(2)}
      <span className="metric-unit">MB/s</span>
    </div>

    <div className="metric-foot">
      {metricsError
        ? "Unable to load network metrics"
        : "Live inbound network traffic"}
    </div>
  </article>

  <article className="metric-card">
    <div className="metric-top">
      <span>Network outgoing</span>
      <div className="metric-icon amber">
        <Zap size={17} />
      </div>
    </div>

    <div className="metric-value">
      {metricsLoading ? "..." : networkOutgoingMB.toFixed(2)}
      <span className="metric-unit">MB/s</span>
    </div>

    <div className="metric-foot">
      {metricsError
        ? "Unable to load network metrics"
        : "Live outbound network traffic"}
    </div>
  </article>
  </div>

  <div className="metrics-charts-grid">
    <article className="panel chart-panel resource-chart">
      <div className="panel-heading">
        <div>
          <h2>Resource utilization</h2>
          <p>CPU and memory usage over time</p>
        </div>
        <span className="chart-unit">PERCENTAGE</span>
      </div>

      <div className="chart-legend">
        <span><i className="legend-cpu" /> CPU</span>
        <span><i className="legend-memory" /> Memory</span>
      </div>

      <div className="chart-container">
        <ResponsiveContainer width="100%" height="100%">

          <AreaChart data={cpuHistoryChartData}>
            <defs>
              <linearGradient id="cpuGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#89ad78" stopOpacity={0.24} />
                <stop offset="95%" stopColor="#89ad78" stopOpacity={0} />
              </linearGradient>

              <linearGradient id="memoryGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#88a9c4" stopOpacity={0.2} />
                <stop offset="95%" stopColor="#88a9c4" stopOpacity={0} />
              </linearGradient>
            </defs>

            <CartesianGrid
              stroke="#edf0eb"
              strokeDasharray="3 5"
              vertical={false}
            />

            <XAxis
              dataKey="time"
              tick={{ fontSize: 10, fill: "#929d94" }}
              axisLine={false}
              tickLine={false}
            />

            <YAxis
              domain={[0, 100]}
              tick={{ fontSize: 10, fill: "#929d94" }}
              axisLine={false}
              tickLine={false}
            />

            <Tooltip
              formatter={(value, name) => [
                `${Number(value).toFixed(1)}%`,
                name,
              ]}
              labelFormatter={(label) => `Time: ${label}`}
              contentStyle={{
                backgroundColor: "#ffffff",
                border: "1px solid #e8ece6",
                borderRadius: "10px",
                boxShadow: "0 8px 24px rgba(30, 45, 30, 0.08)",
                fontSize: "12px",
              }}
              itemStyle={{
                padding: "2px 0",
              }}
            />

            <Area
              type="monotone"
              dataKey="cpu"
              name="CPU"
              stroke="#89ad78"
              strokeWidth={2}
              fill="url(#cpuGradient)"
            />

            <Area
              type="monotone"
              dataKey="memory"
              name="Memory"
              stroke="#88a9c4"
              strokeWidth={2}
              fill="url(#memoryGradient)"
            />
          </AreaChart>

          <Area
              type="monotone"
              dataKey="memory"
              name="Memory"
              stroke="#88a9c4"
              strokeWidth={2}
              fill="url(#memoryGradient)"
            />

        </ResponsiveContainer>
      </div>
    </article>

    <article className="panel chart-panel network-chart">
      <div className="panel-heading">
        <div>
          <h2>Network traffic</h2>
          <p>Inbound and outbound bandwidth</p>
        </div>
        <span className="chart-unit">MB/S</span>
      </div>

      <div className="chart-legend">
        <span><i className="legend-cpu" /> Incoming</span>
        <span><i className="legend-outgoing" /> Outgoing</span>
      </div>

      <div className="chart-container">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={networkChartData}>
            <CartesianGrid stroke="#edf0eb" strokeDasharray="3 5" vertical={false} />
            <XAxis dataKey="time" tick={{ fontSize: 9, fill: "#929d94" }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 10, fill: "#929d94" }} axisLine={false} tickLine={false} />
            <Tooltip />
            <Area type="monotone" dataKey="incoming" name="Incoming" stroke="#89ad78" strokeWidth={2} fill="#89ad78" fillOpacity={0.12} />
            <Area type="monotone" dataKey="outgoing" name="Outgoing" stroke="#a69ac9" strokeWidth={2} fill="#a69ac9" fillOpacity={0.12} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </article>

    <article className="panel chart-panel request-chart">
      <div className="panel-heading">
        <div>
          <h2>Application performance</h2>
          <p>Request volume and response latency</p>
        </div>
        <span className="chart-unit">LAST 3 HOURS</span>
      </div>

      <div className="chart-legend">
        <span><i className="legend-cpu" /> Requests / min</span>
        <span><i className="legend-outgoing" /> Latency / ms</span>
      </div>

{applicationMetricsError ? (
  <p className="metrics-error">
    {applicationMetricsError}
  </p>
) : (
  <p className="metrics-updated">
    {applicationMetricsUpdated
      ? `Last updated: ${applicationMetricsUpdated.toLocaleTimeString()}`
      : "Waiting for first metrics update..."}
  </p>
)}

      <div className="chart-container">
        {requestData.length === 0 ? (
          <div className="chart-empty-state">
            <p>No application performance data available yet.</p>
            <span>Waiting for Prometheus to collect API measurements.</span>
          </div>
        ) : (
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={requestData}
            margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
          >
            <CartesianGrid
              stroke="#edf0eb"
              strokeDasharray="3 5"
              vertical={false}
            />

            <XAxis
              dataKey="time"
              tick={{ fontSize: 10, fill: "#929d94" }}
              axisLine={false}
              tickLine={false}
            />

            {/* LEFT AXIS: REQUESTS PER MINUTE */}
            <YAxis
              yAxisId="requests"
              orientation="left"
              tick={{ fontSize: 10, fill: "#89ad78" }}
              axisLine={false}
              tickLine={false}
              width={45}
            />

            {/* RIGHT AXIS: LATENCY IN MILLISECONDS */}
            <YAxis
              yAxisId="latency"
              orientation="right"
              tick={{ fontSize: 10, fill: "#a69ac9" }}
              axisLine={false}
              tickLine={false}
              width={45}
            />

            <Tooltip
              formatter={(value, name) => [
                `${Number(value).toFixed(2)} ${
                  name === "Requests / min" ? "req/min" : "ms"
                }`,
                name,
              ]}
              contentStyle={{
                borderRadius: "10px",
                border: "1px solid #edf0eb",
                fontSize: "12px",
              }}
            />

            <Area
              type="monotone"
              dataKey="requests"
              name="Requests / min"
              yAxisId="requests"
              stroke="#89ad78"
              strokeWidth={2}
              fill="#89ad78"
              fillOpacity={0.12}
              connectNulls
            />

            <Area
              type="monotone"
              dataKey="latency"
              name="Latency / ms"
              yAxisId="latency"
              stroke="#a69ac9"
              strokeWidth={2}
              fill="#a69ac9"
              fillOpacity={0.12}
              connectNulls
            />
          </AreaChart>
        </ResponsiveContainer>
        )}
      </div>
    </article>
  </div>

  {/* DISK MONITORING */}
  <div className="disk-monitoring-section">
    <article className="disk-monitoring-panel">
      <div className="disk-monitoring-header">
        <div>
          <h3>Disk Usage</h3>
          <p>Live storage utilization across your drives</p>
        </div>

        <span className="chart-unit">LIVE</span>
      </div>

      {metricsLoading ? (
        <div className="disk-monitoring-empty">
          Loading disk metrics...
        </div>
      ) : metricsError ? (
        <div className="disk-monitoring-empty">
          Unable to load disk metrics.
        </div>
      ) : diskDrives.length > 0 ? (
        <div className="disk-drive-grid">
          {diskDrives.map((drive) => (
            <div className="disk-drive-card" key={drive.drive}>
              <div className="disk-drive-card-header">
                <div className="disk-drive-name">
                  <div className="disk-drive-icon">
                    <Server size={17} />
                  </div>

                  <div>
                    <h4>{drive.drive}</h4>
                    <span>Local Drive</span>
                  </div>
                </div>

                <span className="disk-drive-used">
                  {drive.usedPercent.toFixed(1)}% used
                </span>
              </div>

              <div className="disk-drive-progress">
                <div
                  className="disk-drive-progress-fill"
                  style={{
                    width: `${drive.usedPercent}%`,
                  }}
                />
              </div>

              <div className="disk-drive-details">
                <div>
                  <span>Available space</span>
                  <strong>{drive.freeGB.toFixed(1)} GB</strong>
                </div>

                <div>
                  <span>Free</span>
                  <strong>{drive.freePercent.toFixed(1)}%</strong>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="disk-monitoring-empty">
          No disk drives detected.
        </div>
      )}
    </article>
  </div>
</section>

<section className="logs-section" id="logs">
  <div className="section-heading">
    <div>
      <h2>Logs explorer</h2>
      <p>Search, filter and investigate application events</p>
    </div>

    <div
      className={`logs-live-indicator ${
        logsError
          ? "logs-status-degraded"
          : logsLoading
            ? "logs-status-loading"
            : "logs-status-live"
      }`}
    >
      <span className="period-dot"></span>
      {logsError
        ? "DEGRADED"
        : logsLoading
          ? "CONNECTING"
          : "LIVE"}
    </div>
  </div>
  <div className="panel logs-panel">
    <div className="logs-toolbar">
      <div className="logs-search">
        <Search size={15} />
        <input
          type="text"
          placeholder="Search messages, log IDs or trace IDs..."
          value={logSearch}
          onChange={(event) => setLogSearch(event.target.value)}
        />
      </div>

      <select
        value={logLevel}
        onChange={(event) => setLogLevel(event.target.value)}
        className="logs-filter"
      >
        <option value="ALL">All levels</option>
        <option value="INFO">Info</option>
        <option value="WARNING">Warning</option>
        <option value="ERROR">Error</option>
        <option value="CRITICAL">Critical</option>
      </select>

      <select
        value={logService}
        onChange={(event) => setLogService(event.target.value)}
        className="logs-filter"
      >
        <option value="ALL">All services</option>
        <option value="backend">Backend</option>
        <option value="loki">Loki</option>
        <option value="prometheus">Prometheus</option>
        <option value="alloy">Alloy</option>
      </select>
    </div>

    <div className="logs-table-header">
      <span>TIME</span>
      <span>SEVERITY</span>
      <span>SERVICE</span>
      <span>MESSAGE</span>
    </div>

    <div className="logs-list">

      {logsError && (
        <div className="logs-error-state">
          <AlertTriangle size={18} />
          <div>
            <strong>Unable to load live logs</strong>
            <p>{logsError}</p>
            <small>Check that the backend and Loki services are running.</small>
          </div>
        </div>
      )}

      {!logsLoading && !logsError && filteredLogs.length === 0 && (
        <div className="logs-empty">
          No log entries found. Try changing your search or filters.
        </div>
      )}

      {!logsError && filteredLogs.map((log) => (
        <div
          className={`log-entry ${expandedLog === log.id ? "log-entry-expanded" : ""}`}
          key={log.id}
          onClick={() =>
            setExpandedLog(expandedLog === log.id ? null : log.id)
          }
        >
          <span className="log-time">{log.time}</span>

          <span className={`log-level log-${log.level.toLowerCase()}`}>
            {log.level}
          </span>

          <div className="log-service">
            <span>{log.service}</span>
            <small>{log.container}</small>
          </div>

          <div className="log-message">
            <span>{log.message}</span>
            <small>{log.id} · {log.traceId}</small>
          </div>

          {expandedLog === log.id && (
            <div className="log-details">
              <div><strong>Service:</strong> {log.service}</div>
              <div><strong>Container:</strong> {log.container}</div>
              <div><strong>Severity:</strong> {log.level}</div>
              <div><strong>Timestamp:</strong> {log.time}</div>
              <div><strong>Trace ID:</strong> {log.traceId}</div>
              <div><strong>Log ID:</strong> {log.id}</div>
              <div className="log-full-message">
                <strong>Full message:</strong>
                <p>{log.message}</p>
              </div>
            </div>
          )}
        </div>
      ))}

    </div>

    <div className="logs-footer">
      <span>
        Showing {filteredLogs.length} of {logs.length} log entries
      </span>
      <span>Newest first</span>
    </div>
  </div>
</section>

{/* INCIDENT MANAGEMENT */}
<section className="incidents-section" id="incidents">
  <div className="section-heading">
    <div>
      <div className="eyebrow">
        INCIDENT RESPONSE <span className="eyebrow-line" />
      </div>

      <h2>Incident management</h2>

      <p>
        Track, investigate and resolve infrastructure incidents.
      </p>
    </div>

    <div className="incident-heading-actions">
      <div className="logs-live-indicator">
        <span className="period-dot" />
        INCIDENT CENTER
      </div>

      <button
        type="button"
        className="create-incident-button"
        onClick={() => setShowCreateIncident(true)}
      >
        <span>+</span>
        Create incident
      </button>
    </div>
  </div>

  {/* INCIDENT SUMMARY */}
  <div className="incident-summary-grid">
    <article className="metric-card">
      <div className="metric-top">
        <div className="metric-icon red">
          <AlertTriangle size={19} />
        </div>

        <span className="metric-status">
          OPEN
        </span>
      </div>

      <div className="metric-value">
        {openIncidentCount}
      </div>

      <div className="metric-label">
        Open incidents
      </div>

      <div className="metric-subtext">
        Require investigation
      </div>
    </article>

    <article className="metric-card">
      <div className="metric-top">
        <div className="metric-icon yellow">
          <Clock3 size={19} />
        </div>

        <span className="metric-status">
          ACKNOWLEDGED
        </span>
      </div>

      <div className="metric-value">
        {acknowledgedIncidentCount}
      </div>

      <div className="metric-label">
        Acknowledged
      </div>

      <div className="metric-subtext">
        Currently being handled
      </div>
    </article>

    <article className="metric-card">
      <div className="metric-top">
        <div className="metric-icon green">
          <ShieldCheck size={19} />
        </div>

        <span className="metric-status">
          RESOLVED
        </span>
      </div>

      <div className="metric-value">
        {resolvedIncidentCount}
      </div>

      <div className="metric-label">
        Resolved incidents
      </div>

      <div className="metric-subtext">
        Successfully closed
      </div>
    </article>
  </div>

  {/* INCIDENT LIST + DETAILS */}
  <div className="incidents-layout">

    {/* INCIDENT LIST */}
    <article className="panel incidents-list-panel">
      <div className="panel-heading">
  <div>
    <h2>Active and historical incidents</h2>

    <p>
      {filteredIncidents.length} of {incidentsList.length} incidents shown
    </p>
  </div>

  <span className="chart-unit">
    INCIDENT EXPLORER
  </span>
</div>

{/* INCIDENT SEARCH AND FILTERS */}
<div className="incident-filters">

  <div className="incident-search">
    <Search size={16} />

    <input
      type="text"
      placeholder="Search ID, title or service..."
      value={incidentSearch}
      onChange={(event) => setIncidentSearch(event.target.value)}
    />
  </div>

  <select
    className="incident-filter-select"
    value={incidentSeverityFilter}
    onChange={(event) =>
      setIncidentSeverityFilter(event.target.value)
    }
    aria-label="Filter by severity"
  >
    <option value="ALL">All severities</option>
    <option value="CRITICAL">Critical</option>
    <option value="HIGH">High</option>
    <option value="MEDIUM">Medium</option>
    <option value="LOW">Low</option>
  </select>

  <select
    className="incident-filter-select"
    value={incidentStatusFilter}
    onChange={(event) =>
      setIncidentStatusFilter(event.target.value)
    }
    aria-label="Filter by status"
  >
    <option value="ALL">All statuses</option>
    <option value="OPEN">Open</option>
    <option value="ACKNOWLEDGED">Acknowledged</option>
    <option value="RESOLVED">Resolved</option>
  </select>

  <button
    type="button"
    className="incident-clear-filters"
    onClick={() => {
      setIncidentSearch("");
      setIncidentSeverityFilter("ALL");
      setIncidentStatusFilter("ALL");
    }}
  >
    Clear
  </button>

</div>

      {incidentsLoading ? (
        <div className="incident-loading-state">
          <div className="loading-spinner" />
          <p>Loading incidents...</p>
        </div>
      ) : incidentsError ? (
        <div className="incident-error-state">
          <AlertTriangle size={18} />

          <div>
            <strong>Incident data unavailable</strong>

            <p>
              {incidentsError}
            </p>
          </div>
        </div>
      ) : (
        <div className="managed-incident-list">
          {filteredIncidents.map((incident) => (
            <button
              type="button"
              className={`managed-incident-row ${
                selectedIncident === incident.id
                  ? "selected"
                  : ""
              }`}
              key={incident.id}
              onClick={() =>
                setSelectedIncident(incident.id)
              }
            >
              <div
                className={`managed-severity-dot severity-${incident.severity.toLowerCase()}`}
              />

              <div className="managed-incident-copy">
                <div className="managed-incident-meta">
                  <span>{incident.id}</span>
                  <span>·</span>
                  <span>{incident.time}</span>
                </div>

                <strong>
                  {incident.title}
                </strong>

                <span className="managed-incident-service">
                  {incident.service}
                </span>
              </div>

              <div className="managed-incident-right">
                <span
                  className={`severity-label severity-text-${incident.severity.toLowerCase()}`}
                >
                  {incident.severity}
                </span>

                <span
                  className={`incident-status status-${incident.status.toLowerCase()}`}
                >
                  {incident.status}
                </span>
              </div>
            </button>
          ))}

          {filteredIncidents.length === 0 && (
            <div className="incident-no-results">
              <Search size={20} />

              <strong>No incidents found</strong>

              <p>
                Try changing your search or clearing the filters.
              </p>
            </div>
          )}
        </div>
      )}
    </article>

    {/* INCIDENT DETAILS */}
    <article className="panel incident-detail-panel">
      {activeIncident ? (
        <>
          <div className="panel-heading">
            <div>
              <span className="chart-unit">
                INCIDENT DETAILS
              </span>

              <h2>
                {activeIncident.id}
              </h2>
            </div>

            <span
              className={`incident-status status-${activeIncident.status.toLowerCase()}`}
            >
              {activeIncident.status}
            </span>
          </div>

          <div className="incident-detail-content">
            <h3>
              {activeIncident.title}
            </h3>

            <p>
              {activeIncident.description}
            </p>

            <div className="detail-field">
              <span>AFFECTED SERVICE</span>

              <strong>
                {activeIncident.service}
              </strong>
            </div>

            <div className="detail-field">
              <span>SEVERITY</span>

              <strong>
                {activeIncident.severity}
              </strong>
            </div>

            <div className="detail-field">
              <span>REPORTED AT</span>

              <strong>
                {activeIncident.time}
              </strong>
            </div>

            <div className="detail-field">
              <span>ASSIGNED TO</span>

              <strong>
                {activeIncident.assignee}
              </strong>
            </div>

            <div className="incident-actions">

              {activeIncident.status === "OPEN" && (
                <button
                  type="button"
                  className="incident-action-button acknowledge-button"
                  onClick={() =>
                    acknowledgeIncident(
                      activeIncident.id
                    )
                  }
                >
                  Acknowledge incident
                </button>
              )}

              {activeIncident.status !== "RESOLVED" && (
                <button
                  type="button"
                  className="incident-action-button resolve-button"
                  onClick={() =>
                    resolveIncident(
                      activeIncident.id
                    )
                  }
                >
                  <ShieldCheck size={15} />
                  Resolve incident
                </button>
              )}

              {activeIncident.status === "RESOLVED" && (
                <div className="resolved-message">
                  <ShieldCheck size={16} />
                  This incident has been resolved.
                </div>
              )}

            </div>
          </div>
        </>
      ) : (
        <div className="incident-detail-empty">
          <div className="metric-icon blue">
            <AlertTriangle size={20} />
          </div>

          <h3>
            Select an incident
          </h3>

          <p>
            Choose an incident from the list to inspect
            its details and take action.
          </p>
        </div>
      )}
    </article>

  </div>
</section>

{/* FAILURE LAB */}
<section className="failure-lab-section" id="failure-lab">
  <div className="section-heading">
    <div>
      <div className="eyebrow">
        FAILURE SIMULATION <span className="eyebrow-line" />
      </div>

      <h2>Failure Lab</h2>

      <p>
        Safely simulate infrastructure failures and observe LogDock response.
      </p>
    </div>

    <div className="logs-live-indicator">
      <span className="period-dot" />
      CONTROLLED ENVIRONMENT
    </div>
  </div>

  <div className="failure-lab-grid">
    <article className="panel failure-lab-control-panel">
      <div className="panel-heading">
        <div>
          <h2>Service controls</h2>

          <p>
            Trigger controlled stop and recovery events.
          </p>
        </div>

        <span className="chart-unit">
          FAILURE LAB
        </span>
      </div>
<div className="failure-lab-auth">
  <div className="failure-lab-auth-copy">
    <span className="chart-unit">CONTROL ACCESS</span>

    <strong>Failure Lab authorization</strong>

    <p>
      Enter the LogDock API token to enable service controls.
    </p>
  </div>

  {tokenStatus !== "connected" ? (
    <div className="failure-lab-auth-controls">
      <input
        type="password"
        value={tokenInput}
        onChange={(event) => {
          setTokenInput(event.target.value);
          if (tokenStatus === "error") {
            setTokenStatus("disconnected");
          }
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            verifyApiToken();
          }
        }}
        placeholder="Enter API token"
        aria-label="LogDock API token"
        autoComplete="off"
      />

      <button
        type="button"
        className="incident-action-button acknowledge-button"
        onClick={verifyApiToken}
        disabled={
          tokenStatus === "checking" || !tokenInput.trim()
        }
      >
        {tokenStatus === "checking" ? "Checking..." : "Connect"}
      </button>
    </div>
  ) : (
    <div className="failure-lab-auth-connected">
      <span className="incident-status status-resolved">
        AUTHORIZED
      </span>

      <button
        type="button"
        className="incident-action-button resolve-button"
        onClick={disconnectApiToken}
      >
        Disconnect
      </button>
    </div>
  )}

  {tokenStatus === "error" && (
    <span className="failure-lab-auth-error">
      Invalid API token. Access denied.
    </span>
  )}
</div>
      <div className="failure-service-list">
        {["prometheus", "loki", "alloy"].map((serviceName) => {
          const container = dockerContainers.find(
            (item) => item.service === serviceName
          );

          const isRunning = container?.status === "RUNNING";

          return (
            <div
              className="failure-service-row"
              key={serviceName}
            >
              <div className="failure-service-info">
                <div className="failure-service-icon">
                  <Server size={17} />
                </div>

                <div>
                  <strong>{serviceName}</strong>

                  <span>
                    {container?.name ?? "Container unavailable"}
                  </span>
                </div>
              </div>

              <div className="failure-service-status">
                <span
                  className={`incident-status ${
                    isRunning
                      ? "status-resolved"
                      : "status-open"
                  }`}
                >
                  {isRunning ? "RUNNING" : "STOPPED"}
                </span>
              </div>

              <div className="failure-service-actions">
                <button
                  type="button"
                  className="incident-action-button resolve-button"
                  disabled={!isRunning || tokenStatus !== "connected"}
                  onClick={async () => {
                    try {
                      const response = await fetch(
                        `${API_BASE_URL}/api/failure-lab/${serviceName}/stop`,
                        {
                          method: "POST",
                          headers: {
                            "X-API-Token": apiToken,
                          },
                        }
                      );

                      if (!response.ok) {
                        throw new Error("Failed to stop service.");
                      }

                      await fetchDockerContainers();
                      await fetchIncidents();
                    } catch (error) {
                      console.error(
                        "Failure Lab stop error:",
                        error
                      );

                      setIncidentsError(
                        `Unable to stop ${serviceName}.`
                      );
                    }
                  }}
                >
                  Stop
                </button>

                <button
                  type="button"
                  className="incident-action-button acknowledge-button"
                  disabled={isRunning || tokenStatus !== "connected"}
                  onClick={async () => {
                    try {
                      const response = await fetch(
                        `${API_BASE_URL}/api/failure-lab/${serviceName}/start`,
                        {
                          method: "POST",
                          headers: {
                            "X-API-Token": apiToken,
                          },
                        }
                      );

                      if (!response.ok) {
                        throw new Error("Failed to start service.");
                      }

                      await fetchDockerContainers();
                      await fetchIncidents();
                    } catch (error) {
                      console.error(
                        "Failure Lab start error:",
                        error
                      );

                      setIncidentsError(
                        `Unable to start ${serviceName}.`
                      );
                    }
                  }}
                >
                  Start
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </article>

    <article className="panel failure-lab-info-panel">
      <div className="panel-heading">
        <div>
          <span className="chart-unit">
            OBSERVABILITY WORKFLOW
          </span>

          <h2>What happens when you trigger a failure?</h2>
        </div>
      </div>

      <div className="failure-workflow">
        <div className="failure-workflow-step">
          <span>01</span>

          <div>
            <strong>Simulate</strong>

            <p>
              Stop an approved LogDock service using the controlled
              Failure Lab interface.
            </p>
          </div>
        </div>

        <div className="failure-workflow-line" />

        <div className="failure-workflow-step">
          <span>02</span>

          <div>
            <strong>Detect</strong>

            <p>
              The backend monitoring loop detects the container failure
              independently of the dashboard.
            </p>
          </div>
        </div>

        <div className="failure-workflow-line" />

        <div className="failure-workflow-step">
          <span>03</span>

          <div>
            <strong>Respond</strong>

            <p>
              LogDock creates an incident and surfaces it in the
              Incident Center.
            </p>
          </div>
        </div>

        <div className="failure-workflow-line" />

        <div className="failure-workflow-step">
          <span>04</span>

          <div>
            <strong>Recover</strong>

            <p>
              Restart the service and observe the incident transition
              to RESOLVED automatically.
            </p>
          </div>
        </div>
      </div>
    </article>
  </div>
</section>

{/* CREATE INCIDENT MODAL */}
{showCreateIncident && (
  <div
    className="incident-modal-backdrop"
    onClick={() => setShowCreateIncident(false)}
  >
    <div
      className="incident-modal"
      onClick={(event) => event.stopPropagation()}
    >
      <div className="incident-modal-header">
        <div>
          <span className="chart-unit">
            INCIDENT RESPONSE
          </span>

          <h2>Create incident</h2>

          <p>
            Create a new incident for investigation and response.
          </p>
        </div>

        <button
          type="button"
          className="incident-modal-close"
          onClick={() => setShowCreateIncident(false)}
          aria-label="Close create incident dialog"
        >
          ×
        </button>
      </div>

      <div className="incident-form">

        <div className="incident-form-field">
          <label htmlFor="incident-title">
            Incident title
          </label>

          <input
            id="incident-title"
            type="text"
            placeholder="e.g. API gateway latency spike"
            value={newIncident.title}
            onChange={(event) =>
              setNewIncident((current) => ({
                ...current,
                title: event.target.value,
              }))
            }
          />
        </div>

        <div className="incident-form-grid">

          <div className="incident-form-field">
            <label htmlFor="incident-service">
              Affected service
            </label>

            <select
              id="incident-service"
              value={newIncident.service}
              onChange={(event) =>
                setNewIncident((current) => ({
                  ...current,
                  service: event.target.value,
                }))
              }
            >
              <option value="api-gateway">
                api-gateway
              </option>

              <option value="database">
                database
              </option>

              <option value="payment-service">
                payment-service
              </option>

              <option value="worker">
                worker
              </option>
            </select>
          </div>

          <div className="incident-form-field">
            <label htmlFor="incident-severity">
              Severity
            </label>

            <select
              id="incident-severity"
              value={newIncident.severity}
              onChange={(event) =>
                setNewIncident((current) => ({
                  ...current,
                  severity: event.target.value,
                }))
              }
            >
              <option value="CRITICAL">
                CRITICAL
              </option>

              <option value="HIGH">
                HIGH
              </option>

              <option value="MEDIUM">
                MEDIUM
              </option>

              <option value="LOW">
                LOW
              </option>
            </select>
          </div>

        </div>

        <div className="incident-form-field">
          <label htmlFor="incident-assignee">
            Assignee
          </label>

          <input
            id="incident-assignee"
            type="text"
            placeholder="e.g. Operations"
            value={newIncident.assignee}
            onChange={(event) =>
              setNewIncident((current) => ({
                ...current,
                assignee: event.target.value,
              }))
            }
          />
        </div>

        <div className="incident-form-field">
          <label htmlFor="incident-description">
            Description
          </label>

          <textarea
            id="incident-description"
            rows={5}
            placeholder="Describe what happened, what is affected, and any useful investigation context."
            value={newIncident.description}
            onChange={(event) =>
              setNewIncident((current) => ({
                ...current,
                description: event.target.value,
              }))
            }
          />
        </div>

        <div className="incident-modal-actions">
          <button
            type="button"
            className="incident-cancel-button"
            onClick={() => setShowCreateIncident(false)}
          >
            Cancel
          </button>

          <button
            type="button"
            className="incident-submit-button"
            onClick={createIncident}
            disabled={creatingIncident}
          >
            {creatingIncident
              ? "Creating incident..."
              : "Create incident"}
          </button>
        </div>

      </div>
    </div>
  </div>
)}

<footer className="dashboard-footer">
            <span>LOGDOCK <span className="footer-version">v0.1.0</span></span>
            <span>Built for clarity. Designed for reliability.</span>
            <span><span className="live-dot" /> All systems monitored</span>
          </footer>
        </div>
      </main>
    </div>
  );
}

export default App;
