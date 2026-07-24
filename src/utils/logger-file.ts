import { resolve, join } from "node:path";
import { mkdir, writeFile, readFile, stat, readdir } from "node:fs/promises";
import { existsSync, createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { getPlatform } from "../platform/index.js";

const LOG_DIR = "logs";
const MAX_LOG_SIZE = 10 * 1024 * 1024; // 10MB per log file

function getLogsDir(projectDir: string): string {
  return join(projectDir, ".orkestra", LOG_DIR);
}

function getLogFilePath(projectDir: string, projectName: string): string {
  const logsDir = getLogsDir(projectDir);
  return join(logsDir, `${projectName}.log`);
}

export interface LogEntry {
  timestamp: Date;
  stream: "stdout" | "stderr";
  message: string;
}

/**
 * Ensure log directory exists.
 */
async function ensureLogDir(projectDir: string): Promise<void> {
  const logsDir = getLogsDir(projectDir);
  if (!existsSync(logsDir)) {
    await mkdir(logsDir, { recursive: true });
  }
}

/**
 * Format a log entry for writing.
 */
function formatLogEntry(entry: LogEntry): string {
  const ts = entry.timestamp.toISOString();
  return `[${ts}] [${entry.stream}] ${entry.message}`;
}

/**
 * Parse a log line back into a LogEntry.
 */
function parseLogLine(line: string): LogEntry | null {
  const match = line.match(/^\[(.+?)\] \[(stdout|stderr)\] (.+)$/);
  if (!match) return null;
  return {
    timestamp: new Date(match[1]),
    stream: match[2] as "stdout" | "stderr",
    message: match[3],
  };
}

/**
 * Write a log entry to the project's log file.
 */
export async function writeLog(
  projectDir: string,
  projectName: string,
  entry: LogEntry
): Promise<void> {
  await ensureLogDir(projectDir);
  const logPath = getLogFilePath(projectDir, projectName);

  // Check if log file exceeds max size, rotate if needed
  if (existsSync(logPath)) {
    const fileStat = await stat(logPath);
    if (fileStat.size > MAX_LOG_SIZE) {
      const rotatedPath = `${logPath}.${Date.now()}`;
      const { rename } = await import("node:fs/promises");
      await rename(logPath, rotatedPath);
    }
  }

  const line = formatLogEntry(entry) + "\n";
  const { appendFile } = await import("node:fs/promises");
  await appendFile(logPath, line, "utf-8");
}

/**
 * Read log entries from a project's log file.
 */
export async function readLogs(
  projectDir: string,
  projectName: string,
  options?: {
    since?: Date;
    stream?: "stdout" | "stderr";
    limit?: number;
  }
): Promise<LogEntry[]> {
  const logPath = getLogFilePath(projectDir, projectName);

  if (!existsSync(logPath)) {
    return [];
  }

  const content = await readFile(logPath, "utf-8");
  const lines = content.split("\n").filter(Boolean);

  let entries: LogEntry[] = [];
  for (const line of lines) {
    const entry = parseLogLine(line);
    if (!entry) continue;

    // Filter by time
    if (options?.since && entry.timestamp < options.since) {
      continue;
    }

    // Filter by stream
    if (options?.stream && entry.stream !== options.stream) {
      continue;
    }

    entries.push(entry);
  }

  // Apply limit (most recent entries)
  if (options?.limit) {
    entries = entries.slice(-options.limit);
  }

  return entries;
}

/**
 * Stream log entries in real-time (for --follow mode).
 */
export async function streamLogs(
  projectDir: string,
  projectName: string,
  options?: {
    since?: Date;
    stream?: "stdout" | "stderr";
  }
): Promise<void> {
  const logPath = getLogFilePath(projectDir, projectName);

  if (!existsSync(logPath)) {
    console.log("No logs found. Waiting for output...");
  }

  // First, read existing entries
  const existingEntries = await readLogs(projectDir, projectName, options);
  for (const entry of existingEntries) {
    const color = entry.stream === "stderr" ? "\x1b[31m" : "\x1b[36m";
    const reset = "\x1b[0m";
    console.log(`${color}${formatLogEntry(entry)}${reset}`);
  }

  // Then watch for new entries
  return new Promise((resolve) => {
    const rl = createInterface({
      input: createReadStream(logPath),
      crlfDelay: Infinity,
    });

    let lastSize = 0;

    // Check for new content periodically
    const interval = setInterval(async () => {
      try {
        const fileStat = await stat(logPath);
        if (fileStat.size > lastSize) {
          // New content available, re-read from where we left off
          lastSize = fileStat.size;
        }
      } catch {
        // File might have been deleted
      }
    }, 500);

    rl.on("line", (line) => {
      const entry = parseLogLine(line);
      if (!entry) return;

      if (options?.since && entry.timestamp < options.since) return;
      if (options?.stream && entry.stream !== options.stream) return;

      const color = entry.stream === "stderr" ? "\x1b[31m" : "\x1b[36m";
      const reset = "\x1b[0m";
      console.log(`${color}${formatLogEntry(entry)}${reset}`);
    });

    rl.on("close", () => {
      clearInterval(interval);
      resolve();
    });

    // Keep process alive for follow mode
    process.on("SIGINT", () => {
      clearInterval(interval);
      rl.close();
      resolve();
    });
  });
}

/**
 * Get log file path for a project.
 */
export function getLogPath(projectDir: string, projectName: string): string {
  return getLogFilePath(projectDir, projectName);
}

/**
 * List all log files in the logs directory.
 */
export async function listLogFiles(projectDir: string): Promise<string[]> {
  const logsDir = getLogsDir(projectDir);
  if (!existsSync(logsDir)) {
    return [];
  }
  const files = await readdir(logsDir);
  return files.filter(f => f.endsWith(".log"));
}
