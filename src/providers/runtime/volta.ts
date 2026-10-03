import type { RuntimeProvider } from "../types.js";
import { isCommandAvailable } from "../../utils/exec.js";

/**
 * VoltaRuntime — presence check only.
 *
 * Only `detect()` is consumed (by `orkestra doctor` and `detectRuntime`),
 * so this provider deliberately implements nothing more.
 */
export class VoltaRuntime implements RuntimeProvider {
  readonly name = "volta";
  readonly priority = 65;

  async detect(): Promise<boolean> {
    return isCommandAvailable("volta");
  }
}
