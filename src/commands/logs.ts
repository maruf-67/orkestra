import { resolve, basename } from "node:path";
import { log, heading } from "../utils/logger.js";
import { getProject, isProcessAlive } from "../state/store.js";
import { loadConfig } from "../config/loader.js";
import { readLogs, streamLogs, getLogPath, listLogFiles } from "../utils/logger-file.js";

interface LogsOptions {
  dir?: string;
  follow?: boolean;
  since?: string;
  stream?: "stdout" | "stderr";
  limit?: number;
  list?: boolean;
}

function parseSince(since: string): Date {
  // Support formats: "5m", "1h", "2d", "2024-01-01", "2024-01-01T12:00:00"
  const relativeMatch = since.match(/^(\d+)([mhd])$/);
  if (relativeMatch) {
    const amount = parseInt(relativeMatch[1]);
    const unit = relativeMatch[2];
    const now = new Date();
    switch (unit) {
      case "m":
        return new Date(now.getTime() - amount * 60 * 1000);
      case "h":
        return new Date(now.getTime() - amount * 60 * 60 * 1000);
      case "d":
        return new Date(now.getTime() - amount * 24 * 60 * 60 * 1000);
    }
  }
  return new Date(since);
}

export async function logs(options: LogsOptions) {
  heading("Server Logs");

  const projectDir = resolve(options.dir || process.cwd());

  // List log files mode
  if (options.list) {
    const files = await listLogFiles(projectDir);
    if (files.length === 0) {
      log.warn("No log files found.");
      log.info("Start a server with `orkestra up` to generate logs.");
      return;
    }
    log.plain("Log files:");
    for (const file of files) {
      log.plain(`  ${file}`);
    }
    return;
  }

  // Get project info
  const project = await getProject(projectDir);
  const config = await loadConfig(projectDir);
  const projectName = config?.name || basename(projectDir);

  // Check if log file exists
  const logPath = getLogPath(projectDir, projectName);

  // Parse --since option
  let since: Date | undefined;
  if (options.since) {
    since = parseSince(options.since);
  }

  // Follow mode - stream logs in real-time
  if (options.follow) {
    log.info(`Following logs for ${projectName}...`);
    log.dim("Press Ctrl+C to stop\n");

    await streamLogs(projectDir, projectName, {
      since,
      stream: options.stream,
    });
    return;
  }

  // Read mode - show historical logs
  const entries = await readLogs(projectDir, projectName, {
    since,
    stream: options.stream,
    limit: options.limit || 100,
  });

  if (entries.length === 0) {
    if (project?.pid && await isProcessAlive(project.pid)) {
      log.warn(`No logs found for ${projectName}.`);
      log.info("Logs are captured when server runs in background mode.");
      log.dim(`Log file: ${logPath}`);
    } else {
      log.warn(`No logs found for ${projectName}.`);
      log.info("Start a server with `orkestra up` to generate logs.");
    }
    return;
  }

  log.plain(`Logs for ${projectName} (${entries.length} entries):\n`);

  for (const entry of entries) {
    const color = entry.stream === "stderr" ? "\x1b[31m" : "\x1b[36m";
    const reset = "\x1b[0m";
    const ts = entry.timestamp.toISOString().slice(11, 19);
    console.log(`${color}[${ts}] [${entry.stream}]${reset} ${entry.message}`);
  }
}
