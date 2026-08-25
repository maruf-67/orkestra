import { run, type ExecResult } from "../utils/exec.js";
import type { RemoteConfig } from "../config/schema.js";

export class RemoteExecutor {
  async execute(
    remote: RemoteConfig,
    command: string,
    options?: { cwd?: string; env?: Record<string, string> }
  ): Promise<ExecResult> {
    const target = remote.user ? `${remote.user}@${remote.host}` : remote.host;
    const sshArgs: string[] = [];

    if (remote.port) {
      sshArgs.push("-p", String(remote.port));
    }
    if (remote.sshKey) {
      sshArgs.push("-i", remote.sshKey);
    }

    sshArgs.push(target);

    let remoteCommand = command;
    if (options?.cwd) {
      remoteCommand = `cd ${options.cwd} && ${remoteCommand}`;
    }

    if (options?.env) {
      const envPrefix = Object.entries(options.env)
        .map(([k, v]) => `${k}="${v}"`)
        .join(" ");
      remoteCommand = `${envPrefix} ${remoteCommand}`;
    }

    sshArgs.push(remoteCommand);

    return run("ssh", sshArgs);
  }

  async testConnection(remote: RemoteConfig): Promise<boolean> {
    try {
      const res = await this.execute(remote, "echo 'orkestra-ok'");
      return res.exitCode === 0 && res.stdout.includes("orkestra-ok");
    } catch {
      return false;
    }
  }
}

export const remoteExecutor = new RemoteExecutor();
