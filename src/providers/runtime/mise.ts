import type { RuntimeProvider } from "../types.js";
import { isCommandAvailable } from "../../utils/exec.js";

/**
 * MiseRuntime — presence check only.
 *
 * // mise is a mise-managed toolchain; the integration that actually runs is
  // `resolveBinaries` in services/mise-resolver.ts, which uses `mise which` and
  // `mise trust`. The former current()/install()/use() pair here was dead code and
  // wrong: `mise current --json` is not a valid command, and install() hardcoded
  // `node@`, so a PHP request would have run `mise install node@8.4`.

Only `detect()` is consumed (by `orkestra doctor` and `detectRuntime`),
 * so this provider deliberately implements nothing more.
 */
export class MiseRuntime implements RuntimeProvider {
  readonly name = "mise";
  readonly priority = 100;

  async detect(): Promise<boolean> {
    return isCommandAvailable("mise");
  }
}
