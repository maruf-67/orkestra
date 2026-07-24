import type { ProcessProvider } from "../types.js";
import { run, isCommandAvailable } from "../../utils/exec.js";

export class Pm2Process implements ProcessProvider {
  readonly name = "pm2";

  async detect(): Promise<boolean> {
    return isCommandAvailable("pm2");
  }

  async start(name: string, command: string, args: string[], env?: Record<string, string>): Promise<number> {
    const envArgs = env ? Object.entries(env).map(([k, v]) => `${k}=${v}`) : [];
    const result = await run("pm2", ["start", command, "--name", name, "--", ...args]);
    // Get the PID from pm2
    const listResult = await run("pm2", ["jlist"]);
    if (listResult.exitCode === 0) {
      try {
        const apps = JSON.parse(listResult.stdout);
        const app = apps.find((a: { name: string }) => a.name === name);
        if (app) return app.pid;
      } catch {}
    }
    return 0;
  }

  async stop(name: string): Promise<void> {
    await run("pm2", ["stop", name]);
  }

  async delete(name: string): Promise<void> {
    await run("pm2", ["delete", name]);
  }

  async restart(name: string): Promise<void> {
    await run("pm2", ["restart", name]);
  }

  async list(): Promise<Array<{ name: string; pid: number; status: string; port?: number }>> {
    const result = await run("pm2", ["jlist"]);
    if (result.exitCode !== 0) return [];

    try {
      const apps = JSON.parse(result.stdout);
      return apps.map((app: { name: string; pid: number; pm2_env: { status: string } }) => ({
        name: app.name,
        pid: app.pid,
        status: app.pm2_env.status,
      }));
    } catch {
      return [];
    }
  }

  async logs(name: string, lines: number): Promise<string> {
    const result = await run("pm2", ["logs", name, "--lines", String(lines), "--nostream"]);
    return result.stdout;
  }
}
