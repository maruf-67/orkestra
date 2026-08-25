import { resolve, basename } from "node:path";
import { spawn } from "node:child_process";
import { log, heading } from "../utils/logger.js";
import { getProject } from "../state/store.js";
import { loadConfig } from "../config/loader.js";
import { getPlatform } from "../platform/index.js";

interface ShellOptions {
  dir?: string;
}

export async function shell(options: ShellOptions) {
  heading("Open Project Shell");

  const projectDir = resolve(options.dir || process.cwd());
  const project = await getProject(projectDir);
  const config = await loadConfig(projectDir);

  const projectName = project?.name || config?.name || basename(projectDir);

  // Build environment variables
  const env: Record<string, string> = {
    ...process.env,
    ORKESTRA_PROJECT: projectName,
    ORKESTRA_DIR: projectDir,
  };

  if (project) {
    env.ORKESTRA_DOMAIN = project.domain;
    env.ORKESTRA_PORT = String(project.port);
    env.ORKESTRA_FRAMEWORK = project.framework;
    env.ORKESTRA_PROXY = project.proxy;

    if (project.pid) {
      env.ORKESTRA_PID = String(project.pid);
    }
  }

  if (config) {
    if (config.startCommand) {
      env.ORKESTRA_START_COMMAND = config.startCommand;
    }
  }

  log.plain(`Opening shell for ${projectName}`);
  log.dim("Environment variables set:");
  log.dim(`  ORKESTRA_PROJECT=${projectName}`);
  log.dim(`  ORKESTRA_DIR=${projectDir}`);
  if (project) {
    log.dim(`  ORKESTRA_DOMAIN=${project.domain}`);
    log.dim(`  ORKESTRA_PORT=${project.port}`);
    log.dim(`  ORKESTRA_FRAMEWORK=${project.framework}`);
  }
  log.plain("");

  // Get platform shell
  const platform = getPlatform();
  const shell = process.env.SHELL || platform.shell;
  const shellArgs = platform.shellArgs;

  // Spawn interactive shell
  const child = spawn(shell, shellArgs, {
    cwd: projectDir,
    stdio: "inherit",
    env,
  });

  // Wait for shell to exit
  child.on("exit", (code) => {
    process.exit(code ?? 0);
  });
}
