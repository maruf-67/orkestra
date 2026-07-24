import type { RuntimeProvider, RuntimeInfo } from "../types.js";
import { run, isCommandAvailable } from "../../utils/exec.js";

export class AsdfRuntime implements RuntimeProvider {
  readonly name = "asdf";
  readonly priority = 60;

  async detect(): Promise<boolean> {
    return isCommandAvailable("asdf");
  }

  async current(): Promise<RuntimeInfo | null> {
    const result = await run("asdf", ["current", "nodejs"]);
    if (result.exitCode !== 0) return null;

    const version = result.stdout.trim().split("\n")[0];
    const pathResult = await run("which", ["node"]);
    return {
      name: "node",
      version,
      path: pathResult.stdout.trim(),
    };
  }

  async install(version: string): Promise<void> {
    await run("asdf", ["install", "nodejs", version]);
  }

  async use(version: string): Promise<void> {
    await run("asdf", ["global", "nodejs", version]);
  }
}
