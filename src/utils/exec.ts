import { execa } from "execa";
import { spawnSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isWindows } from "../platform/index.js";

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export async function run(
  command: string,
  args: string[] = [],
  options: { cwd?: string; env?: Record<string, string>; sudo?: boolean; stdin?: string | "inherit" | "pipe" } = {}
): Promise<ExecResult> {
  const execaOpts: any = {
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
    reject: false,
    stdout: "pipe",
    stderr: "pipe",
  };

  if (typeof options.stdin === "string") {
    execaOpts.input = options.stdin;
  } else {
    execaOpts.stdin = options.stdin ?? "inherit";
  }

  // Windows: no sudo, run directly.
  //
  // `shell: true` is required here and only here: Node cannot exec a `.cmd`
  // shim directly, and npm/bun/gem on Windows are `.cmd` shims.
  if (isWindows()) {
    try {
      const result = await execa(command, args, {
        ...execaOpts,
        shell: true,
      });
      return {
        stdout: String(result.stdout ?? ""),
        stderr: String(result.stderr ?? ""),
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

  // Unix: use sudo if needed.
  //
  // No shell. Execa passes `args` as an argv array straight to execve, so
  // arguments are passed literally. Previously `shell: platform.shell` was set,
  // which had two consequences:
  //
  //  - Correctness: any argument containing a shell metacharacter broke. Real
  //    example: `git log -1 --format=%an|||%s` failed with
  //    `/bin/sh: Syntax error: "|" unexpected`, so `getCurrentGitInfo()` silently
  //    recorded author "unknown" and an empty message for every deployment.
  //  - Security: arguments are built from project-controlled values (domains,
  //    project names, paths, service names), so a shell would interpret them.
  //
  // Every call site passes a real binary plus an argv array, so nothing depended
  // on shell expansion. The one place that genuinely wants a shell,
  // `run("sh", ["-c", ...])` in utils/installer.ts, still works: `sh -c` is how
  // you ask a shell to run a script.
  const cmd = options.sudo ? "sudo" : command;
  const cmdArgs = options.sudo ? [command, ...args] : args;

  try {
    const result = await execa(cmd, cmdArgs, execaOpts);
    return {
      stdout: String(result.stdout ?? ""),
      stderr: String(result.stderr ?? ""),
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
    // No shell on Unix: `command` is a literal tool name, and execing `which`
    // directly avoids handing it to a shell parser for no benefit.
    const result = await execa("which", [command], {
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
