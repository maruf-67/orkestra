import { resolve, basename, join } from "node:path";
import { writeFile, unlink, readFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { loadConfig } from "../config/loader.js";
import { providerRegistry } from "./providers/registry.js";
import { resolveBinaries } from "../services/mise-resolver.js";
import type { ResolvedBinaries } from "../services/mise-resolver.js";
import { syncGitBranch, getCurrentGitInfo } from "./git.js";
import { systemd } from "../services/systemd.js";
import { CaddyProxy } from "../providers/proxy/caddy.js";
import { performDeploymentHealthChecks } from "./health.js";
import { saveDeploymentReport } from "./history.js";
import { freezeAgainstState, resolvePorts } from "./ports.js";
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

    let initialGit: Awaited<ReturnType<typeof getCurrentGitInfo>> = null;
    let resolved: Awaited<ReturnType<typeof providerRegistry.resolve>> = null;
    let binaries: ResolvedBinaries;
    let binaryError: string | undefined;

    try {
      initialGit = await getCurrentGitInfo(projectDir);
      resolved = await providerRegistry.resolve(projectDir);

      // Toolchain resolution is strict for a real deploy, because a bare `php`
      // baked into systemd ExecStart is worse than a refusal. A dry run is the
      // opposite case: being unable to resolve php is precisely what a preview
      // exists to report, so it must always render and say what is missing.
      try {
        binaries = await resolveBinaries(projectDir);
      } catch (err) {
        if (!options.dryRun) throw err;
        binaryError = err instanceof Error ? err.message : String(err);
        binaries = {
          php: "php",
          composer: "composer",
          node: "node",
          bun: "bun",
          pnpm: "pnpm",
          yarn: "yarn",
          npm: "npm",
          isMise: false,
        };
      }
    } catch (err) {
      // Failures before the deployment lock used to propagate as a bare throw,
      // leaving no trace in deploy history. That made the worst failures — an
      // unresolvable toolchain, an undetectable framework — invisible to
      // `orkestra rollback` and `orkestra audit --history`, which is exactly
      // when an operator most wants to see them.
      await this.recordPreLockFailure(
        { projectDir, projectName, branch: targetBranch, initialGit },
        err,
      );
      throw err;
    }

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

      // Report the toolchain problem rather than letting the preview abort on
      // it — this is the information the user came to get.
      if (binaryError) {
        log.plain("");
        log.warn(`Toolchain incomplete — a real deploy would stop here:`);
        log.plain(`  ${binaryError}`);
        log.plain(`  Resolved fallbacks: php=${binaries.php} composer=${binaries.composer}`);
      }
      return report;
    }

    if (!resolved) {
      const err = new Error(
        `Could not determine application framework provider for ${projectDir}`,
      );
      await this.recordPreLockFailure(
        { projectDir, projectName, branch: targetBranch, initialGit },
        err,
      );
      throw err;
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

      // Preserve deployed port/domain/reverb after git reset — .orkestra.yml may revert to repo default
      const existingProject = await getProject(projectDir);
      if (existingProject) {
        const freshConfig = await loadConfig(projectDir);
        if (freshConfig) {
          const before = resolvePorts(freshConfig, { projectName });
          const merged = freezeAgainstState(freshConfig, existingProject);
          const after = resolvePorts(merged, { projectName });

          if (before.apiPort !== after.apiPort) {
            log.warn(`Config port ${before.apiPort} differs from deployed ${after.apiPort} — preserving deployed port.`);
          }
          if (before.apiDomain !== after.apiDomain) {
            log.warn(`Config domain ${before.apiDomain} differs from deployed ${after.apiDomain} — preserving deployed domain.`);
          }
          if (before.reverbPort !== after.reverbPort) {
            log.warn(`Config reverbPort ${before.reverbPort} differs from deployed ${after.reverbPort} — preserving.`);
          }

          context.config = merged;
          report.proxy.apiDomain = after.apiDomain;
          report.proxy.apiPort = after.apiPort;
        } else {
          // Config missing after reset — keep state as the only source of truth
          context.config = freezeAgainstState(config, existingProject);
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
          const unitNames: string[] = [];

          for (const srv of serviceDefs) {
            await systemd.installService(srv.type, undefined, {
              projectName,
              projectPath: projectDir,
              port: srv.port,
              execStart: srv.command,
              phpBinary: binaries.php,
              nodeBinary: binaries.node,
              bunBinary: binaries.bun,
              octanePort: srv.type === "octane" ? srv.port : undefined,
              // Reverb's unit template renders {{REVERB_PORT}}; without this the
              // manager falls back to a hardcoded 8080 and silently rebinds the
              // WebSocket server on every deploy.
              reverbPort: srv.type === "reverb" ? srv.port : undefined,
              octaneServer: srv.octaneServer,
              maxRequests: srv.maxRequests,
              queueConnection: srv.queueConnection,
              queues: srv.queues,
              sleep: srv.queueSleep,
              tries: srv.queueTries,
              timeout: srv.queueTimeout,
              maxJobs: srv.queueMaxJobs,
              maxTime: srv.queueMaxTime,
            });
            unitNames.push(systemd.getServiceName(projectName, srv.type));
          }

          // Restart every unit first, then settle once. Verifying per service
          // would add one wait window per unit, which is noticeable on a Laravel
          // deploy that brings up web, queue and Reverb together.
          //
          // A successful `systemctl restart` only means the unit was started.
          // With Restart=always a unit that dies immediately keeps looping and
          // still reports success, so confirm each one stayed up before the
          // deploy is called healthy.
          const states = await systemd.restartManyAndVerify(unitNames);

          const broken = unitNames
            .map((name, i) => ({ name, state: states[i] }))
            .filter((u) => u.state !== "active");

          if (broken.length > 0) {
            const details = await Promise.all(
              broken.map(async (u) => `--- ${u.name} (${u.state}) ---\n${await systemd.journal(u.name, 15)}`),
            );
            throw new Error(
              `${broken.length} systemd unit(s) did not stay up after restart: ` +
                broken.map((u) => `${u.name} [${u.state}]`).join(", ") +
                `\n\n${details.join("\n\n")}`,
            );
          }

          for (const srv of serviceDefs) {
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
          const existingProject2 = await getProject(projectDir);
          const reverbDef = proxyDefs.find((p) => p.websocket);
          const ports = resolvePorts(context.config, {
            projectName,
            state: existingProject2,
          });

          await registerProject({
            name: projectName,
            domain: primary.domain,
            port: primary.port,
            framework: detection.framework,
            proxy: "caddy",
            path: projectDir,
            registeredAt: existingProject2?.registeredAt || new Date().toISOString(),
            reverbPort: reverbDef?.port ?? ports.reverbPort,
            reverbDomain: reverbDef?.domain ?? ports.reverbDomain,
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
          // A deploy that restarts services against a proxy that was never
          // written is a broken deploy. Do not report it as success.
          throw err;
        }
      }

      // Step 8: Health Checks
      const healthDefs = await provider.healthChecks(context, detection);
      const healthSpin = spinner("Running health checks...");
      healthSpin.start();
      const healthStepStart = Date.now();

      let allHealthy = true;
      const healthResults: Array<{ overallHealthy: boolean }> = [];
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
        healthResults.push(res);
        if (!res.overallHealthy) allHealthy = false;
      }

      const healthDuration = Date.now() - healthStepStart;
      const failedChecks: string[] = [];
      for (const [i, h] of healthDefs.entries()) {
        const label = h.apiUrl ? `api ${h.apiUrl}` : `reverb ${h.domain || `port ${h.port}`}`;
        if (!healthResults[i].overallHealthy) failedChecks.push(label);
      }

      if (allHealthy) {
        healthSpin.succeed(`Health checks passed in ${(healthDuration / 1000).toFixed(1)}s`);
        recordStep("health", "All health checks passed", "success", healthDuration);
      } else {
        // Surface the failure instead of logging a warning: a deploy whose
        // health checks fail must not be reported as a successful deployment.
        const detail = `Unhealthy: ${failedChecks.join(", ")}`;
        healthSpin.fail(`Health checks failed — ${detail}`);
        recordStep("health", `Health checks failed (${detail})`, "failed", healthDuration);
        throw new Error(`Deployment health checks failed. ${detail}`);
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

  /**
   * Persist a deployment failure that happened before the lock was acquired.
   *
   * The main try/catch only wraps the steps from "acquire lock" onwards, so
   * anything that fails earlier — resolving the toolchain, detecting the
   * framework — used to escape as a bare throw with no history entry. Recording
   * it here keeps `orkestra rollback` and `orkestra audit --history` complete.
   *
   * Best-effort by design: if the report cannot be written the original error
   * must still propagate, so a failure to record never masks the real problem.
   */
  private async recordPreLockFailure(
    context: {
      projectDir: string;
      projectName: string;
      branch: string;
      initialGit: { commit?: string; branch?: string } | null;
    },
    error: unknown,
  ): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    const now = new Date().toISOString();

    const report: DeploymentReport = {
      projectName: context.projectName,
      projectPath: context.projectDir,
      branch: context.branch,
      commit: context.initialGit?.commit || "HEAD",
      startedAt: now,
      finishedAt: now,
      durationSeconds: 0,
      status: "failed",
      steps: [
        {
          name: "preflight",
          description: "Preflight checks (toolchain and framework detection)",
          status: "failed",
          durationMs: 0,
          error: message,
        },
      ],
      capabilities: {
        isLaravel: false,
        hasOctane: false,
        octaneServer: "none",
        hasReverb: false,
        hasQueue: false,
        queueConnection: "redis",
        hasCaddy: false,
        hasMise: false,
      },
      services: {},
      proxy: { status: "skipped" },
      health: {},
      error: message,
    };

    try {
      await saveDeploymentReport(report);
    } catch {
      // Recording is best-effort; the caller rethrows the original error.
    }
  }
}

export const deploymentPipeline = new DeploymentPipeline();
