export interface SystemMetrics {
  cpuPercent: number;
  memory: {
    totalMb: number;
    usedMb: number;
    freeMb: number;
    percent: number;
  };
  disk: {
    totalGb: number;
    usedGb: number;
    freeGb: number;
    percent: number;
  };
  loadAverage: [number, number, number];
  uptime: string;
}

export interface ServiceProcessMetrics {
  name: string;
  serviceName: string;
  type: string;
  status: "running" | "stopped" | "failed" | "inactive" | "unknown";
  pid?: number;
  memoryMb?: number;
  restarts?: number;
  uptime?: string;
  crashLoopDetected?: boolean;
}

export interface ProjectMonitoringData {
  project: string;
  path: string;
  domain?: string;
  port?: number;
  framework: string;
  services: ServiceProcessMetrics[];
}

export interface InfrastructureStatus {
  caddy: string;
  redis: string;
  postgresql: string;
  mysql: string;
}

export interface MonitoringSnapshot {
  timestamp: string;
  system: SystemMetrics;
  infrastructure: InfrastructureStatus;
  applications: ProjectMonitoringData[];
}
