import type { PackageManager } from "../providers/types.js";
import { isCommandAvailable } from "../utils/exec.js";

export const packageManagers: PackageManager[] = [
  { name: "pnpm", command: "pnpm", lockfile: "pnpm-lock.yaml" },
  { name: "npm", command: "npm", lockfile: "package-lock.json" },
  { name: "bun", command: "bun", lockfile: "bun.lockb" },
  { name: "yarn", command: "yarn", lockfile: "yarn.lock" },
];

export async function detectPackageManager(): Promise<PackageManager | null> {
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
