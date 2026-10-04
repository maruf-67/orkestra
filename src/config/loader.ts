import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { validateConfig, type OrkestraConfig } from "./schema.js";
import { log } from "../utils/logger.js";

const CONFIG_FILE = ".orkestra.yml";

/** Condense a Zod issue into something an operator can act on. */
function describeIssues(err: unknown): string {
  const issues = (err as { issues?: Array<{ path: unknown[]; message: string }> })?.issues;
  if (!Array.isArray(issues) || issues.length === 0) {
    return err instanceof Error ? err.message : String(err);
  }
  return issues
    .slice(0, 5)
    .map((i) => `${i.path.length ? i.path.join(".") : "(root)"}: ${i.message}`)
    .join("; ");
}

/**
 * Read `.orkestra.yml`.
 *
 * Returns null when there is no config, and ALSO when a config exists but cannot
 * be used — but the two cases are no longer indistinguishable.
 *
 * The distinction matters more than it looks. `loadConfig` feeds
 * `commands/up.ts` (`port = config?.port || framework.port`), so a config that
 * fails validation used to make the project silently fall back to the framework
 * default. Demonstrated with a quoted port, which is an entirely ordinary YAML
 * slip:
 *
 *     port: "8022"   ->   Zod rejects (expected number)
 *                     ->   loadConfig returns null, printing nothing
 *                     ->   up() binds the framework default instead
 *
 * That is silent port drift with no diagnostic, and it is the same failure class
 * as every other port bug: a value the operator set was discarded without a word.
 * An invalid config now reports which fields were wrong; the return value is
 * unchanged so callers keep degrading gracefully rather than crashing.
 */
export async function loadConfig(dir: string): Promise<OrkestraConfig | null> {
  const configPath = join(dir, CONFIG_FILE);
  if (!existsSync(configPath)) return null;

  let data: unknown;
  try {
    const content = await readFile(configPath, "utf-8");
    data = parseYaml(content);
  } catch (err) {
    log.warn(
      `Could not parse ${configPath}: ${err instanceof Error ? err.message : String(err)}. ` +
      `Falling back to defaults — the configured domain, port and proxy are being ignored.`,
    );
    return null;
  }

  try {
    return validateConfig(data);
  } catch (err) {
    log.warn(
      `${configPath} is invalid: ${describeIssues(err)}. ` +
      `Falling back to defaults — the configured domain, port and proxy are being ignored.`,
    );
    return null;
  }
}

export function getConfigPath(dir: string): string {
  return join(dir, CONFIG_FILE);
}

export function configExists(dir: string): boolean {
  return existsSync(join(dir, CONFIG_FILE));
}
