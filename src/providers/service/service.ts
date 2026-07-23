import type { ServiceProvider } from "../types.js";
import { run, isCommandAvailable } from "../../utils/exec.js";
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
    if (isWindows()) {
      const result = await run("sc", ["query", service]);
      return result.stdout.includes("RUNNING") ? "running" : "stopped";
    } else if (platform.serviceManager === "systemctl") {
      const result = await run("systemctl", ["is-active", service]);
      return result.stdout.trim() === "active" ? "running" : "stopped";
    } else if (platform.serviceManager === "launchctl") {
      const result = await run("brew", ["services", "list"]);
      const line = result.stdout.split("\n").find((l) => l.includes(service));
      if (line?.includes("started")) return "running";
      if (line?.includes("stopped")) return "stopped";
    }
    return "unknown";
  }
}
