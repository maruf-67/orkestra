import type { PackageManager } from "../providers/types.js";
import { isCommandAvailable } from "../utils/exec.js";
import { existsSync } from "node:fs";
import { join } from "node:path";

export const packageManagers: PackageManager[] = [
  { name: "bun", command: "bun", lockfile: "bun.lock" },
  { name: "pnpm", command: "pnpm", lockfile: "pnpm-lock.yaml" },
  { name: "npm", command: "npm", lockfile: "package-lock.json" },
  { name: "yarn", command: "yarn", lockfile: "yarn.lock" },
];

export async function detectPackageManager(dir?: string): Promise<PackageManager | null> {
  // 1. If a directory is provided, prioritize lockfiles present in the project
  if (dir) {
    if (existsSync(join(dir, "bun.lock")) || existsSync(join(dir, "bun.lockb"))) {
      if (await isCommandAvailable("bun")) {
        return { name: "bun", command: "bun", lockfile: "bun.lock" };
      }
    }
    if (existsSync(join(dir, "pnpm-lock.yaml")) || existsSync(join(dir, "pnpm-workspace.yaml"))) {
      if (await isCommandAvailable("pnpm")) {
        return { name: "pnpm", command: "pnpm", lockfile: "pnpm-lock.yaml" };
      }
    }
    if (existsSync(join(dir, "yarn.lock"))) {
      if (await isCommandAvailable("yarn")) {
        return { name: "yarn", command: "yarn", lockfile: "yarn.lock" };
      }
    }
    if (existsSync(join(dir, "package-lock.json"))) {
      if (await isCommandAvailable("npm")) {
        return { name: "npm", command: "npm", lockfile: "package-lock.json" };
      }
    }
  }

  // 2. Fall back to checking globally available commands in order of preference (bun -> pnpm -> npm -> yarn)
  for (const pm of packageManagers) {
    if (await isCommandAvailable(pm.command)) {
      return pm;
    }
  }

  return null;
}

export function listPackageManagers(): PackageManager[] {
  return packageManagers;
}
