/**
 * A runtime/toolchain manager that Orkestra can detect.
 *
 * Deliberately presence-only. `current()`, `install()` and `use()` were
 * declared here and implemented by all six providers, but nothing ever called
 * them — and the mise implementation was not merely unused but wrong
 * (`mise current --json` is not a valid command, and `install()` hardcoded
 * `node@`, so a PHP request would have run `mise install node@8.4`).
 *
 * The mise integration that does run is `resolveBinaries` in
 * `services/mise-resolver.ts`, built on `mise which` and `mise trust`.
 * Reintroducing version reporting should start from `mise ls --current --json`,
 * which returns an object keyed by tool name rather than a single record.
 */
export interface RuntimeProvider {
  readonly name: string;
  readonly priority: number;
  detect(): Promise<boolean>;
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
