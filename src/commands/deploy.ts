import { resolve, basename } from "node:path";
import { log, heading, table, spinner } from "../utils/logger.js";
import { loadConfig } from "../config/loader.js";
import { deploymentPipeline } from "../deployment/pipeline.js";
import { remoteExecutor } from "../remote/ssh.js";
import prompts from "prompts";

interface DeployOptions {
  dir?: string;
  branch?: string;
  strategy?: "reset" | "pull";
  dryRun?: boolean;
  noMigrate?: boolean;
  noRestart?: boolean;
  force?: boolean;
  remote?: string;
  yes?: boolean;
}

export async function deploy(options: DeployOptions) {
  heading("Orkestra Production Deployment");

  const projectDir = resolve(options.dir || process.cwd());
  const config = await loadConfig(projectDir);
  const projectName = config?.name || basename(projectDir);
  const targetBranch = options.branch || config?.deployment?.branch || "main";

  // Check if remote deployment is requested
  const remoteHost = options.remote || config?.deployment?.remote?.host;
  if (remoteHost && !options.dir) {
    const remoteConfig = config?.deployment?.remote || {
      host: remoteHost,
      path: projectDir,
    };

    log.info(`Target server: ${remoteConfig.host}`);
    log.info(`Remote path:   ${remoteConfig.path}`);
    log.info(`Branch:        ${targetBranch}`);

    if (!options.yes && !options.dryRun) {
      const confirm = await prompts({
        type: "confirm",
        name: "proceed",
        message: `Deploy ${projectName} to remote ${remoteConfig.host}?`,
        initial: true,
      });
      if (!confirm.proceed) {
        log.warn("Deployment aborted by user.");
        return;
      }
    }

    const testSpin = spinner("Testing remote SSH connection...");
    testSpin.start();
    const isConnOk = await remoteExecutor.testConnection(remoteConfig);
    if (!isConnOk) {
      testSpin.fail(`Cannot establish SSH connection to ${remoteConfig.host}`);
      log.dim("Verify your SSH key or ~/.ssh/config host entry.");
      process.exit(1);
    }
    testSpin.succeed("SSH connection verified");

    let remoteCmd = `orkestra deploy --branch ${targetBranch}`;
    if (options.dryRun) remoteCmd += " --dry-run";
    if (options.noMigrate) remoteCmd += " --no-migrate";
    if (options.noRestart) remoteCmd += " --no-restart";
    if (options.yes) remoteCmd += " --yes";

    log.plain(`\nExecuting on remote: \x1b[36m${remoteCmd}\x1b[0m\n`);

    const remoteRes = await remoteExecutor.execute(remoteConfig, remoteCmd, {
      cwd: remoteConfig.path,
    });

    if (remoteRes.stdout) console.log(remoteRes.stdout);
    if (remoteRes.stderr) console.error(remoteRes.stderr);

    if (remoteRes.exitCode === 0) {
      log.success(`Remote deployment to ${remoteConfig.host} finished successfully.`);
    } else {
      log.error(`Remote deployment failed with exit code ${remoteRes.exitCode}`);
      process.exit(1);
    }
    return;
  }

  // Local / On-Server Deployment Pipeline
  if (!options.yes && !options.dryRun) {
    const confirm = await prompts({
      type: "confirm",
      name: "proceed",
      message: `Deploy ${projectName} on branch '${targetBranch}'?`,
      initial: true,
    });
    if (!confirm.proceed) {
      log.warn("Deployment aborted by user.");
      return;
    }
  }

  const report = await deploymentPipeline.execute({
    dir: projectDir,
    branch: targetBranch,
    strategy: options.strategy,
    dryRun: options.dryRun,
    noMigrate: options.noMigrate,
    noRestart: options.noRestart,
  });

  if (options.dryRun) return;

  log.plain("");
  if (report.status === "success") {
    heading("Deployment Summary");
    table([
      ["Project", report.projectName],
      ["Branch", report.branch],
      ["Commit", report.commit.substring(0, 7)],
      ["Status", "\x1b[32m✓ Successful\x1b[0m"],
      ["Duration", `${report.durationSeconds}s`],
      ["API Domain", report.proxy.apiDomain || "-"],
      ["Reverb WSS", report.proxy.reverbDomain || "-"],
      ["Octane Service", report.services.octane || "skipped"],
      ["Queue Worker", report.services.queue || "skipped"],
      ["Reverb Service", report.services.reverb || "skipped"],
    ]);

    log.plain("");
    log.success(`🚀 Deployment completed in ${report.durationSeconds}s`);
  } else {
    heading("Deployment Failed");
    log.error(report.error || "Deployment encountered errors");
    log.plain("");
    log.dim("Inspect recent logs with: orkestra logs");
    log.dim("Rollback to previous release with: orkestra rollback");
    process.exit(1);
  }
}
