import { spawn, ChildProcess } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { ShareProvider, ShareOptions, ShareSession, ShareStatus } from "./types.js";
import { isCommandAvailable, run } from "../../utils/exec.js";
import { isWindows, isMacOS } from "../../platform/index.js";
import { log } from "../../utils/logger.js";

export class CloudflareShare implements ShareProvider {
  readonly name = "cloudflare";
  readonly priority = 100;

  async detect(): Promise<boolean> {
    // Check standard PATH first
    if (await isCommandAvailable("cloudflared")) {
      return true;
    }

    // Check ~/.local/bin (common install location)
    const homeDir = process.env.HOME || "~";
    const localBin = `${homeDir}/.local/bin/cloudflared`;
    if (await isCommandAvailable(localBin)) {
      return true;
    }

    return false;
  }

  async start(options: ShareOptions): Promise<ShareSession> {
    const logFile = join(homedir(), ".orkestra", "shares", `${options.projectName}.log`);
    const logDir = join(homedir(), ".orkestra", "shares");

    if (!existsSync(logDir)) {
      await mkdir(logDir, { recursive: true });
    }

    // Find cloudflared binary
    let cloudflaredPath = "cloudflared";
    if (!(await isCommandAvailable("cloudflared"))) {
      const homeDir = process.env.HOME || "~";
      const localBin = `${homeDir}/.local/bin/cloudflared`;
      if (await isCommandAvailable(localBin)) {
        cloudflaredPath = localBin;
      }
    }

    // Start cloudflared tunnel
    const child = spawn(cloudflaredPath, [
      "tunnel",
      "--url", `http://localhost:${options.port}`,
      "--logfile", logFile,
    ], {
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });

    child.unref();

    // Wait for URL to appear in output
    const publicUrl = await this.waitForUrl(child, logFile, 30000);

    if (!publicUrl) {
      throw new Error("Failed to get Cloudflare tunnel URL");
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

  private async waitForUrl(child: ChildProcess, logFile: string, timeout: number): Promise<string | null> {
    return new Promise((resolve) => {
      const startTime = Date.now();
      let output = "";

      // Listen on stdout for URL
      child.stdout?.on("data", (data: Buffer) => {
        output += data.toString();
        const url = this.extractUrl(output);
        if (url) {
          resolve(url);
        }
      });

      // Listen on stderr for URL (cloudflared outputs to stderr)
      child.stderr?.on("data", (data: Buffer) => {
        output += data.toString();
        const url = this.extractUrl(output);
        if (url) {
          resolve(url);
        }
      });

      // Also check log file periodically
      const checkLog = setInterval(async () => {
        if (Date.now() - startTime > timeout) {
          clearInterval(checkLog);
          resolve(null);
          return;
        }

        try {
          if (existsSync(logFile)) {
            const content = await readFile(logFile, "utf-8");
            const url = this.extractUrl(content);
            if (url) {
              clearInterval(checkLog);
              resolve(url);
            }
          }
        } catch {}
      }, 1000);

      // Timeout
      setTimeout(() => {
        clearInterval(checkLog);
        resolve(null);
      }, timeout);
    });
  }

  private extractUrl(output: string): string | null {
    // Match Cloudflare Quick Tunnel URL pattern
    const match = output.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
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
    if (isWindows()) {
      return "choco install cloudflared -y";
    }
    if (isMacOS()) {
      return "brew install cloudflared";
    }
    return "sudo apt install -y cloudflared || sudo dnf install -y cloudflared";
  }
}
