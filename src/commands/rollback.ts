import { resolve, basename } from "node:path";
import { log, heading, spinner } from "../utils/logger.js";
import { loadConfig } from "../config/loader.js";
import { getLastSuccessfulDeployment, getDeploymentHistory } from "../deployment/history.js";
import { checkoutCommit } from "../deployment/git.js";
import { installComposerDependencies } from "../deployment/composer.js";
import { optimizeLaravel } from "../deployment/laravel.js";
import { servicesManager } from "../services/manager.js";
import { detectCapabilities } from "../deployment/detector.js";
import { performDeploymentHealthChecks } from "../deployment/health.js";

interface RollbackOptions {
  dir?: string;
  project?: string;
  to?: string;
  dryRun?: boolean;
}

export async function rollback(options: RollbackOptions) {
  heading("Rollback Deployment");

  const projectDir = resolve(options.dir || process.cwd());
  const config = await loadConfig(projectDir);
  const projectName = options.project || config?.name || basename(projectDir);

  const history = await getDeploymentHistory(projectName, 5);
  if (history.length === 0) {
    log.error(`No deployment history found for ${projectName}`);
    process.exit(1);
  }

  let targetCommit = options.to;
  let targetRecord = null;

  if (!targetCommit) {
    // Find the previous commit before current
    const lastSuccess = await getLastSuccessfulDeployment(projectName);
    if (!lastSuccess || !lastSuccess.previousCommit) {
      log.error(`Cannot find previous commit to rollback to for ${projectName}`);
      process.exit(1);
    }
    targetCommit = lastSuccess.previousCommit;
    targetRecord = lastSuccess;
  }

  log.info(`Target commit for rollback: ${targetCommit.substring(0, 7)}`);

  if (options.dryRun) {
    log.info(`[Dry Run] Rollback preview for ${projectName}:`);
    log.plain(`  • Git: checkout ${targetCommit.substring(0, 7)}`);
    log.plain(`  • Composer: reinstall dependencies`);
    log.plain(`  • Laravel: clear and rebuild optimized caches`);
    log.plain(`  • Services: restart Octane, Queue, and Reverb`);
    return;
  }

  const spin = spinner(`Rolling back to commit ${targetCommit.substring(0, 7)}...`);
  spin.start();

  try {
    // 1. Checkout commit
    await checkoutCommit(projectDir, targetCommit);
    spin.text = "Reinstalling composer dependencies...";

    const capabilities = await detectCapabilities(projectDir);

    // 2. Composer install
    await installComposerDependencies({
      composerBinary: capabilities.composerBinary,
      cwd: projectDir,
    });

    // 3. Optimize
    if (capabilities.isLaravel) {
      spin.text = "Rebuilding Laravel optimization cache...";
      await optimizeLaravel({
        phpBinary: capabilities.phpBinary,
        cwd: projectDir,
      });
    }

    // 4. Restart services
    spin.text = "Restarting systemd services...";
    await servicesManager.restartProjectServices(projectName, {
      octane: capabilities.hasOctane,
      queue: capabilities.hasQueue,
      reverb: capabilities.hasReverb,
    });

    // 5. Health checks
    spin.text = "Verifying health...";
    const health = await performDeploymentHealthChecks({
      projectName,
      services: {
        octane: capabilities.hasOctane,
        queue: capabilities.hasQueue,
        reverb: capabilities.hasReverb,
      },
    });

    spin.succeed(`Successfully rolled back to ${targetCommit.substring(0, 7)}`);
    log.success(`Rollback completed in ${(health.overallHealthy ? "healthy" : "warning")} state.`);
  } catch (err: any) {
    spin.fail(`Rollback failed: ${err.message}`);
    process.exit(1);
  }
}
