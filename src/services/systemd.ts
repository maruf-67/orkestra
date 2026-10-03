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

/**
 * Double every literal `%` so systemd does not read it as a specifier.
 *
 * A project path such as `/srv/apps/100%-coverage/api` would otherwise produce
 * a unit that systemd refuses to parse, and the failure surfaces as an opaque
 * `systemctl daemon-reload` error rather than anything about the path.
 */
export function escapeSystemdSpecifiers(content: string): string {
  return content.replace(/%/g, "%%");
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const DEFAULT_TEMPLATES: Record<ServiceType, string> = {
  web: `[Unit]
Description=Orkestra Web ({{PROJECT_NAME}})
After=network-online.target
Wants=network-online.target

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
After=network-online.target
Wants=network-online.target

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
After=network-online.target
Wants=network-online.target

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
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
`,
  reverb: `[Unit]
Description=Orkestra Laravel Reverb WebSocket ({{PROJECT_NAME}})
After=network-online.target
Wants=network-online.target

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

  renderTemplate(content: string, vars: Record<string, string | number | undefined>): string {
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

    const rawContent = this.renderTemplate(templateContent, vars);
    // systemd treats `%` as a specifier introducer, so a literal `%` in a path
    // or value makes the unit fail to parse. Escaping has to happen after
    // templating, otherwise the `%%` produced here would be re-escaped.
    const unitContent = escapeSystemdSpecifiers(rawContent);
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

  /**
   * Restart a unit and confirm it actually stayed up.
   *
   * `systemctl restart` succeeds as soon as the unit is started, which for
   * `Type=simple` means the process was forked. With `Restart=always` and
   * `RestartSec=3s`, a unit that dies immediately loops forever while still
   * reporting a successful restart. Deploys therefore used to claim services
   * were "restarted" while they were crash-looping.
   *
   * The unit must be active at the *end* of the settle window, not merely on the
   * first poll: a service that starts and dies a moment later is still broken.
   * A `failed` state short-circuits so a bad unit is reported immediately.
   */
  async restartAndVerify(
    serviceName: string,
    settleMs = 2000,
  ): Promise<"active" | "failed" | "inactive"> {
    return (await this.restartManyAndVerify([serviceName], settleMs))[0];
  }

  /**
   * Restart several units, then verify them together.
   *
   * Restarting first and settling once keeps the added latency to a single
   * window instead of one per service, which matters when a Laravel deploy
   * brings up web, queue and Reverb together.
   */
  async restartManyAndVerify(
    serviceNames: string[],
    settleMs = 2000,
  ): Promise<Array<"active" | "failed" | "inactive">> {
    for (const name of serviceNames) {
      await this.restart(name);
    }
    if (serviceNames.length === 0) return [];

    const deadline = Date.now() + settleMs;
    const states = new Map<string, "active" | "failed" | "inactive">();

    do {
      await sleep(500);
      for (const name of serviceNames) {
        // Re-checked every tick: the last reading before the deadline wins.
        const res = await run("systemctl", ["is-active", name]);
        const raw = res.stdout.trim();
        const state: "active" | "failed" | "inactive" =
          raw === "active" ? "active" : raw === "failed" ? "failed" : "inactive";
        states.set(name, state);
      }
      // Fail fast rather than waiting out the window on a unit already failed.
      if ([...states.values()].includes("failed")) break;
    } while (Date.now() < deadline);

    return serviceNames.map(
      (name) => states.get(name) ?? "inactive",
    );
  }

  /** Recent journal lines for a unit, used to explain a failed start. */
  async journal(serviceName: string, lines = 15): Promise<string> {
    if (!isLinux()) return "";
    const res = await run("journalctl", [
      "-u",
      serviceName,
      "-n",
      String(lines),
      "--no-pager",
    ]);
    return `${res.stdout || res.stderr || ""}`.trim();
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
