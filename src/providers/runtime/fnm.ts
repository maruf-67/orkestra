import type { RuntimeProvider, RuntimeInfo } from "../types.js";
import { run, isCommandAvailable } from "../../utils/exec.js";

export class FnmRuntime implements RuntimeProvider {
  readonly name = "fnm";
  readonly priority = 70;

  async detect(): Promise<boolean> {
    return isCommandAvailable("fnm");
  }

  async current(): Promise<RuntimeInfo | null> {
    const result = await run("fnm", ["current"]);
    if (result.exitCode !== 0) return null;

    const version = result.stdout.trim().replace(/^v/, "");
    const pathResult = await run("fnm", ["exec", "--using=current", "which", "node"]);
    return {
      name: "node",
      version,
      path: pathResult.stdout.trim(),
    };
  }

  async install(version: string): Promise<void> {
    await run("fnm", ["install", version]);
  }

  async use(version: string): Promise<void> {
    await run("fnm", ["use", version]);
  }
}
