import { resolve, basename, join } from "node:path";
import { writeFile, unlink, readFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { loadConfig } from "../config/loader.js";
import { providerRegistry } from "./providers/registry.js";
import { resolveBinaries } from "../services/mise-resolver.js";
import { syncGitBranch, getCurrentGitInfo } from "./git.js";
import { systemd } from "../services/systemd.js";
import { CaddyProxy } from "../providers/proxy/caddy.js";
import { performDeploymentHealthChecks } from "./health.js";
import { saveDeploymentReport } from "./history.js";
import type { DeploymentOptions, DeploymentReport, DeploymentStep } from "./types.js";
import type { DeploymentContext } from "./providers/types.js";
import { log, spinner } from "../utils/logger.js";
import { registerProject, getProject } from "../state/store.js";

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
    const binaries = await resolveBinaries(projectDir);
    const resolved = await providerRegistry.resolve(projectDir);

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
      capabilities: {
        isLaravel: resolved?.detection.framework === "laravel",
        laravelVersion: resolved?.detection.framework === "laravel" ? resolved.detection.version : undefined,
        hasOctane: Boolean(resolved?.detection.capabilities.hasOctane),
        octaneServer: resolved?.detection.capabilities.octaneServer || "none",
        hasReverb: Boolean(resolved?.detection.capabilities.hasReverb),
        hasQueue: Boolean(resolved?.detection.capabilities.hasQueue),
        queueConnection: "redis",
        hasCaddy: true,
        hasMise: binaries.isMise,
        phpBinary: binaries.php,
        composerBinary: binaries.composer,
      },
      services: {},
      proxy: { status: "skipped" },
      health: {},
    };

    const context: DeploymentContext = {
      projectDir,
      projectName,
      branch: targetBranch,
      config,
      binaries,
      options,
    };

    // Dry Run Mode
    if (options.dryRun) {
      log.info(`[Dry Run] Deployment preview for ${projectName} (Branch: ${targetBranch})`);
      log.plain(`  • Framework:       ${resolved?.detection.framework || "generic"} (${resolved?.detection.version || "unknown"})`);
      log.plain(`  • Package Manager: ${resolved?.detection.packageManager || "npm"}`);
      log.plain(`  • Runtime:         ${resolved?.detection.runtime || "node"} (${binaries.isMise ? "Mise managed" : "system"})`);
      log.plain(`  • Strategy:        git ${strategy} origin/${targetBranch}`);
      log.plain(`  • Build:           ${resolved?.detection.buildCommand || "none"}`);
      log.plain(`  • Start:           ${resolved?.detection.startCommand || "none"}`);
      return report;
    }

    if (!resolved) {
      throw new Error(`Could not determine application framework provider for ${projectDir}`);
    }

    const { provider, detection } = resolved;

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

      // Preserve deployed port/domain after git reset — .orkestra.yml may revert to repo default
      const existingProject = await getProject(projectDir);
      if (existingProject) {
        const freshConfig = await loadConfig(projectDir);
        if (freshConfig) {
          let mutated = false;
          const stateDomain = existingProject.domain;
          const statePort = existingProject.port;
          // Domain drift guard
          if (freshConfig.domain && freshConfig.domain !== stateDomain) {
            log.warn(`Config domain ${freshConfig.domain} differs from deployed ${stateDomain} — preserving deployed domain.`);
            freshConfig.domain = stateDomain;
            mutated = true;
          } else if (!freshConfig.domain && stateDomain) {
            freshConfig.domain = stateDomain;
            mutated = true;
          }
          if (freshConfig.port && freshConfig.port !== statePort) {
            log.warn(`Config port ${freshConfig.port} differs from deployed ${statePort} — preserving deployed port.`);
            freshConfig.port = statePort;
            mutated = true;
          } else if (!freshConfig.port && statePort) {
            freshConfig.port = statePort;
            mutated = true;
          }
          // Reverb port/domain drift guard
          const reverbState = (existingProject as any).reverbPort as number | undefined;
          if (reverbState && freshConfig.reverbPort !== reverbState) {
            freshConfig.reverbPort = reverbState;
            mutated = true;
          }
          if (mutated) {
            // Update in-memory config used by providers; do not overwrite file (git-controlled)
            context.config = freshConfig;
            report.proxy.apiDomain = freshConfig.domain;
            report.proxy.apiPort = freshConfig.port;
          } else {
            context.config = freshConfig;
          }
        } else if (existingProject) {
          // No config after reset (deleted) — keep state in context for providers
          context.config = { ...config, domain: existingProject.domain, port: existingProject.port } as any;
        }
      }

      // Step 3: Install Dependencies
      const depSpin = spinner(`Installing dependencies (${detection.packageManager})...`);
      depSpin.start();
      try {
        const depRes = await provider.installDependencies(context);
        depSpin.succeed(`Dependencies installed in ${(depRes.durationMs / 1000).toFixed(1)}s`);
        recordStep("dependencies", `Installed dependencies with ${detection.packageManager}`, "success", depRes.durationMs);
      } catch (err: any) {
        depSpin.fail(`Dependencies installation failed: ${err.message}`);
        recordStep("dependencies", "Dependency installation failed", "failed", undefined, err.message);
        throw err;
      }

      // Step 4: Prepare Phase (Migrations, storage links, etc.)
      try {
        await provider.prepare(context);
        recordStep("prepare", "Application preparation completed", "success");
      } catch (err: any) {
        recordStep("prepare", "Preparation failed", "failed", undefined, err.message);
        throw err;
      }

      // Step 5: Build Phase
      const buildSpin = spinner(`Building application (${detection.framework})...`);
      buildSpin.start();
      try {
        const buildRes = await provider.build(context);
        buildSpin.succeed(`Application built in ${(buildRes.durationMs / 1000).toFixed(1)}s`);
        recordStep("build", "Application build complete", "success", buildRes.durationMs);
      } catch (err: any) {
        buildSpin.fail(`Build failed: ${err.message}`);
        recordStep("build", "Build failed", "failed", undefined, err.message);
        throw err;
      }

      // Step 6: Services Provisioning & Restart
      if (!options.noRestart) {
        const srvSpin = spinner("Configuring & restarting systemd services...");
        srvSpin.start();
        const srvStepStart = Date.now();
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

            if (srv.type === "octane") report.services.octane = "restarted";
            else if (srv.type === "queue") report.services.queue = "restarted";
            else if (srv.type === "reverb") report.services.reverb = "restarted";
          }

          const duration = Date.now() - srvStepStart;
          srvSpin.succeed(`Systemd services configured & restarted in ${(duration / 1000).toFixed(1)}s`);
          recordStep("services", "Systemd services running", "success", duration);
        } catch (err: any) {
          srvSpin.fail(`Service management failed: ${err.message}`);
          recordStep("services", "Service restart failed", "failed", Date.now() - srvStepStart, err.message);
          throw err;
        }
      } else {
        recordStep("services", "Skipped service restart (--no-restart)", "skipped");
      }

      // Step 7: Proxy Configuration
      const proxyDefs = await provider.proxy(context, detection);
      const caddy = new CaddyProxy();
      if (await caddy.detect() && proxyDefs.length > 0) {
        const proxySpin = spinner("Configuring Caddy reverse proxy...");
        proxySpin.start();
        const proxyStepStart = Date.now();
        try {
          await caddy.registerMultiple(
            proxyDefs.map((p) => ({
              domain: p.domain,
              port: p.port,
              ssl: p.ssl ?? true,
            }))
          );

          const primary = proxyDefs[0];
          const existingProject = await getProject(projectDir);

          await registerProject({
            name: projectName,
            domain: primary.domain,
            port: primary.port,
            framework: detection.framework,
            proxy: "caddy",
            path: projectDir,
            registeredAt: existingProject?.registeredAt || new Date().toISOString(),
          });

          report.proxy = {
            apiDomain: primary.domain,
            apiPort: primary.port,
            reverbDomain: proxyDefs.find((p) => p.websocket)?.domain,
            reverbPort: proxyDefs.find((p) => p.websocket)?.port,
            status: "configured",
          };

          const duration = Date.now() - proxyStepStart;
          proxySpin.succeed(`Caddy proxy configured in ${(duration / 1000).toFixed(1)}s`);
          recordStep("proxy", "Caddy proxy configured", "success", duration);
        } catch (err: any) {
          proxySpin.fail(`Proxy configuration failed: ${err.message}`);
          report.proxy.status = "failed";
          recordStep("proxy", "Proxy configuration failed", "failed", Date.now() - proxyStepStart, err.message);
        }
      }

      // Step 8: Health Checks
      const healthDefs = await provider.healthChecks(context, detection);
      const healthSpin = spinner("Running health checks...");
      healthSpin.start();
      const healthStepStart = Date.now();

      let allHealthy = true;
      for (const h of healthDefs) {
        const res = await performDeploymentHealthChecks({
          apiUrl: h.apiUrl,
          expectedStatus: h.expectedStatus,
          timeoutMs: h.timeoutMs,
          projectName,
          reverbPort: h.port,
          reverbDomain: h.domain,
          services: {
            octane: report.services.octane === "restarted",
            queue: report.services.queue === "restarted",
            reverb: report.services.reverb === "restarted",
          },
        });
        if (!res.overallHealthy) allHealthy = false;
      }

      const healthDuration = Date.now() - healthStepStart;
      if (allHealthy) {
        healthSpin.succeed(`Health checks passed in ${(healthDuration / 1000).toFixed(1)}s`);
        recordStep("health", "All health checks passed", "success", healthDuration);
      } else {
        healthSpin.fail("Health checks completed with warnings");
        recordStep("health", "Health checks warning", "success", healthDuration);
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
