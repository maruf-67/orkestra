import { resolve } from "node:path";
import { log, spinner, heading } from "../utils/logger.js";
import { getProject, setProjectStopped, isProcessAlive } from "../state/store.js";
import { isWindows } from "../platform/index.js";
import { run } from "../utils/exec.js";

interface DownOptions {
  dir?: string;
  all?: boolean;
}

/**
 * Kill a process and all its children (process tree).
 */
async function killProcessTree(pid: number): Promise<void> {
  if (isWindows()) {
    // Windows: Use taskkill to kill process tree
    // /T = kill process tree, /F = force
    await run("taskkill", ["/F", "/T", "/PID", String(pid)]);
  } else {
    // Unix: Send SIGTERM to process group
    // First try to kill the process group
    try {
      process.kill(-pid, "SIGTERM");
    } catch {
      // If process group kill fails, kill individual process
      process.kill(pid, "SIGTERM");
    }

    // Wait a bit for graceful shutdown
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // If still alive, force kill
    if (await isProcessAlive(pid)) {
      try {
        process.kill(-pid, "SIGKILL");
      } catch {
        process.kill(pid, "SIGKILL");
      }
    }
  }
}

export async function down(options: DownOptions) {
  heading("Stop Dev Server");

  if (options.all) {
    // Stop all running servers
    const { listProjects } = await import("../state/store.js");
    const projects = await listProjects();
    const running = projects.filter((p) => p.pid);

    if (running.length === 0) {
      log.info("No running servers.");
      return;
    }

    let stopped = 0;
    for (const project of running) {
      if (project.pid && await isProcessAlive(project.pid)) {
        await killProcessTree(project.pid);
        await setProjectStopped(project.path);
        log.success(`Stopped ${project.name} (PID: ${project.pid})`);
        stopped++;
      } else {
        await setProjectStopped(project.path);
      }
    }

    log.success(`Stopped ${stopped} server(s).`);
    return;
  }

  const projectDir = resolve(options.dir || process.cwd());

  const project = await getProject(projectDir);
  if (!project) {
    log.error("Project not registered. Run `orkestra init` first.");
    process.exit(1);
  }

  if (!project.pid) {
    log.info(`No server running for ${project.name}.`);
    return;
  }

  if (!await isProcessAlive(project.pid)) {
    log.info(`Server already stopped (stale PID: ${project.pid}).`);
    await setProjectStopped(projectDir);
    return;
  }

  const spin = spinner(`Stopping ${project.name} (PID: ${project.pid})...`);
  spin.start();

  try {
    await killProcessTree(project.pid);
    await setProjectStopped(projectDir);
    spin.succeed(`Stopped ${project.name}`);
  } catch (error) {
    spin.fail(`Failed to stop server: ${error}`);
  }
}
