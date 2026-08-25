import type { ServiceProvider } from "../types.js";
import { run } from "../../utils/exec.js";
import { getPlatform, isWindows } from "../../platform/index.js";

export class OsServiceProvider implements ServiceProvider {
  async start(service: string): Promise<void> {
    const platform = getPlatform();
    if (isWindows()) {
      await run("sc", ["start", service], { sudo: true });
    } else if (platform.serviceManager === "systemctl") {
      await run("systemctl", ["start", service], { sudo: true });
    } else if (platform.serviceManager === "launchctl") {
      await run("brew", ["services", "start", service]);
    }
  }

  async stop(service: string): Promise<void> {
    const platform = getPlatform();
    if (isWindows()) {
      await run("sc", ["stop", service], { sudo: true });
    } else if (platform.serviceManager === "systemctl") {
      await run("systemctl", ["stop", service], { sudo: true });
    } else if (platform.serviceManager === "launchctl") {
      await run("brew", ["services", "stop", service]);
    }
  }

  async restart(service: string): Promise<void> {
    const platform = getPlatform();
    if (isWindows()) {
      await run("sc", ["stop", service], { sudo: true });
      await run("sc", ["start", service], { sudo: true });
    } else if (platform.serviceManager === "systemctl") {
      await run("systemctl", ["restart", service], { sudo: true });
    } else if (platform.serviceManager === "launchctl") {
      await run("brew", ["services", "restart", service]);
    }
  }

  async status(service: string): Promise<"running" | "stopped" | "unknown"> {
    const platform = getPlatform();

    const serviceAliases: Record<string, string[]> = {
      postgresql: ["postgresql", "postgres"],
      postgres: ["postgresql", "postgres"],
      mysql: ["mysql", "mariadb", "mysqld"],
      redis: ["redis", "redis-server"],
      caddy: ["caddy"],
    };

    const candidates = serviceAliases[service.toLowerCase()] || [service];

    if (isWindows()) {
      for (const cand of candidates) {
        const result = await run("sc", ["query", cand]);
        if (result.stdout.includes("RUNNING")) return "running";
      }
      return "stopped";
    } else if (platform.serviceManager === "systemctl") {
      for (const cand of candidates) {
        const result = await run("systemctl", ["is-active", cand]);
        if (result.stdout.trim() === "active") return "running";
      }
      return "stopped";
    } else if (platform.serviceManager === "launchctl") {
      const result = await run("brew", ["services", "list"]);
      for (const cand of candidates) {
        const line = result.stdout.split("\n").find((l) => l.includes(cand));
        if (line?.includes("started")) return "running";
      }
      return "stopped";
    }
    return "unknown";
  }
}
