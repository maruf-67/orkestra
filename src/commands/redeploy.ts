import { resolve, basename, join } from "node:path";
import { writeFile, readFile, unlink, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { loadConfig } from "../config/loader.js";
import { providerRegistry } from "../deployment/providers/registry.js";
import { resolveBinaries } from "../services/mise-resolver.js";
import { syncGitBranch } from "../deployment/git.js";
import { systemd } from "../services/systemd.js";
import { getProject } from "../state/store.js";
import { log, heading, spinner } from "../utils/logger.js";
import { run } from "../utils/exec.js";
import prompts from "prompts";

interface RedeployOptions {
  dir?: string;
  branch?: string;
  strategy?: "reset" | "pull";
  yes?: boolean;
  skipBuild?: boolean;
  skipOptimize?: boolean;
}

function getLockFilePath(projectDir: string): string {
  return join(projectDir, ".orkestra", "deploy.lock");
}

async function acquireLock(projectDir: string): Promise<void> {
  const lockDir = join(projectDir, ".orkestra");
  if (!existsSync(lockDir)) await mkdir(lockDir, { recursive: true });
  const lockPath = getLockFilePath(projectDir);
  if (existsSync(lockPath)) {
    const info = await readFile(lockPath, "utf-8");
    throw new Error(`Deployment locked! Another deployment is in progress.\nLock info: ${info}\nRemove ${lockPath} if stale.`);
  }
  await writeFile(lockPath, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString(), type: "redeploy" }), "utf-8");
}

async function releaseLock(projectDir: string): Promise<void> {
  const lockPath = getLockFilePath(projectDir);
  if (existsSync(lockPath)) try { await unlink(lockPath); } catch {}
}

