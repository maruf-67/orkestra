import { resolve } from "node:path";
import { log, spinner, heading } from "../utils/logger.js";
import { getProject, setProjectStopped, isProcessAlive } from "../state/store.js";

interface DownOptions {
  dir?: string;
  all?: boolean;
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
        process.kill(project.pid, "SIGTERM");
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
    log.error("Project not registered. Run `orkestra register` first.");
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
    process.kill(project.pid, "SIGTERM");
    await setProjectStopped(projectDir);
    spin.succeed(`Stopped ${project.name}`);
  } catch (error) {
    spin.fail(`Failed to stop server: ${error}`);
  }
}
