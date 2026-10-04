import { getProject, setProjectStopped, isProcessAlive } from "../state/store.js";
import { writeLog } from "./logger-file.js";
import { spawn } from "node:child_process";
import { resolve, basename } from "node:path";
import { readFile } from "node:fs/promises";
import { loadConfig } from "../config/loader.js";
import { detectFramework } from "../detection/framework.js";
import { selectDevPort, ensurePortAvailable } from "../deployment/dev-port.js";

const MAX_RESTART_ATTEMPTS = 3;
const RESTART_DELAY_MS = 2000;
const HEALTH_CHECK_INTERVAL_MS = 10000;

interface HealthMonitorOptions {
  maxRestarts?: number;
  restartDelay?: number;
  healthCheckInterval?: number;
}

export class HealthMonitor {
  private monitors: Map<string, NodeJS.Timeout> = new Map();
  private restartAttempts: Map<string, number> = new Map();
  private options: Required<HealthMonitorOptions>;

  constructor(options?: HealthMonitorOptions) {
    this.options = {
      maxRestarts: options?.maxRestarts ?? MAX_RESTART_ATTEMPTS,
      restartDelay: options?.restartDelay ?? RESTART_DELAY_MS,
      healthCheckInterval: options?.healthCheckInterval ?? HEALTH_CHECK_INTERVAL_MS,
    };
  }

  /**
   * Start monitoring a project's process.
   */
  startMonitoring(projectPath: string): void {
    if (this.monitors.has(projectPath)) {
      return; // Already monitoring
    }

    const interval = setInterval(async () => {
      await this.checkHealth(projectPath);
    }, this.options.healthCheckInterval);

    this.monitors.set(projectPath, interval);
    this.restartAttempts.set(projectPath, 0);
  }

  /**
   * Stop monitoring a project.
   */
  stopMonitoring(projectPath: string): void {
    const interval = this.monitors.get(projectPath);
    if (interval) {
      clearInterval(interval);
      this.monitors.delete(projectPath);
      this.restartAttempts.delete(projectPath);
    }
  }

  /**
   * Stop all monitoring.
   */
  stopAll(): void {
    for (const [, interval] of this.monitors) {
      clearInterval(interval);
    }
    this.monitors.clear();
    this.restartAttempts.clear();
  }

  /**
   * Check health of a monitored project.
   */
  private async checkHealth(projectPath: string): Promise<void> {
    const project = await getProject(projectPath);
    if (!project || !project.pid) {
      this.stopMonitoring(projectPath);
      return;
    }

    const isAlive = await isProcessAlive(project.pid);
    if (!isAlive) {
      await this.handleProcessDeath(projectPath, project.pid);
    }
  }

  /**
   * Handle process death - attempt restart.
   */
  private async handleProcessDeath(projectPath: string, deadPid: number): Promise<void> {
    const project = await getProject(projectPath);
    if (!project) return;

    const attempts = this.restartAttempts.get(projectPath) || 0;

    // Log the crash
    const projectName = project.name;
    writeLog(projectPath, projectName, {
      timestamp: new Date(),
      stream: "stderr",
      message: `[Process ${deadPid} exited unexpectedly]`,
    });

    // Clear stale PID
    await setProjectStopped(projectPath);

    // Check restart limit
    if (attempts >= this.options.maxRestarts) {
      writeLog(projectPath, projectName, {
        timestamp: new Date(),
        stream: "stderr",
        message: `[Max restart attempts (${this.options.maxRestarts}) reached. Manual restart required.]`,
      });
      this.stopMonitoring(projectPath);
      return;
    }

    // Attempt restart
    this.restartAttempts.set(projectPath, attempts + 1);

    writeLog(projectPath, projectName, {
      timestamp: new Date(),
      stream: "stdout",
      message: `[Attempting restart (attempt ${attempts + 1}/${this.options.maxRestarts})]`,
    });

    setTimeout(async () => {
      await this.restartProcess(projectPath);
    }, this.options.restartDelay);
  }

