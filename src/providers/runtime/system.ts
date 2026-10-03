import type { RuntimeProvider } from "../types.js";
import { isCommandAvailable } from "../../utils/exec.js";

/**
 * SystemRuntime — presence check only.
 *
 * // Always last: the system toolchain is the fallback, not a preference.

Only `detect()` is consumed (by `orkestra doctor` and `detectRuntime`),
 * so this provider deliberately implements nothing more.
 */
export class SystemRuntime implements RuntimeProvider {
  readonly name = "system";
  readonly priority = 0;

  async detect(): Promise<boolean> {
    return isCommandAvailable("node");
  }
}
