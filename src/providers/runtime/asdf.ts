import type { RuntimeProvider } from "../types.js";
import { isCommandAvailable } from "../../utils/exec.js";

/**
 * AsdfRuntime — presence check only.
 *
 * Only `detect()` is consumed (by `orkestra doctor` and `detectRuntime`),
 * so this provider deliberately implements nothing more.
 */
export class AsdfRuntime implements RuntimeProvider {
  readonly name = "asdf";
  readonly priority = 70;

  async detect(): Promise<boolean> {
    return isCommandAvailable("asdf");
  }
}
