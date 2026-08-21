import { spawn, ChildProcess } from "node:child_process";
import { writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { ShareProvider, ShareOptions, ShareSession, ShareStatus } from "./types.js";
import { isCommandAvailable, run } from "../../utils/exec.js";
import { isWindows } from "../../platform/index.js";

export class LocalTunnelShare implements ShareProvider {
  readonly name = "localtunnel";
  readonly priority = 100;

  async detect(): Promise<boolean> {
    return isCommandAvailable("lt");
  }

  async start(options: ShareOptions): Promise<ShareSession> {
    const logDir = join(homedir(), ".orkestra", "shares");
    const logFile = join(logDir, `${options.projectName}.log`);

    if (!existsSync(logDir)) {
      await mkdir(logDir, { recursive: true });
    }

    // Clear old log file
    if (existsSync(logFile)) {
      await writeFile(logFile, "", "utf-8");
    }

    // Start localtunnel process
    const child = spawn("lt", [
      "--port", String(options.port),
      "--subdomain", options.projectName,
    ], {
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });

    child.unref();

    // Wait for URL to appear
    const publicUrl = await this.waitForUrl(child, 30000);

    if (!publicUrl) {
      throw new Error("Failed to get localtunnel URL");
    }

    return {
      provider: this.name,
      publicUrl,
      localUrl: `http://localhost:${options.port}`,
      pid: child.pid!,
      startedAt: new Date(),
      logFile,
    };
  }

  private async waitForUrl(child: ChildProcess, timeout: number): Promise<string | null> {
    return new Promise((resolve) => {
      let output = "";

      child.stdout?.on("data", (data: Buffer) => {
        output += data.toString();
        const url = this.extractUrl(output);
        if (url) {
          resolve(url);
        }
      });

      child.stderr?.on("data", (data: Buffer) => {
        output += data.toString();
        const url = this.extractUrl(output);
        if (url) {
          resolve(url);
        }
      });

      setTimeout(() => {
        resolve(null);
      }, timeout);
    });
  }

  private extractUrl(output: string): string | null {
    // Match localtunnel URL pattern
    const match = output.match(/https?:\/\/[a-z0-9-]+\.loca\.lt/);
    return match ? match[0] : null;
  }

  async stop(session: ShareSession): Promise<void> {
    try {
      if (isWindows()) {
        await run("taskkill", ["/F", "/T", "/PID", String(session.pid)]);
      } else {
        process.kill(-session.pid, "SIGTERM");
        await new Promise((resolve) => setTimeout(resolve, 1000));
        if (await this.isAlive(session.pid)) {
          process.kill(-session.pid, "SIGKILL");
        }
      }
    } catch {}
  }

  private async isAlive(pid: number): Promise<boolean> {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  async getStatus(session: ShareSession): Promise<ShareStatus> {
    const isRunning = await this.isAlive(session.pid);

    if (!isRunning) {
      return { isRunning: false };
    }

    const uptime = this.calculateUptime(session.startedAt);

    return {
      isRunning: true,
      publicUrl: session.publicUrl,
      uptime,
    };
  }

  private calculateUptime(startedAt: Date): string {
    const diff = Date.now() - startedAt.getTime();
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
  }

  getInstallCommand(): string {
    return "npm install -g localtunnel";
  }
}
