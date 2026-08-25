import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import type { ProjectCapabilities } from "./types.js";
import { isCommandAvailable, run } from "../utils/exec.js";

async function readJson(dir: string, file: string): Promise<Record<string, any> | null> {
  try {
    const fullPath = join(dir, file);
    if (!existsSync(fullPath)) return null;
    const content = await readFile(fullPath, "utf-8");
    return JSON.parse(content);
  } catch {
    return null;
  }
}

async function readEnv(dir: string): Promise<Record<string, string>> {
  const envPath = join(dir, ".env");
  const result: Record<string, string> = {};
  if (!existsSync(envPath)) return result;

  try {
    const content = await readFile(envPath, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx > 0) {
        const key = trimmed.substring(0, eqIdx).trim();
        const val = trimmed.substring(eqIdx + 1).trim().replace(/^['"]|['"]$/g, "");
        result[key] = val;
      }
    }
  } catch {}
  return result;
}

export async function detectCapabilities(dir: string): Promise<ProjectCapabilities> {
  const projectDir = resolve(dir);
  const composer = await readJson(projectDir, "composer.json");
  const composerLock = await readJson(projectDir, "composer.lock");
  const env = await readEnv(projectDir);

  const requireDeps: Record<string, string> = composer?.require || {};
  const requireDevDeps: Record<string, string> = composer?.["require-dev"] || {};
  const allDeps = { ...requireDeps, ...requireDevDeps };

  const lockPackages: any[] = [
    ...(composerLock?.packages || []),
    ...(composerLock?.["packages-dev"] || []),
  ];

  const hasPackageInLock = (pkgName: string) =>
    lockPackages.some((p) => p.name === pkgName);

  const isLaravel =
    Boolean(allDeps["laravel/framework"]) ||
    hasPackageInLock("laravel/framework") ||
    existsSync(join(projectDir, "artisan"));

  let laravelVersion = allDeps["laravel/framework"];
  if (!laravelVersion && isLaravel) {
    const laravelPkg = lockPackages.find((p) => p.name === "laravel/framework");
    laravelVersion = laravelPkg?.version || "unknown";
  }

  const hasOctane =
    Boolean(allDeps["laravel/octane"]) ||
    hasPackageInLock("laravel/octane");

  let octaneServer: "roadrunner" | "swoole" | "frankenphp" | "none" = "none";
  if (hasOctane) {
    if (env["OCTANE_SERVER"]) {
      const s = env["OCTANE_SERVER"].toLowerCase();
      if (s.includes("roadrunner")) octaneServer = "roadrunner";
      else if (s.includes("swoole")) octaneServer = "swoole";
      else if (s.includes("frankenphp")) octaneServer = "frankenphp";
    } else if (existsSync(join(projectDir, ".rr.yaml")) || existsSync(join(projectDir, "rr"))) {
      octaneServer = "roadrunner";
    } else {
      octaneServer = "roadrunner"; // Default for Laravel Octane
    }
  }

  const hasReverb =
    Boolean(allDeps["laravel/reverb"]) ||
    hasPackageInLock("laravel/reverb");

  const queueConnection = env["QUEUE_CONNECTION"] || env["QUEUE_DRIVER"] || "redis";
  const hasQueue = isLaravel;

  const hasCaddy = await isCommandAvailable("caddy");
  const hasMise = await isCommandAvailable("mise");

  let phpBinary = "php";
  let composerBinary = "composer";

  if (hasMise) {
    try {
      const phpRes = await run("mise", ["which", "php"], { cwd: projectDir });
      if (phpRes.exitCode === 0 && phpRes.stdout.trim()) {
        phpBinary = phpRes.stdout.trim();
      }
      const composerRes = await run("mise", ["which", "composer"], { cwd: projectDir });
      if (composerRes.exitCode === 0 && composerRes.stdout.trim()) {
        composerBinary = composerRes.stdout.trim();
      }
    } catch {}
  }

  return {
    isLaravel,
    laravelVersion,
    hasOctane,
    octaneServer,
    hasReverb,
    hasQueue,
    queueConnection,
    hasCaddy,
    hasMise,
    phpBinary,
    composerBinary,
  };
}
