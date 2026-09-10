import { resolve } from "node:path";
import { log, spinner, heading } from "../utils/logger.js";
import { getProject, setProjectStopped, isProcessAlive, listProjects } from "../state/store.js";
import { isWindows, isLinux } from "../platform/index.js";
import { run } from "../utils/exec.js";
import { cleanupLaravelProcesses } from "../utils/laravel.js";
import { systemd } from "../services/systemd.js";
import type { ServiceType } from "../services/systemd.js";

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

async function stopDeployedServices(projectName: string): Promise<number> {
  if (!isLinux()) return 0;
  const types: ServiceType[] = ["octane", "web", "queue", "reverb"];
  let stopped = 0;
  for (const t of types) {
    const svc = systemd.getServiceName(projectName, t);
    try {
      if (await systemd.isActive(svc)) {
        await systemd.stop(svc);
        log.success(`Stopped systemd ${svc}`);
        stopped++;
      } else {
        // Try stopping anyway — unit may exist but inactive (idempotent)
        const st = await systemd.getStatus(svc);
        if (st !== "unknown") {
          await systemd.stop(svc);
        }
      }
    } catch {}
  }
  return stopped;
}

export async function down(options: DownOptions) {
  heading("Stop Server");

  if (options.all) {
    const projects = await listProjects();
    if (projects.length === 0) {
      log.info("No projects registered.");
      return;
    }

    let stoppedDev = 0;
    let stoppedDeployed = 0;
    for (const project of projects) {
      // Dev (pid) servers
      if (project.pid && await isProcessAlive(project.pid)) {
        await killProcessTree(project.pid);
        await cleanupLaravelProcesses(project.path, project.port);
        await setProjectStopped(project.path);
        log.success(`Stopped dev ${project.name} (PID: ${project.pid})`);
        stoppedDev++;
      } else if (project.pid) {
        await cleanupLaravelProcesses(project.path, project.port);
        await setProjectStopped(project.path);
      }
      // Deployed (systemd) services — always attempt
      stoppedDeployed += await stopDeployedServices(project.name);
    }

    if (stoppedDev === 0 && stoppedDeployed === 0) log.info("No running servers (dev or deployed).");
    else log.success(`Stopped ${stoppedDev} dev + ${stoppedDeployed} systemd service(s). Use 'orkestra up' for dev or 'orkestra deploy/redeploy' to restart deployed.`);
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

  let didStop = false;

  // 1. Dev server (pid) if running
  if (project.pid) {
    if (await isProcessAlive(project.pid)) {
      const spin = spinner(`Stopping dev ${project.name} (PID: ${project.pid})...`);
      spin.start();
      try {
        await killProcessTree(project.pid);
        await cleanupLaravelProcesses(projectDir, project.port);
        await setProjectStopped(projectDir);
        spin.succeed(`Stopped dev ${project.name}`);
        didStop = true;
      } catch (error) {
        spin.fail(`Failed to stop dev server: ${error}`);
      }
    } else {
      log.info(`Dev server already stopped (stale PID: ${project.pid}).`);
      await setProjectStopped(projectDir);
    }
  }

  // 2. Deployed systemd services (octane/web/queue/reverb) — this is what 'pause' means for production
  const sysStopped = await stopDeployedServices(project.name);
  if (sysStopped > 0) didStop = true;

  if (!didStop && !project.pid) {
    log.info(`No dev server running for ${project.name}. Checked systemd — ${sysStopped > 0 ? `stopped ${sysStopped} service(s)` : "no active deployed services"}.`);
    if (sysStopped === 0) log.dim("Deployed services are already stopped. Restart with: orkestra redeploy -y or orkestra deploy -y");
    return;
  }
  if (sysStopped > 0) log.success(`Paused ${sysStopped} deployed service(s) for ${project.name}. Resume with: orkestra redeploy -y`);
  else if (didStop) log.success(`Stopped ${project.name}`);

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
