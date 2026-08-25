import { resolve, basename, join } from "node:path";
import { writeFile, unlink, readFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { loadConfig } from "../config/loader.js";
import { detectCapabilities } from "./detector.js";
import { syncGitBranch, getCurrentGitInfo } from "./git.js";
import { installComposerDependencies } from "./composer.js";
import { runLaravelMigrations, ensureStorageLink, optimizeLaravel } from "./laravel.js";
import { servicesManager } from "../services/manager.js";
import { CaddyProxy } from "../providers/proxy/caddy.js";
import { performDeploymentHealthChecks } from "./health.js";
import { saveDeploymentReport } from "./history.js";
import type { DeploymentOptions, DeploymentReport, DeploymentStep } from "./types.js";
import { log, spinner } from "../utils/logger.js";
import { findAvailablePort } from "../state/ports.js";
import { registerProject, getProject } from "../state/store.js";
import { getPlatform } from "../platform/index.js";

function getLockFilePath(projectDir: string): string {
  return join(projectDir, ".orkestra", "deploy.lock");
}

async function acquireDeployLock(projectDir: string): Promise<void> {
  const lockDir = join(projectDir, ".orkestra");
  if (!existsSync(lockDir)) {
    await mkdir(lockDir, { recursive: true });
  }

  const lockPath = getLockFilePath(projectDir);
  if (existsSync(lockPath)) {
    const lockInfo = await readFile(lockPath, "utf-8");
    throw new Error(
      `Deployment locked! Another deployment is in progress.\nLock info: ${lockInfo}\nIf this is a stale lock, remove ${lockPath}`
    );
  }

  const lockData = JSON.stringify({
    pid: process.pid,
    startedAt: new Date().toISOString(),
  });
  await writeFile(lockPath, lockData, "utf-8");
}

async function releaseDeployLock(projectDir: string): Promise<void> {
  const lockPath = getLockFilePath(projectDir);
  if (existsSync(lockPath)) {
    try {
      await unlink(lockPath);
    } catch {}
  }
}

export class DeploymentPipeline {
  async execute(options: DeploymentOptions): Promise<DeploymentReport> {
    const startTime = Date.now();
    const projectDir = resolve(options.dir || process.cwd());
    const config = await loadConfig(projectDir);
    const projectName = config?.name || basename(projectDir);
    const targetBranch = options.branch || config?.deployment?.branch || "main";
    const strategy = options.strategy || config?.deployment?.strategy || "reset";

    const steps: DeploymentStep[] = [];
    const recordStep = (name: string, description: string, status: DeploymentStep["status"], durationMs?: number, error?: string) => {
      steps.push({ name, description, status, durationMs, error });
    };

    const initialGit = await getCurrentGitInfo(projectDir);
    const capabilities = await detectCapabilities(projectDir);

    const report: DeploymentReport = {
      projectName,
      projectPath: projectDir,
      branch: targetBranch,
      commit: initialGit?.commit || "HEAD",
      previousCommit: initialGit?.commit,
      startedAt: new Date().toISOString(),
      durationSeconds: 0,
      status: "success",
      steps,
      capabilities,
      services: {},
      proxy: { status: "skipped" },
      health: {},
    };

    // Dry Run Mode
    if (options.dryRun) {
      log.info(`[Dry Run] Deployment preview for ${projectName} (Branch: ${targetBranch})`);
      log.plain(`  • Framework:   ${capabilities.isLaravel ? `Laravel (${capabilities.laravelVersion || "detected"})` : "Non-Laravel"}`);
      log.plain(`  • Octane:      ${capabilities.hasOctane ? `Enabled (${capabilities.octaneServer})` : "Disabled"}`);
      log.plain(`  • Queue:       ${capabilities.hasQueue ? `Enabled (${capabilities.queueConnection})` : "Disabled"}`);
      log.plain(`  • Reverb:      ${capabilities.hasReverb ? "Enabled" : "Disabled"}`);
      log.plain(`  • PHP Runtime: ${capabilities.phpBinary || "php"}`);
      log.plain(`  • Strategy:    git ${strategy} origin/${targetBranch}`);
      log.plain(`  • Migrations:  ${config?.deployment?.database?.migrate !== false && !options.noMigrate ? "Yes" : "No"}`);
      log.plain(`  • Services:    Systemd templates will be applied and restarted`);
      return report;
    }

    // Step 1: Acquire Lock
    const lockSpin = spinner("Acquiring deployment lock...");
    lockSpin.start();
    try {
      await acquireDeployLock(projectDir);
      lockSpin.succeed("Deployment lock acquired");
      recordStep("lock", "Acquired deployment lock", "success");
    } catch (err: any) {
      lockSpin.fail("Deployment lock failed");
      report.status = "aborted";
      report.error = err.message;
      return report;
    }

    try {
      // Step 2: Git Sync
      const gitSpin = spinner(`Syncing git repository (branch: ${targetBranch})...`);
      gitSpin.start();
      const gitStepStart = Date.now();
      try {
        const gitResult = await syncGitBranch(projectDir, targetBranch, strategy);
        report.commit = gitResult.currentCommit;
        report.previousCommit = gitResult.previousCommit;
        const duration = Date.now() - gitStepStart;
        gitSpin.succeed(`Git synced (${gitResult.currentCommit.substring(0, 7)}) in ${(duration / 1000).toFixed(1)}s`);
        recordStep("git", `Synced to commit ${gitResult.currentCommit.substring(0, 7)}`, "success", duration);
      } catch (err: any) {
        gitSpin.fail(`Git sync failed: ${err.message}`);
        recordStep("git", "Git sync failed", "failed", Date.now() - gitStepStart, err.message);
        throw err;
      }

      // Step 3: Dependencies (Composer)
      const compSpin = spinner("Installing Composer dependencies...");
      compSpin.start();
      const compStepStart = Date.now();
      try {
        const composerFlags =
          typeof config?.deployment?.composer === "object"
            ? config.deployment.composer.flags
            : undefined;

        await installComposerDependencies({
          composerBinary: capabilities.composerBinary,
          flags: composerFlags,
          cwd: projectDir,
        });
        const duration = Date.now() - compStepStart;
        compSpin.succeed(`Composer dependencies installed in ${(duration / 1000).toFixed(1)}s`);
        recordStep("composer", "Installed composer dependencies", "success", duration);
      } catch (err: any) {
        compSpin.fail(`Composer install failed: ${err.message}`);
        recordStep("composer", "Composer install failed", "failed", Date.now() - compStepStart, err.message);
        throw err;
      }

      // Step 4: Laravel Migrations & Optimization
      if (capabilities.isLaravel) {
        const shouldMigrate = config?.deployment?.database?.migrate !== false && !options.noMigrate;
        if (shouldMigrate) {
          const migSpin = spinner("Running database migrations...");
          migSpin.start();
          const migStepStart = Date.now();
          try {
            await runLaravelMigrations({
              phpBinary: capabilities.phpBinary,
              cwd: projectDir,
              seed: config?.deployment?.database?.seed,
            });
            const duration = Date.now() - migStepStart;
            migSpin.succeed(`Database migrations executed in ${(duration / 1000).toFixed(1)}s`);
            recordStep("migrations", "Executed migrations", "success", duration);
          } catch (err: any) {
            migSpin.fail(`Database migration failed: ${err.message}`);
            recordStep("migrations", "Migrations failed", "failed", Date.now() - migStepStart, err.message);
            throw err;
          }
        } else {
          recordStep("migrations", "Skipped migrations", "skipped");
        }

        // Storage link
        await ensureStorageLink({ phpBinary: capabilities.phpBinary, cwd: projectDir });

        // Optimization
        if (config?.deployment?.optimize !== false) {
          const optSpin = spinner("Optimizing Laravel caches...");
          optSpin.start();
          const optStepStart = Date.now();
          try {
            await optimizeLaravel({ phpBinary: capabilities.phpBinary, cwd: projectDir });
            const duration = Date.now() - optStepStart;
            optSpin.succeed(`Laravel optimized in ${(duration / 1000).toFixed(1)}s`);
            recordStep("optimize", "Optimized Laravel configuration & route caches", "success", duration);
          } catch (err: any) {
            optSpin.warn(`Optimization completed with warnings: ${err.message}`);
            recordStep("optimize", "Optimization warning", "success", Date.now() - optStepStart);
          }
        }
      }

      // Step 5: Port Allocation & Services Provisioning
      const existingProject = await getProject(projectDir);
      let apiPort =
        (typeof config?.proxy === "object" ? config.proxy.api?.port : undefined) ||
        config?.services?.octane?.port ||
        config?.port ||
        existingProject?.port ||
        8000;

      let reverbPort =
        (typeof config?.proxy === "object" ? config.proxy.realtime?.port : undefined) ||
        config?.services?.reverb?.port ||
        config?.reverbPort ||
        8080;

      if (!options.noRestart) {
        const srvSpin = spinner("Configuring & restarting systemd services...");
        srvSpin.start();
        const srvStepStart = Date.now();
        try {
          const srvRes = await servicesManager.setupLaravelServices(
            projectDir,
            projectName,
            capabilities,
            config,
            { octanePort: apiPort, reverbPort }
          );

          await servicesManager.restartProjectServices(projectName, {
            octane: srvRes.octaneInstalled,
            queue: srvRes.queueInstalled,
            reverb: srvRes.reverbInstalled,
          });

          if (srvRes.octaneInstalled) report.services.octane = "restarted";
          if (srvRes.queueInstalled) report.services.queue = "restarted";
          if (srvRes.reverbInstalled) report.services.reverb = "restarted";

          const duration = Date.now() - srvStepStart;
          srvSpin.succeed(`Systemd services configured & restarted in ${(duration / 1000).toFixed(1)}s`);
          recordStep("services", "Provisioned and restarted systemd services", "success", duration);
        } catch (err: any) {
          srvSpin.fail(`Services restart failed: ${err.message}`);
          recordStep("services", "Service restart failed", "failed", Date.now() - srvStepStart, err.message);
          throw err;
        }
      } else {
        recordStep("services", "Skipped service restart (--no-restart)", "skipped");
      }

      // Step 6: Caddy Reverse Proxy Registration
      const apiDomain =
        (typeof config?.proxy === "object" ? config.proxy.api?.domain : undefined) ||
        config?.domain ||
        existingProject?.domain ||
        `${projectName}.test`;

      const reverbDomain =
        (typeof config?.proxy === "object" ? config.proxy.realtime?.domain : undefined) ||
        config?.reverbDomain;

      report.proxy.apiDomain = apiDomain;
      report.proxy.apiPort = apiPort;
      report.proxy.reverbDomain = reverbDomain;
      report.proxy.reverbPort = reverbPort;

      const caddy = new CaddyProxy();
      if (await caddy.detect()) {
        const proxySpin = spinner("Configuring Caddy reverse proxy...");
        proxySpin.start();
        const proxyStepStart = Date.now();
        try {
          const proxyConfigs: any[] = [
            {
              domain: apiDomain,
              port: apiPort,
              ssl: config?.ssl ?? true,
            },
          ];

          if (reverbDomain) {
            proxyConfigs.push({
              domain: reverbDomain,
              port: reverbPort,
              ssl: config?.ssl ?? true,
              websocket: true,
            });
          }

          await caddy.registerMultiple(proxyConfigs);

          // Register in state store
          await registerProject({
            name: projectName,
            domain: apiDomain,
            port: apiPort,
            framework: "laravel",
            proxy: "caddy",
            path: projectDir,
            registeredAt: existingProject?.registeredAt || new Date().toISOString(),
          });

          report.proxy.status = "configured";
          const duration = Date.now() - proxyStepStart;
          proxySpin.succeed(`Caddy configured and reloaded in ${(duration / 1000).toFixed(1)}s`);
          recordStep("proxy", "Configured Caddy routing and TLS", "success", duration);
        } catch (err: any) {
          proxySpin.fail(`Caddy proxy registration failed: ${err.message}`);
          report.proxy.status = "failed";
          recordStep("proxy", "Caddy registration failed", "failed", Date.now() - proxyStepStart, err.message);
        }
      }

      // Step 7: Health Checks
      const healthSpin = spinner("Performing health checks...");
      healthSpin.start();
      const healthStepStart = Date.now();

      const healthUrl =
        config?.health?.api?.url ||
        (apiDomain.includes(".") ? `https://${apiDomain}` : undefined);

      const healthRes = await performDeploymentHealthChecks({
        apiUrl: healthUrl,
        expectedStatus: config?.health?.api?.expectedStatus ?? 200,
        timeoutMs: config?.health?.api?.timeoutMs ?? 5000,
        projectName,
        services: {
          octane: report.services.octane === "restarted",
          queue: report.services.queue === "restarted",
          reverb: report.services.reverb === "restarted",
        },
        reverbPort: report.services.reverb === "restarted" ? reverbPort : undefined,
        reverbDomain,
      });

      report.health = {
        apiCheck: healthRes.api.checked
          ? {
              url: healthRes.api.url!,
              status: healthRes.api.healthy ? "healthy" : "unhealthy",
              code: healthRes.api.statusCode,
            }
          : undefined,
        servicesCheck: healthRes.services.checked
          ? {
              allActive: healthRes.services.allActive,
              details: healthRes.services.details,
            }
          : undefined,
      };

      const healthDuration = Date.now() - healthStepStart;
      if (healthRes.overallHealthy) {
        healthSpin.succeed(`Health checks passed in ${(healthDuration / 1000).toFixed(1)}s`);
        recordStep("health", "All health checks passed", "success", healthDuration);
      } else {
        healthSpin.warn("Health checks completed with warnings");
        recordStep("health", "Some health checks warning/unhealthy", "success", healthDuration);
      }
    } catch (err: any) {
      report.status = "failed";
      report.error = err.message;
    } finally {
      await releaseDeployLock(projectDir);
      report.finishedAt = new Date().toISOString();
      report.durationSeconds = parseFloat(((Date.now() - startTime) / 1000).toFixed(2));
      await saveDeploymentReport(report);
    }

    return report;
  }
}

export const deploymentPipeline = new DeploymentPipeline();