export async function redeploy(options: RedeployOptions) {
  heading("Orkestra Redeploy — no port/Caddy changes");

  const projectDir = resolve(options.dir || process.cwd());
  const existing = await getProject(projectDir);
  if (!existing) {
    log.error(`Project not registered: ${projectDir}`);
    log.dim("Run: orkestra init -y --port <port> --domain <domain>");
    process.exit(1);
  }

  const projectName = existing.name || basename(projectDir);
  log.info(`Project:  ${projectName}`);
  log.info(`Path:     ${projectDir}`);
  log.info(`Domain:   ${existing.domain} → localhost:${existing.port} (frozen)`);
  log.dim("Proxy/hosts/ports will NOT be modified.");

  if (!options.yes) {
    const confirm = await prompts({
      type: "confirm",
      name: "proceed",
      message: `Redeploy ${projectName} (restart services ${existing.domain}:${existing.port})?`,
      initial: true,
    });
    if (!confirm.proceed) { log.warn("Redeploy aborted."); return; }
  }

  const lockSpin = spinner("Acquiring redeploy lock...");
  lockSpin.start();
  try { await acquireLock(projectDir); lockSpin.succeed("Lock acquired"); }
  catch (e: any) { lockSpin.fail(e.message); process.exit(1); }

  const startTime = Date.now();
  try {
    let config = await loadConfig(projectDir);
    const initialBranch = options.branch || (config as any)?.deployment?.branch || "main";
    const strategy = options.strategy || (config as any)?.deployment?.strategy || "reset";

    // Freeze port/domain from state — never trust .orkestra.yml drift
    const frozenBase: any = { ...(config || {}) };
    frozenBase.domain = existing.domain;
    frozenBase.port = existing.port;

    const binaries = await resolveBinaries(projectDir);
    const resolved = await providerRegistry.resolve(projectDir);
    if (!resolved) throw new Error(`Could not detect framework for ${projectDir}`);
    const { provider, detection } = resolved;
    const isLaravel = detection.framework === "laravel";
    log.info(`Framework: ${detection.framework} ${detection.version || ""}`);
    log.info(`Branch:    ${initialBranch} (strategy: ${strategy})`);
    log.dim("Proxy/hosts/ports frozen — will NOT be modified.");

    let context: any = {
      projectDir,
      projectName,
      branch: initialBranch,
      config: frozenBase,
      binaries,
      options: { dir: projectDir, strategy },
    };

    // Step 1: git pull origin <branch> (like deploy) — then re-freeze port/domain
    const gitSpin = spinner(`Syncing git (origin/${initialBranch})...`);
    gitSpin.start();
    try {
      const gitRes = await syncGitBranch(projectDir, initialBranch, strategy);
      gitSpin.succeed(`Git synced ${gitRes.currentCommit.substring(0,7)}`);
      // Reload config after reset, but keep frozen port/domain
      const fresh = await loadConfig(projectDir);
      if (fresh) {
        const merged: any = { ...fresh, domain: existing.domain, port: existing.port };
        // Preserve reverb identifiers from previous if missing
        if (!merged.reverbDomain) merged.reverbDomain = (frozenBase as any).reverbDomain;
        if (!merged.reverbPort) merged.reverbPort = (frozenBase as any).reverbPort;
        context.config = merged;
        config = merged;
      } else {
        context.config = frozenBase;
      }
    } catch (err: any) {
      gitSpin.fail(`Git sync failed: ${err.message}`);
      throw err;
    }

    // Step 2: install dependencies (composer for Laravel, bun/pnpm/npm for Node)
    const depSpin = spinner(`Installing dependencies (${detection.packageManager})...`);
    depSpin.start();
    try {
      const depRes = await provider.installDependencies(context);
      depSpin.succeed(`Dependencies in ${(depRes.durationMs/1000).toFixed(1)}s`);
    } catch (err: any) {
      depSpin.fail(`Install failed: ${err.message}`);
      throw err;
    }

    if (isLaravel) {
      // Step 3: optimize:clear / optimize BEFORE restart (then restart)
      if (!options.skipOptimize) {
        const php = binaries.php || "php";
        const clearSpin = spinner("Running php artisan optimize:clear (o:clear)...");
        clearSpin.start();
        let clearRes = await run(php, ["artisan", "optimize:clear", "--no-interaction"], { cwd: projectDir });
        if (clearRes.exitCode !== 0) {
          // also try alias o:clear, then individual clears
          const aliasRes = await run(php, ["artisan", "o:clear", "--no-interaction"], { cwd: projectDir });
          if (aliasRes.exitCode !== 0) {
            await run(php, ["artisan", "config:clear", "--no-interaction"], { cwd: projectDir });
            await run(php, ["artisan", "route:clear", "--no-interaction"], { cwd: projectDir });
            await run(php, ["artisan", "view:clear", "--no-interaction"], { cwd: projectDir });
            await run(php, ["artisan", "cache:clear", "--no-interaction"], { cwd: projectDir });
          }
        }
        clearSpin.succeed("optimize:clear done");

        const optSpin = spinner("Running php artisan optimize...");
        optSpin.start();
        const optRes = await run(php, ["artisan", "optimize", "--no-interaction"], { cwd: projectDir });
        if (optRes.exitCode !== 0) {
          await run(php, ["artisan", "config:cache", "--no-interaction"], { cwd: projectDir });
          await run(php, ["artisan", "route:cache", "--no-interaction"], { cwd: projectDir });
          await run(php, ["artisan", "view:cache", "--no-interaction"], { cwd: projectDir });
        }
        optSpin.succeed("optimize done");
        await run(php, ["artisan", "storage:link", "--no-interaction"], { cwd: projectDir }).catch(()=>{});
      }

      // Step 4: restart services (octane/queue/reverb) with frozen port — no Caddy/ports change
      const srvSpin = spinner("Restarting Laravel services (octane/queue/reverb)...");
      srvSpin.start();
      try {
        const serviceDefs = await provider.services(context, detection);
        for (const srv of serviceDefs) {
          await systemd.installService(srv.type, undefined, {
            projectName,
            projectPath: projectDir,
            port: srv.port,
            execStart: srv.command,
            phpBinary: binaries.php,
            nodeBinary: binaries.node,
            bunBinary: binaries.bun,
            octanePort: srv.port,
            queueConnection: srv.queueConnection,
            queues: srv.queues,
          });
          await systemd.restart(systemd.getServiceName(projectName, srv.type));
        }
        srvSpin.succeed(`Services restarted (${serviceDefs.map(s=>s.type).join(", ")})`);
      } catch (err: any) {
        srvSpin.fail(`Service restart failed: ${err.message}`);
        throw err;
      }
    } else {
      // Node / Nuxt / Next: stop → build → start (no proxy change)
      const webService = systemd.getServiceName(projectName, "web");

      if (!options.skipBuild) {
        const stopSpin = spinner(`Stopping ${webService}...`);
        stopSpin.start();
        await systemd.stop(webService).catch(()=>{});
        stopSpin.succeed("Stopped");

        const buildSpin = spinner(`Building ${detection.framework} (${detection.buildCommand || "build"})...`);
        buildSpin.start();
        try {
          const buildRes = await provider.build(context);
          buildSpin.succeed(`Build done in ${(buildRes.durationMs/1000).toFixed(1)}s`);
        } catch (err: any) {
          buildSpin.fail(`Build failed: ${err.message}`);
          throw err;
        }

        const startSpin = spinner(`Starting ${webService}...`);
        startSpin.start();
        const serviceDefs = await provider.services(context, detection);
        const webDef = serviceDefs.find(s=>s.type==="web") || serviceDefs[0];
        if (webDef) {
          await systemd.installService(webDef.type, undefined, {
            projectName,
            projectPath: projectDir,
            port: webDef.port,
            execStart: webDef.command,
            nodeBinary: binaries.node,
            bunBinary: binaries.bun,
          });
          await systemd.restart(webService);
        } else {
          await systemd.restart(webService);
        }
        startSpin.succeed("Service running");
      } else {
        const rSpin = spinner(`Restarting ${webService}...`);
        rSpin.start();
        await systemd.restart(webService);
        rSpin.succeed("Restarted");
      }
    }

    const dur = ((Date.now() - startTime)/1000).toFixed(1);
    log.success(`Redeploy done in ${dur}s — ${existing.domain}:${existing.port} unchanged, Caddy untouched.`);
  } catch (err: any) {
    log.error(err.message || String(err));
    process.exit(1);
  } finally {
    await releaseLock(projectDir);
  }
}
