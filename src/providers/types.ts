export interface RuntimeInfo {
  name: string;
  version: string;
  path: string;
}

export interface RuntimeProvider {
  readonly name: string;
  readonly priority: number;
  detect(): Promise<boolean>;
  current(): Promise<RuntimeInfo | null>;
  install(version: string): Promise<void>;
  use(version: string): Promise<void>;
}

export interface ProxyConfig {
  domain: string;
  port: number;
  ssl: boolean;
}

export interface ProxyProvider {
  readonly name: string;
  readonly priority: number;
  detect(): Promise<boolean>;
  register(config: ProxyConfig): Promise<void>;
  unregister(domain: string): Promise<void>;
  reload(): Promise<void>;
}

export interface HostsProvider {
  add(domain: string, ip?: string): Promise<void>;
  remove(domain: string): Promise<void>;
  has(domain: string): Promise<boolean>;
}

export interface ServiceProvider {
  start(service: string): Promise<void>;
  stop(service: string): Promise<void>;
  restart(service: string): Promise<void>;
  status(service: string): Promise<"running" | "stopped" | "unknown">;
}

export interface FrameworkInfo {
  name: string;
  language: string;
  version: string;
  port: number;
  configFiles: string[];
}

export interface PackageManager {
  name: string;
  command: string;
  lockfile: string;
}

export interface ProviderManifest {
  type: "proxy" | "runtime" | "hosts" | "service";
  name: string;
  priority: number;
}

export interface ProcessProvider {
  readonly name: string;
  detect(): Promise<boolean>;
  start(name: string, command: string, args: string[], env?: Record<string, string>): Promise<number>;
  stop(name: string): Promise<void>;
  delete(name: string): Promise<void>;
  restart(name: string): Promise<void>;
  list(): Promise<Array<{ name: string; pid: number; status: string; port?: number }>>;
  logs(name: string, lines: number): Promise<string>;
}
