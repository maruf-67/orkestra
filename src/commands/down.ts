import { resolve } from "node:path";
import { log, spinner, heading } from "../utils/logger.js";
import { getProject, setProjectStopped, isProcessAlive } from "../state/store.js";
import { isWindows } from "../platform/index.js";
import { run } from "../utils/exec.js";
import { cleanupLaravelProcesses } from "../utils/laravel.js";

interface DownOptions {
  dir?: string;
  project?: string;
  all?: boolean;
}

/**
 * Get all descendant PIDs of a process recursively.
 */
async function getDescendants(pid: number): Promise<number[]> {
  try {
    const { execSync } = await import("node:child_process");
    const result = execSync(`ps -o pid --no-headers --ppid ${pid}`, { encoding: "utf-8" });
    const children = result
      .split("\n")
      .map((line) => parseInt(line.trim(), 10))
      .filter((p) => !isNaN(p));

    const descendants: number[] = [];
    for (const child of children) {
      descendants.push(child);
      const grandchildren = await getDescendants(child);
      descendants.push(...grandchildren);
    }
    return descendants;
  } catch {
    return [];
  }
}

/**
 * Kill a process and all its descendants.
 */
async function killProcessTree(pid: number): Promise<void> {
  if (isWindows()) {
    await run("taskkill", ["/F", "/T", "/PID", String(pid)]);
    return;
  }

  const allPids = [pid, ...await getDescendants(pid)];

  for (const p of allPids) {
    try {
      process.kill(p, "SIGTERM");
    } catch {
      // Process may have already exited
    }
  }

  await new Promise((resolve) => setTimeout(resolve, 1000));

  for (const p of allPids) {
    if (await isProcessAlive(p)) {
      try {
        process.kill(p, "SIGKILL");
      } catch {
        // Ignore
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
        await cleanupLaravelProcesses(project.path, project.port);
        await setProjectStopped(project.path);
        log.success(`Stopped ${project.name} (PID: ${project.pid})`);
        stopped++;
      } else {
        await cleanupLaravelProcesses(project.path, project.port);
        await setProjectStopped(project.path);
      }
    }

    log.success(`Stopped ${stopped} server(s).`);
    return;
  }

  // Resolve project directory by name or path
  let projectDir: string;
  if (options.project) {
    const { listProjects } = await import("../state/store.js");
    const allProjects = await listProjects();
    const match = allProjects.find(p =>
      p.name.toLowerCase() === options.project!.toLowerCase() ||
      p.path.toLowerCase().includes(options.project!.toLowerCase())
    );
    if (!match) {
      log.error(`Project not found: ${options.project}`);
      log.dim("Use 'orkestra list' to see all registered projects");
      process.exit(1);
    }
    projectDir = match.path;
  } else {
    projectDir = resolve(options.dir || process.cwd());
  }

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
    await cleanupLaravelProcesses(projectDir, project.port);
    await setProjectStopped(projectDir);
    spin.succeed(`Stopped ${project.name}`);
  } catch (error) {
    spin.fail(`Failed to stop server: ${error}`);
  }

  // Fallback: kill anything still listening on the project's port
  if (project.port) {
    try {
      const { execSync } = await import("node:child_process");
      const result = execSync(`lsof -ti :${project.port}`, { encoding: "utf-8" });
      const pids = result.split("\n").map((p) => parseInt(p.trim(), 10)).filter((p) => !isNaN(p));
      if (pids.length > 0) {
        log.dim(`Force-killing ${pids.length} process(es) still on port ${project.port}`);
        for (const p of pids) {
          try { process.kill(p, "SIGKILL"); } catch {}
        }
      }
    } catch {
      // lsof not available or no processes found
    }
  }
}
