import { resolve, join } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { log } from "./logger.js";

export interface SyncLaravelOptions {
  port: number;
  reverbPort?: number;
  domain?: string;
  reverbDomain?: string;
}

export interface SyncLaravelResult {
  composerUpdated: boolean;
  rrUpdated: boolean;
  envUpdated: boolean;
  pnpmWorkspaceUpdated: boolean;
}

/**
 * Synchronizes Laravel project configuration files with assigned Orkestra ports & domain:
 * 1. composer.json: Updates octane:start, artisan serve, and reverb:start --port flags in all scripts.
 * 2. .rr.yaml: Updates RoadRunner http.address to the assigned port.
 * 3. .env: Updates APP_URL, APP_PORT, SERVER_PORT, OCTANE_PORT if present.
 * 4. pnpm-workspace.yaml: Ensures esbuild build scripts are allowed so pnpm dev does not crash concurrently.
 */
export async function syncLaravelProject(
  dir: string,
  options: SyncLaravelOptions
): Promise<SyncLaravelResult> {
  const projectDir = resolve(dir);
  const result: SyncLaravelResult = {
    composerUpdated: false,
    rrUpdated: false,
    envUpdated: false,
    pnpmWorkspaceUpdated: false,
  };

  // 1. Update composer.json
  const composerPath = join(projectDir, "composer.json");
  if (existsSync(composerPath)) {
    try {
      const raw = await readFile(composerPath, "utf-8");
      const composer = JSON.parse(raw);

      if (composer.scripts && typeof composer.scripts === "object") {
        let changed = false;

        const updateScriptCmd = (cmd: string): string => {
          let updated = cmd;

          // Update octane:start port
          if (updated.includes("octane:start")) {
            if (/octane:start[^\s"']*(\s+--host=\S+)?\s+--port=\d+/.test(updated)) {
              const prev = updated;
              updated = updated.replace(
                /(octane:start(?:\s+--host=\S+)?)\s+--port=\d+/,
                `$1 --port=${options.port}`
              );
              if (prev !== updated) changed = true;
            } else if (!updated.includes("--port=")) {
              updated = updated.replace(
                /octane:start(\s+--host=\S+)?/,
                `octane:start$1 --port=${options.port}`
              );
              changed = true;
            }
          }

          // Update artisan serve port
          if (updated.includes("artisan serve") || (updated.includes("serve") && !updated.includes("reverb:start") && !updated.includes("octane:start"))) {
            if (/--port[= ]\d+/.test(updated)) {
              const prev = updated;
              updated = updated.replace(/--port[= ]\d+/, `--port=${options.port}`);
              if (prev !== updated) changed = true;
            }
          }

          // Update reverb:start port if reverbPort is configured
          if (options.reverbPort && updated.includes("reverb:start")) {
            if (/reverb:start[^\s"']*(\s+--host=\S+)?\s+--port=\d+/.test(updated)) {
              const prev = updated;
              updated = updated.replace(
                /(reverb:start(?:\s+--host=\S+)?)\s+--port=\d+/,
                `$1 --port=${options.reverbPort}`
              );
              if (prev !== updated) changed = true;
            } else if (!updated.includes("--port=")) {
              updated = updated.replace(
                /reverb:start(\s+--host=\S+)?/,
                `reverb:start$1 --port=${options.reverbPort}`
              );
              changed = true;
            }
          }

          return updated;
        };

        for (const [key, value] of Object.entries(composer.scripts)) {
          if (Array.isArray(value)) {
            composer.scripts[key] = value.map((item) =>
              typeof item === "string" ? updateScriptCmd(item) : item
            );
          } else if (typeof value === "string") {
            composer.scripts[key] = updateScriptCmd(value);
          }
        }

        if (changed) {
          await writeFile(composerPath, JSON.stringify(composer, null, 4) + "\n", "utf-8");
          result.composerUpdated = true;
          log.dim(`  Updated composer.json scripts with port ${options.port}`);
        }
      }
    } catch (err) {
      log.warn(`  Could not update composer.json: ${err}`);
    }
  }

  // 2. Update .rr.yaml (RoadRunner)
  const rrPath = join(projectDir, ".rr.yaml");
  if (existsSync(rrPath)) {
    try {
      let rrContent = await readFile(rrPath, "utf-8");
      const addressMatch = rrContent.match(/address:\s*["']?([^"'\n]+)["']?/);
      if (addressMatch) {
        const fullAddr = addressMatch[1];
        let newAddr = fullAddr;
        if (fullAddr.includes(":")) {
          const hostPart = fullAddr.substring(0, fullAddr.lastIndexOf(":"));
          newAddr = `${hostPart}:${options.port}`;
        } else {
          newAddr = `127.0.0.1:${options.port}`;
        }

        if (fullAddr !== newAddr) {
          rrContent = rrContent.replace(
            /address:\s*["']?[^"'\n]+["']?/,
            `address: ${newAddr}`
          );
          await writeFile(rrPath, rrContent, "utf-8");
          result.rrUpdated = true;
          log.dim(`  Updated .rr.yaml http.address to ${newAddr}`);
        }
      }
    } catch (err) {
      log.warn(`  Could not update .rr.yaml: ${err}`);
    }
  }

  // 3. Update .env
  const envPath = join(projectDir, ".env");
  if (existsSync(envPath)) {
    try {
      let envContent = await readFile(envPath, "utf-8");
      let envChanged = false;

      // Update APP_URL if domain provided
      if (options.domain) {
        const scheme = "https";
        const targetUrl = `${scheme}://${options.domain}`;
        if (/^APP_URL=.*/m.test(envContent)) {
          envContent = envContent.replace(/^APP_URL=.*/m, `APP_URL=${targetUrl}`);
          envChanged = true;
        }
      }

      // Update APP_PORT / SERVER_PORT / OCTANE_PORT if present
      if (/^APP_PORT=.*/m.test(envContent)) {
        envContent = envContent.replace(/^APP_PORT=.*/m, `APP_PORT=${options.port}`);
        envChanged = true;
      }
      if (/^SERVER_PORT=.*/m.test(envContent)) {
        envContent = envContent.replace(/^SERVER_PORT=.*/m, `SERVER_PORT=${options.port}`);
        envChanged = true;
      }
      if (/^OCTANE_PORT=.*/m.test(envContent)) {
        envContent = envContent.replace(/^OCTANE_PORT=.*/m, `OCTANE_PORT=${options.port}`);
        envChanged = true;
      }

      if (envChanged) {
        await writeFile(envPath, envContent, "utf-8");
        result.envUpdated = true;
        log.dim(`  Updated .env with port ${options.port}`);
      }
    } catch (err) {
      log.warn(`  Could not update .env: ${err}`);
    }
  }

  // 4. Update pnpm-workspace.yaml if pnpm is used
  const isPnpm =
    existsSync(join(projectDir, "pnpm-lock.yaml")) ||
    existsSync(join(projectDir, "pnpm-workspace.yaml"));

  if (isPnpm) {
    const pnpmWorkspacePath = join(projectDir, "pnpm-workspace.yaml");
    try {
      let content = existsSync(pnpmWorkspacePath)
        ? await readFile(pnpmWorkspacePath, "utf-8")
        : "";

      let changed = false;
      if (!content.includes("allowBuilds:") && !content.includes("onlyBuiltDependencies:")) {
        content =
          content.trimEnd() +
          (content ? "\n" : "") +
          "allowBuilds:\n  esbuild: true\nonlyBuiltDependencies:\n  - esbuild\n";
        changed = true;
      } else {
        if (!content.includes("esbuild")) {
          if (!content.includes("onlyBuiltDependencies:")) {
            content = content.trimEnd() + "\nonlyBuiltDependencies:\n  - esbuild\n";
            changed = true;
          }
        }
      }

      if (changed) {
        await writeFile(pnpmWorkspacePath, content, "utf-8");
        result.pnpmWorkspaceUpdated = true;
        log.dim("  Configured pnpm-workspace.yaml to permit esbuild build scripts");
      }
    } catch (err) {
      log.warn(`  Could not update pnpm-workspace.yaml: ${err}`);
    }
  }

  return result;
}

/**
 * Stops any lingering Laravel Octane or RoadRunner processes for the given project directory.
 */
export async function cleanupLaravelProcesses(
  projectDir: string,
  port?: number
): Promise<void> {
  const resolvedDir = resolve(projectDir);

  // 1. Try stopping Octane gracefully if artisan exists
  if (existsSync(join(resolvedDir, "artisan"))) {
    try {
      const { execSync } = await import("node:child_process");
      execSync("php artisan octane:stop --no-interaction", {
        cwd: resolvedDir,
        stdio: "ignore",
        timeout: 3000,
      });
    } catch {}
  }

  // 2. Kill any lingering RoadRunner/Octane processes associated with this project
  try {
    const { execSync } = await import("node:child_process");
    const pgrepOutput = execSync(`pgrep -f "rr" || true`, {
      encoding: "utf-8",
    });
    const pids = pgrepOutput
      .split("\n")
      .map((p) => parseInt(p.trim(), 10))
      .filter((p) => !isNaN(p));

    for (const pid of pids) {
      try {
        const cwd = execSync(`readlink -f /proc/${pid}/cwd 2>/dev/null || true`, {
          encoding: "utf-8",
        }).trim();
        if (cwd === resolvedDir) {
          try { process.kill(pid, "SIGKILL"); } catch {}
        }
      } catch {}
    }

    if (port) {
      const portPids = execSync(`lsof -ti :${port} 2>/dev/null || true`, {
        encoding: "utf-8",
      })
        .split("\n")
        .map((p) => parseInt(p.trim(), 10))
        .filter((p) => !isNaN(p));

      for (const pid of portPids) {
        try { process.kill(pid, "SIGKILL"); } catch {}
      }
    }
  } catch {}
}
