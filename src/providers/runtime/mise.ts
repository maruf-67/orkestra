import type { RuntimeProvider, RuntimeInfo } from "../types.js";
import { run, isCommandAvailable } from "../../utils/exec.js";

export class MiseRuntime implements RuntimeProvider {
  readonly name = "mise";
  readonly priority = 100;

  async detect(): Promise<boolean> {
    return isCommandAvailable("mise");
  }

  async current(): Promise<RuntimeInfo | null> {
    const result = await run("mise", ["current", "--json"]);
    if (result.exitCode !== 0) return null;

    try {
      const data = JSON.parse(result.stdout);
      return {
        name: data.name || "unknown",
        version: data.version || "unknown",
        path: data.path || "",
      };
    } catch {
      return null;
    }
  }

  async install(version: string): Promise<void> {
    await run("mise", ["install", `node@${version}`]);
  }

  async use(version: string): Promise<void> {
    await run("mise", ["use", `node@${version}`]);
  }
}
