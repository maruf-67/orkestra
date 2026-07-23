import type { RuntimeProvider, RuntimeInfo } from "../types.js";
import { run, isCommandAvailable } from "../../utils/exec.js";

export class SystemRuntime implements RuntimeProvider {
  readonly name = "system";
  readonly priority = 10;

  async detect(): Promise<boolean> {
    return isCommandAvailable("node");
  }

  async current(): Promise<RuntimeInfo | null> {
    const result = await run("node", ["--version"]);
    if (result.exitCode !== 0) return null;

    const version = result.stdout.trim().replace(/^v/, "");
    const pathResult = await run("which", ["node"]);
    return {
      name: "node",
      version,
      path: pathResult.stdout.trim(),
    };
  }

  async install(_version: string): Promise<void> {
    throw new Error(
      "System runtime cannot install Node.js. Please install mise or nvm."
    );
  }

  async use(_version: string): Promise<void> {
    throw new Error(
      "System runtime cannot switch Node.js versions. Please install mise or nvm."
    );
  }
}