  /**
   * Restart a project's process.
   */
  private async restartProcess(projectPath: string): Promise<void> {
    try {
      const config = await loadConfig(projectPath);

      // Registered state is the authority for the project's name and port. Using
      // only the config meant an absent or invalid .orkestra.yml silently renamed
      // the project to its directory basename and moved it off its recorded port.
      const state = await getProject(projectPath);
      const projectName = state?.name || config?.name || basename(projectPath);

      // Detect framework
      const framework = await detectFramework(projectPath);
      if (!framework) {
        writeLog(projectPath, projectName, {
          timestamp: new Date(),
          stream: "stderr",
          message: `[Restart failed: Cannot detect framework]`,
        });
        return;
      }

      // Get start command
      const command = await getStartCommand(projectPath, framework.name, config);
      if (!command) {
        writeLog(projectPath, projectName, {
          timestamp: new Date(),
          stream: "stderr",
          message: `[Restart failed: Cannot determine start command]`,
        });
        return;
      }

      // Resolve the port for the restart.
      //
      // This must agree exactly with what `orkestra up` decided, or a restart
      // moves the app and Caddy keeps proxying to where it used to be. It did
      // disagree: up() consulted the port recorded in orkestra's state, this used
      // only `config?.port || framework.port`. For a project whose .orkestra.yml
      // omits `port` — normal once freezeAgainstState has put the deployed port in
      // state — up() served the state port and the monitor restarted onto the
      // framework default.
      //
      // Both now call selectDevPort()/ensurePortAvailable() from
      // deployment/dev-port.ts, so the precedence cannot drift apart again.
      const portDecision = await ensurePortAvailable(
        selectDevPort({
          configPort: config?.port,
          statePort: state?.port,
          frameworkPort: framework.port,
        }),
        projectPath,
      );
      const port = portDecision.port;

      if (portDecision.moved) {
        // The old comment here claimed the port was preserved, but nothing
        // re-pointed Caddy, so a moved restart left the proxy aimed at a dead
        // port. Say so plainly rather than failing silently.
        writeLog(projectPath, projectName, {
          timestamp: new Date(),
          stream: "stderr",
          message:
            `[Restart] Port ${portDecision.requestedPort} is held by another process; ` +
            `restarting on ${port}. Any proxy still pointing at ` +
            `${portDecision.requestedPort} will now return 502.`,
        });
      }

      // Spawn process
      const child = spawn(command.cmd, command.args, {
        cwd: projectPath,
        stdio: "pipe",
        detached: true,
        env: {
          ...process.env,
          PORT: String(port),
        },
      });

      child.unref();

      // Capture logs
      child.stdout?.on("data", (data: Buffer) => {
        const lines = data.toString().split("\n").filter(Boolean);
        for (const line of lines) {
          writeLog(projectPath, projectName, {
            timestamp: new Date(),
            stream: "stdout",
            message: line,
          });
        }
      });

      child.stderr?.on("data", (data: Buffer) => {
        const lines = data.toString().split("\n").filter(Boolean);
        for (const line of lines) {
          writeLog(projectPath, projectName, {
            timestamp: new Date(),
            stream: "stderr",
            message: line,
          });
        }
      });

      // Update state
      const { setProjectRunning } = await import("../state/store.js");
      await setProjectRunning(projectPath, child.pid!);

      writeLog(projectPath, projectName, {
        timestamp: new Date(),
        stream: "stdout",
        message: `[Process restarted with PID ${child.pid}]`,
      });

      // Reset restart attempts on successful start
      this.restartAttempts.set(projectPath, 0);

    } catch (error) {
      writeLog(projectPath, basename(projectPath), {
        timestamp: new Date(),
        stream: "stderr",
        message: `[Restart failed: ${error}]`,
      });
    }
  }

  /**
   * Get list of monitored projects.
   */
  getMonitored(): string[] {
    return Array.from(this.monitors.keys());
  }
}

// Helper function to get start command (same as in up.ts)
async function getStartCommand(
  dir: string,
  frameworkName: string,
  config?: any
): Promise<{ cmd: string; args: string[] } | null> {
  if (config?.startCommand) {
    const parts = config.startCommand.split(/\s+/);
    return { cmd: parts[0], args: parts.slice(1) };
  }

  if (["node.js", "next.js", "nuxt", "express", "fastify", "vite", "remix", "astro", "sveltekit"].includes(frameworkName)) {
    try {
      const pkg = JSON.parse(await readFile(resolve(dir, "package.json"), "utf-8"));
      const scripts = pkg.scripts || {};

      if (scripts.dev) {
        const parts = scripts.dev.split(/\s+/);
        return { cmd: parts[0], args: parts.slice(1) };
      }
      if (scripts.start) {
        const parts = scripts.start.split(/\s+/);
        return { cmd: parts[0], args: parts.slice(1) };
      }
    } catch {}
  }

  if (frameworkName === "laravel") {
    try {
      const composer = JSON.parse(await readFile(resolve(dir, "composer.json"), "utf-8"));
      const serveScript = composer.scripts?.serve;
      if (serveScript) {
        const parts = serveScript.split(/\s+/);
        return { cmd: parts[0], args: parts.slice(1) };
      }
    } catch {}
  }

  if (frameworkName === "go") return { cmd: "go", args: ["run", "."] };
  if (frameworkName === "rust") return { cmd: "cargo", args: ["run"] };

  if (frameworkName === "fastapi") return { cmd: "uvicorn", args: ["main:app", "--reload"] };
  if (frameworkName === "flask") return { cmd: "flask", args: ["run"] };
  if (frameworkName === "django") return { cmd: "python", args: ["manage.py", "runserver"] };

  return null;
}

// Singleton instance
export const healthMonitor = new HealthMonitor();
