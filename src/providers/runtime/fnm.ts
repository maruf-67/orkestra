import type { RuntimeProvider } from "../types.js";
import { isCommandAvailable } from "../../utils/exec.js";

/**
 * FnmRuntime — presence check only.
 *
 * Only `detect()` is consumed (by `orkestra doctor` and `detectRuntime`),
 * so this provider deliberately implements nothing more.
 */
export class FnmRuntime implements RuntimeProvider {
  readonly name = "fnm";
  readonly priority = 75;

  async detect(): Promise<boolean> {
    return isCommandAvailable("fnm");
  }
}
