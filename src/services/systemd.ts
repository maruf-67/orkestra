import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { run, sudoWriteFile } from "../utils/exec.js";
import { isLinux } from "../platform/index.js";
import { userInfo } from "node:os";

export interface SystemdServiceOptions {
  projectName: string;
  projectPath: string;
  user?: string;
  group?: string;
  phpBinary?: string;
  nodeBinary?: string;
  bunBinary?: string;
  execStart?: string;
  port?: number;
  octaneServer?: string;
  octanePort?: number;
  maxRequests?: number;
  queueConnection?: string;
  queues?: string;
  sleep?: number;
  tries?: number;
  timeout?: number;
  maxJobs?: number;
  maxTime?: number;
  reverbPort?: number;
}

export type ServiceType = "web" | "octane" | "queue" | "reverb";

const DEFAULT_TEMPLATES: Record<ServiceType, string> = {
  web: `[Unit]
Description=Orkestra Web ({{PROJECT_NAME}})
After=network.target
Wants=network.target

[Service]
Type=simple
User={{USER}}
Group={{GROUP}}
WorkingDirectory={{PROJECT_PATH}}
EnvironmentFile=-{{PROJECT_PATH}}/.env
Environment=PORT={{PORT}}
Environment=NODE_ENV=production
Environment=HOST=127.0.0.1

ExecStart={{EXEC_START}}

Restart=always
RestartSec=3s
KillMode=mixed
TimeoutStopSec=10s
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
`,
  octane: `[Unit]
Description=Orkestra Laravel Octane ({{PROJECT_NAME}})
After=network.target
Wants=network.target

[Service]
Type=simple
User={{USER}}
Group={{GROUP}}
WorkingDirectory={{PROJECT_PATH}}
EnvironmentFile=-{{PROJECT_PATH}}/.env

ExecStart={{PHP_BIN}} artisan octane:start --server={{OCTANE_SERVER}} --host=127.0.0.1 --port={{OCTANE_PORT}} --max-requests={{MAX_REQUESTS}} --no-interaction
ExecReload={{PHP_BIN}} artisan octane:reload

Restart=always
RestartSec=3s
KillMode=mixed
TimeoutStopSec=10s
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
`,
  queue: `[Unit]
Description=Orkestra Laravel Queue Worker ({{PROJECT_NAME}})
After=network.target
Wants=network.target

[Service]
Type=simple
User={{USER}}
Group={{GROUP}}
WorkingDirectory={{PROJECT_PATH}}
EnvironmentFile=-{{PROJECT_PATH}}/.env

ExecStart={{PHP_BIN}} artisan queue:work {{QUEUE_CONNECTION}} --queue={{QUEUES}} --sleep={{SLEEP}} --tries={{TRIES}} --timeout={{TIMEOUT}} --max-jobs={{MAX_JOBS}} --max-time={{MAX_TIME}} --no-interaction

Restart=always
RestartSec=5s
KillMode=process
TimeoutStopSec=90s

[Install]
WantedBy=multi-user.target
`,
  reverb: `[Unit]
Description=Orkestra Laravel Reverb WebSocket ({{PROJECT_NAME}})
After=network.target
Wants=network.target

[Service]
Type=simple
User={{USER}}
Group={{GROUP}}
WorkingDirectory={{PROJECT_PATH}}
EnvironmentFile=-{{PROJECT_PATH}}/.env

ExecStart={{PHP_BIN}} artisan reverb:start --host=127.0.0.1 --port={{REVERB_PORT}} --no-interaction

Restart=always
RestartSec=3s
KillMode=process
TimeoutStopSec=10s
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
`,
};

export class SystemdManager {
  getServiceName(projectName: string, type: ServiceType): string {
    const cleanName = projectName.toLowerCase().replace(/[^a-z0-9_-]/g, "-");
    return `orkestra-${cleanName}-${type}.service`;
  }

  private renderTemplate(content: string, vars: Record<string, string | number>): string {
    let result = content;
    for (const [key, val] of Object.entries(vars)) {
      const regex = new RegExp(`\\{\\{${key}\\}\\}`, "g");
      result = result.replace(regex, String(val));
    }
    return result;
  }

