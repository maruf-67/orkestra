
export interface ProjectCapabilities {
  isLaravel: boolean;
  laravelVersion?: string;
  hasOctane: boolean;
  octaneServer: "roadrunner" | "swoole" | "frankenphp" | "none";
  hasReverb: boolean;
  hasQueue: boolean;
  queueConnection: string;
  hasCaddy: boolean;
  hasMise: boolean;
  phpBinary?: string;
  composerBinary?: string;
}

export interface DeploymentOptions {
  dir?: string;
  branch?: string;
  strategy?: "reset" | "pull";
  dryRun?: boolean;
  noMigrate?: boolean;
  noRestart?: boolean;
  force?: boolean;
  remote?: string;
  yes?: boolean;
}

export interface DeploymentStep {
  name: string;
  description: string;
  status: "pending" | "running" | "success" | "skipped" | "failed";
  durationMs?: number;
  error?: string;
}

export interface DeploymentReport {
  projectName: string;
  projectPath: string;
  branch: string;
  commit: string;
  previousCommit?: string;
  startedAt: string;
  finishedAt?: string;
  durationSeconds: number;
  status: "success" | "failed" | "aborted";
  steps: DeploymentStep[];
  capabilities: ProjectCapabilities;
  services: {
    octane?: "started" | "restarted" | "reloaded" | "skipped" | "failed";
    queue?: "started" | "restarted" | "skipped" | "failed";
    reverb?: "started" | "restarted" | "skipped" | "failed";
  };
  proxy: {
    apiDomain?: string;
    apiPort?: number;
    reverbDomain?: string;
    reverbPort?: number;
    status: "configured" | "skipped" | "failed";
  };
  health: {
    apiCheck?: { url: string; status: "healthy" | "unhealthy"; code?: number };
    reverbCheck?: { domain: string; status: "healthy" | "unhealthy" };
    servicesCheck?: { allActive: boolean; details: Record<string, boolean> };
  };
  error?: string;
}

export interface DeploymentHistoryRecord {
  id: string;
  projectName: string;
  projectPath: string;
  branch: string;
  commit: string;
  previousCommit?: string;
  timestamp: string;
  status: "success" | "failed" | "rolled_back";
  durationSeconds: number;
}
