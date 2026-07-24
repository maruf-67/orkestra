import type { RuntimeProvider, RuntimeInfo } from "../types.js";
import { run, isCommandAvailable } from "../../utils/exec.js";

export class NvmRuntime implements RuntimeProvider {
  readonly name = "nvm";
  readonly priority = 80;

  async detect(): Promise<boolean> {
    // nvm is a shell function, check if NVM_DIR is set
    return isCommandAvailable("nvm") || process.env.NVM_DIR !== undefined;
  }

  async current(): Promise<RuntimeInfo | null> {
    const result = await run("nvm", ["current"]);
    if (result.exitCode !== 0) return null;

    const version = result.stdout.trim().replace(/^v/, "");
    const pathResult = await run("which", ["node"]);
    return {
      name: "node",
      version,
      path: pathResult.stdout.trim(),
    };
  }

  async install(version: string): Promise<void> {
    await run("nvm", ["install", version]);
  }

  async use(version: string): Promise<void> {
    await run("nvm", ["use", version]);
  }
}
