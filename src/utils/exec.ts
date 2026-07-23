import { execa } from "execa";
import { spawnSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getPlatform } from "../platform/index.js";

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export async function run(
  command: string,
  args: string[] = [],
  options: { cwd?: string; env?: Record<string, string>; sudo?: boolean } = {}
): Promise<ExecResult> {
  const platform = getPlatform();
  const cmd = options.sudo ? "sudo" : command;
  const cmdArgs = options.sudo ? [command, ...args] : args;

  try {
    const result = await execa(cmd, cmdArgs, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      shell: platform.shell,
      reject: false,
      stdin: "inherit",
      stdout: "pipe",
      stderr: "pipe",
    });
    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode ?? 1,
    };
  } catch (error) {
    return {
      stdout: "",
      stderr: error instanceof Error ? error.message : String(error),
      exitCode: 1,
    };
  }
}

/**
 * Write a file with sudo. Uses Node's native spawnSync so the terminal
 * is properly inherited — sudo can prompt for the password directly.
 */
export async function sudoWriteFile(filePath: string, content: string): Promise<void> {
  // 1. Write to a temp file (no sudo needed)
  const tmpDir = await mkdtemp(join(tmpdir(), "orkestra-"));
  const tmpFile = join(tmpDir, "tmpfile");
  await writeFile(tmpFile, content, "utf-8");

  // 2. Use native spawnSync with stdio: "inherit" — this properly passes
  //    the terminal to sudo so it can prompt for the password
  const result = spawnSync("sudo", ["cp", tmpFile, filePath], {
    stdio: "inherit",
  });

  if (result.status !== 0) {
    throw new Error(`Failed to write ${filePath}. Do you have sudo access?`);
  }
}

export async function which(command: string): Promise<string | null> {
  const platform = getPlatform();
  const result = await execa("which", [command], {
    shell: platform.shell,
    reject: false,
  });
  if (result.exitCode === 0) {
    return result.stdout.trim();
  }
  if (platform.shell.includes("powershell")) {
    const winResult = await execa("where.exe", [command], {
      shell: platform.shell,
      reject: false,
    });
    if (winResult.exitCode === 0) {
      return winResult.stdout.trim().split("\n")[0];
    }
  }
  return null;
}

export async function isCommandAvailable(command: string): Promise<boolean> {
  return (await which(command)) !== null;
}
