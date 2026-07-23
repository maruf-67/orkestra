import { execa } from "execa";
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

export async function which(command: string): Promise<string | null> {
  const platform = getPlatform();
  const result = await execa("which", [command], {
    shell: platform.shell,
    reject: false,
  });
  if (result.exitCode === 0) {
    return result.stdout.trim();
  }
  // Fallback for Windows
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
