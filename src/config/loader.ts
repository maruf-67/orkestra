import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { validateConfig, type OrkestraConfig } from "./schema.js";

const CONFIG_FILE = ".orkestra.yml";

export async function loadConfig(dir: string): Promise<OrkestraConfig | null> {
  const configPath = join(dir, CONFIG_FILE);
  if (!existsSync(configPath)) return null;

  try {
    const content = await readFile(configPath, "utf-8");
    const data = parseYaml(content);
    return validateConfig(data);
  } catch {
    return null;
  }
}

export function getConfigPath(dir: string): string {
  return join(dir, CONFIG_FILE);
}

export function configExists(dir: string): boolean {
  return existsSync(join(dir, CONFIG_FILE));
}
