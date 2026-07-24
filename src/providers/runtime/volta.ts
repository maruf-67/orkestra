import type { RuntimeProvider, RuntimeInfo } from "../types.js";
import { run, isCommandAvailable } from "../../utils/exec.js";

export class VoltaRuntime implements RuntimeProvider {
  readonly name = "volta";
  readonly priority = 50;

  async detect(): Promise<boolean> {
    return isCommandAvailable("volta");
  }

  async current(): Promise<RuntimeInfo | null> {
    const result = await run("volta", ["list", "node", "--format=plain"]);
    if (result.exitCode !== 0) return null;

    const versionMatch = result.stdout.match(/v(\d+\.\d+\.\d+)/);
    const version = versionMatch ? versionMatch[1] : "unknown";
    const pathResult = await run("which", ["node"]);
    return {
      name: "node",
      version,
      path: pathResult.stdout.trim(),
    };
  }

  async install(version: string): Promise<void> {
    await run("volta", ["install", `node@${version}`]);
  }

  async use(version: string): Promise<void> {
    await run("volta", ["install", `node@${version}`]);
  }
}