  async installService(
    type: ServiceType,
    templatePath: string | undefined,
    options: SystemdServiceOptions
  ): Promise<string> {
    const user = options.user || userInfo().username || "www-data";
    const group = options.group || user;

    let templateContent = DEFAULT_TEMPLATES[type];
    if (templatePath && existsSync(templatePath)) {
      try {
        templateContent = await readFile(templatePath, "utf-8");
      } catch {}
    }

    const vars: Record<string, string | number> = {
      PROJECT_NAME: options.projectName,
      PROJECT_PATH: options.projectPath,
      USER: user,
      GROUP: group,
      PORT: options.port || 3000,
      EXEC_START: options.execStart || `${options.nodeBinary || "node"} server.js`,
      PHP_BIN: options.phpBinary || "php",
      OCTANE_SERVER: options.octaneServer || "roadrunner",
      OCTANE_PORT: options.octanePort || options.port || 8000,
      MAX_REQUESTS: options.maxRequests || 500,
      QUEUE_CONNECTION: options.queueConnection || "redis",
      QUEUES: options.queues || "default",
      SLEEP: options.sleep ?? 3,
      TRIES: options.tries ?? 3,
      TIMEOUT: options.timeout ?? 90,
      MAX_JOBS: options.maxJobs ?? 500,
      MAX_TIME: options.maxTime ?? 3600,
      REVERB_PORT: options.reverbPort || 8080,
    };

    const unitContent = this.renderTemplate(templateContent, vars);
    const serviceName = this.getServiceName(options.projectName, type);
    const unitPath = join("/etc/systemd/system", serviceName);

    if (isLinux()) {
      await sudoWriteFile(unitPath, unitContent);
      await this.daemonReload();
      await this.enable(serviceName);
    }

    return serviceName;
  }

  async daemonReload(): Promise<void> {
    if (!isLinux()) return;
    await run("systemctl", ["daemon-reload"], { sudo: true });
  }

  async enable(serviceName: string): Promise<void> {
    if (!isLinux()) return;
    await run("systemctl", ["enable", serviceName], { sudo: true });
  }

  async start(serviceName: string): Promise<void> {
    if (!isLinux()) return;
    const res = await run("systemctl", ["start", serviceName], { sudo: true });
    if (res.exitCode !== 0) {
      throw new Error(`Failed to start ${serviceName}: ${res.stderr || res.stdout}`);
    }
  }

  async restart(serviceName: string): Promise<void> {
    if (!isLinux()) return;
    const res = await run("systemctl", ["restart", serviceName], { sudo: true });
    if (res.exitCode !== 0) {
      throw new Error(`Failed to restart ${serviceName}: ${res.stderr || res.stdout}`);
    }
  }

  async reload(serviceName: string): Promise<void> {
    if (!isLinux()) return;
    const res = await run("systemctl", ["reload-or-restart", serviceName], { sudo: true });
    if (res.exitCode !== 0) {
      await this.restart(serviceName);
    }
  }

  async stop(serviceName: string): Promise<void> {
    if (!isLinux()) return;
    await run("systemctl", ["stop", serviceName], { sudo: true });
  }

  async isActive(serviceName: string): Promise<boolean> {
    if (!isLinux()) return true;
    const res = await run("systemctl", ["is-active", serviceName]);
    return res.stdout.trim() === "active";
  }

  async getStatus(serviceName: string): Promise<"running" | "stopped" | "failed" | "inactive" | "unknown"> {
    if (!isLinux()) return "unknown";
    const res = await run("systemctl", ["is-active", serviceName]);
    const state = res.stdout.trim();
    if (state === "active") return "running";
    if (state === "failed") return "failed";
    if (state === "inactive") return "stopped";
    return "unknown";
  }

  getServiceNameFor(projectName: string, type: ServiceType): string {
    return this.getServiceName(projectName, type);
  }
}

export const systemd = new SystemdManager();
