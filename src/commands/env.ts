import { resolve, join } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { log, heading } from "../utils/logger.js";
import prompts from "prompts";

interface EnvOptions {
  dir?: string;
  set?: string;
  get?: string;
  list?: boolean;
}

export async function env(options: EnvOptions) {
  const projectDir = resolve(options.dir || process.cwd());
  const envPath = join(projectDir, ".env");

  if (!existsSync(envPath)) {
    log.warn("No .env file found in this directory.");
    log.dim("Create one with: orkestra env --set KEY=VALUE");
    return;
  }

  if (options.set) {
    const [key, ...valueParts] = options.set.split("=");
    const value = valueParts.join("=");
    await setEnvVar(envPath, key, value);
    log.success(`Set ${key}=${value}`);
    return;
  }

  if (options.get) {
    const value = await getEnvVar(envPath, options.get);
    if (value !== null) {
      console.log(value);
    } else {
      log.warn(`${options.get} not found in .env`);
    }
    return;
  }

  // List all env vars
  heading("Environment Variables");
  const content = await readFile(envPath, "utf-8");
  const lines = content.split("\n").filter((l) => l.trim() && !l.startsWith("#"));

  for (const line of lines) {
    const eqIndex = line.indexOf("=");
    if (eqIndex > 0) {
      const key = line.substring(0, eqIndex).trim();
      const value = line.substring(eqIndex + 1).trim();
      // Mask sensitive values
      const masked = isSensitive(key) ? maskValue(value) : value;
      log.plain(`  ${key}=${masked}`);
    }
  }

  log.plain("");
  log.dim("Commands:");
  log.dim("  orkestra env --set KEY=value    Set a variable");
  log.dim("  orkestra env --get KEY          Get a variable");
  log.dim("  orkestra env                    List all variables");
}

async function setEnvVar(filePath: string, key: string, value: string): Promise<void> {
  const content = await readFile(filePath, "utf-8");
  const regex = new RegExp(`^${key}=.*$`, "m");

  if (regex.test(content)) {
    await writeFile(filePath, content.replace(regex, `${key}=${value}`), "utf-8");
  } else {
    await writeFile(filePath, content.trimEnd() + `\n${key}=${value}\n`, "utf-8");
  }
}

async function getEnvVar(filePath: string, key: string): Promise<string | null> {
  const content = await readFile(filePath, "utf-8");
  const match = content.match(new RegExp(`^${key}=(.*)$`, "m"));
  return match ? match[1] : null;
}

function isSensitive(key: string): boolean {
  const sensitive = ["password", "secret", "token", "key", "api_key", "apikey", "credential"];
  return sensitive.some((s) => key.toLowerCase().includes(s));
}

function maskValue(value: string): string {
  if (value.length <= 4) return "****";
  return value.substring(0, 2) + "*".repeat(value.length - 4) + value.substring(value.length - 2);
}
