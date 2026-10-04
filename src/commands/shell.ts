import { resolve, basename } from "node:path";
import { spawn } from "node:child_process";
import { log, heading } from "../utils/logger.js";
import { getProject } from "../state/store.js";
import { loadConfig } from "../config/loader.js";
import { getPlatform } from "../platform/index.js";
import { which } from "../utils/exec.js";
import { SHELL_ARGS, type ShellName } from "../config/enums.js";

interface ShellOptions {
  dir?: string;
  /** Honoured, and constrained to SHELLS by Commander. */
  shell?: ShellName;
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

  // Choose the shell.
  //
  // `--shell` used to be advertised in the help text and then ignored: this line
  // read only `process.env.SHELL`, so `orkestra shell --shell fish` opened the
  // user's login shell and said nothing about it. Commander now constrains the
  // value to a known set, and it is honoured here.
  //
  // Falling back to `$SHELL` and then to the platform default keeps the existing
  // behaviour for everyone who does not pass the flag.
  const platform = getPlatform();
  const requested = options.shell;

  // Binary to execute, and how to ask it for an interactive session.
  let shellBinary: string;
  let shellArgs: string[];

  if (requested) {
    // Only spawn it if it actually resolves; otherwise say so rather than
    // starting something that is not there.
    const resolved = await which(requested);
    if (!resolved) {
      throw new Error(
        `Shell "${requested}" was not found on PATH. ` +
          `Available: ${Object.keys(SHELL_ARGS).join(", ")}.`,
      );
    }
    shellBinary = resolved;
    shellArgs = SHELL_ARGS[requested];
  } else {
    shellBinary = process.env.SHELL || platform.shell;
    shellArgs = platform.shellArgs;
  }

  // Spawn interactive shell
  const child = spawn(shellBinary, shellArgs, {
    cwd: projectDir,
    stdio: "inherit",
    env,
  });

  // Wait for shell to exit
  child.on("exit", (code: number | null) => {
    process.exit(code ?? 0);
  });
}
