import type { RuntimeProvider } from "../types.js";
import { isCommandAvailable } from "../../utils/exec.js";

/**
 * NvmRuntime — presence check only.
 *
 * Only `detect()` is consumed (by `orkestra doctor` and `detectRuntime`),
 * so this provider deliberately implements nothing more.
 */
export class NvmRuntime implements RuntimeProvider {
  readonly name = "nvm";
  readonly priority = 80;

  async detect(): Promise<boolean> {
    // nvm is a shell function, so the binary check can miss it.
    return isCommandAvailable("nvm") || process.env.NVM_DIR !== undefined;
  }
}
