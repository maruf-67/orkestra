import { execa } from "execa";
import { spawnSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getPlatform, isWindows } from "../platform/index.js";

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

  // Windows: no sudo, run directly
  if (isWindows()) {
    try {
      const result = await execa(command, args, {
        cwd: options.cwd,
        env: { ...process.env, ...options.env },
        shell: true,
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

  // Unix: use sudo if needed
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
 * Write a file with elevated privileges.
 * - Unix: Uses sudo cp
 * - Windows: Uses PowerShell Start-Process with RunAs
 */
export async function sudoWriteFile(filePath: string, content: string): Promise<void> {
  // 1. Write to a temp file
  const tmpDir = await mkdtemp(join(tmpdir(), "orkestra-"));
  const tmpFile = join(tmpDir, "tmpfile");
  await writeFile(tmpFile, content, "utf-8");

  if (isWindows()) {
    // Windows: Use PowerShell to copy with elevation
    const psCommand = `Start-Process -FilePath "cmd" -ArgumentList '/c copy "${tmpFile}" "${filePath}"' -Verb RunAs -Wait`;
    const result = spawnSync("powershell.exe", ["-Command", psCommand], {
      stdio: "inherit",
    });

    if (result.status !== 0) {
      throw new Error(`Failed to write ${filePath}. Do you have Administrator access?`);
    }
  } else {
    // Unix: Use sudo cp
    const result = spawnSync("sudo", ["cp", tmpFile, filePath], {
      stdio: "inherit",
    });

    if (result.status !== 0) {
      throw new Error(`Failed to write ${filePath}. Do you have sudo access?`);
    }
  }
}

/**
 * Check if a command is available.
 * Uses 'which' on Unix, 'where.exe' on Windows.
 */
export async function which(command: string): Promise<string | null> {
  if (isWindows()) {
    const result = await execa("where.exe", [command], {
      shell: true,
      reject: false,
    });
    if (result.exitCode === 0) {
      return result.stdout.trim().split("\n")[0];
    }
  } else {
    const result = await execa("which", [command], {
      shell: true,
      reject: false,
    });
    if (result.exitCode === 0) {
      return result.stdout.trim();
    }
  }
  return null;
}

export async function isCommandAvailable(command: string): Promise<boolean> {
  return (await which(command)) !== null;
}
