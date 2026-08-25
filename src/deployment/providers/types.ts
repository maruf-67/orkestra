import type { OrkestraConfig } from "../../config/schema.js";
import type { DeploymentOptions } from "../types.js";
import type { ResolvedBinaries } from "../../services/mise-resolver.js";
import type { ServiceType } from "../../services/systemd.js";

export interface DeploymentContext {
  projectDir: string;
  projectName: string;
  branch: string;
  config?: OrkestraConfig | null;
  binaries: ResolvedBinaries;
  options: DeploymentOptions;
}

export interface ApplicationDetection {
  name: string;
  framework: string;
  version?: string;
  language: "php" | "javascript" | "typescript" | "python" | "go" | "rust";
  packageManager: "pnpm" | "bun" | "yarn" | "npm" | "composer";
  runtime: "node" | "bun" | "php";
  defaultPort: number;
  buildCommand?: string;
  startCommand?: string;
  capabilities: Record<string, any>;
}

export interface ServiceDefinition {
  name: string;
  type: ServiceType;
  port?: number;
  command?: string;
  env?: Record<string, string>;
  maxRequests?: number;
  queueConnection?: string;
  queues?: string;
}

export interface ProxyDefinition {
  domain: string;
  port: number;
  ssl?: boolean;
  websocket?: boolean;
}

export interface HealthCheckDefinition {
  apiUrl?: string;
  port?: number;
  domain?: string;
  expectedStatus?: number;
  timeoutMs?: number;
}

export interface ApplicationProvider {
  readonly name: string;
  readonly framework: string;

  detect(dir: string): Promise<ApplicationDetection | null>;
  installDependencies(context: DeploymentContext): Promise<{ durationMs: number; output: string }>;
  build(context: DeploymentContext): Promise<{ durationMs: number; output: string }>;
  prepare(context: DeploymentContext): Promise<{ output?: string }>;
  services(context: DeploymentContext, detection: ApplicationDetection): Promise<ServiceDefinition[]>;
  proxy(context: DeploymentContext, detection: ApplicationDetection): Promise<ProxyDefinition[]>;
  healthChecks(context: DeploymentContext, detection: ApplicationDetection): Promise<HealthCheckDefinition[]>;
  rollback(context: DeploymentContext): Promise<void>;
}
