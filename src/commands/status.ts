import { log, heading, table } from "../utils/logger.js";
import { listProjects, isProcessAlive } from "../state/store.js";

export async function status() {
  heading("Project Status");

  const projects = await listProjects();

  if (projects.length === 0) {
    log.info("No projects registered.");
    log.dim("Run `orkestra register` in a project directory to get started.");
    return;
  }

  for (const project of projects) {
    const isRunning = project.pid ? await isProcessAlive(project.pid) : false;
    const statusIcon = isRunning ? "●" : "○";
    const statusText = isRunning ? "running" : "stopped";

    log.plain("");
    log.plain(`  ${statusIcon} ${project.name}`);
    table([
      ["Status", statusText],
      ["Domain", project.domain],
      ["Port", String(project.port)],
      ["Framework", project.framework],
      ["Proxy", project.proxy],
      ["URL", isRunning ? `https://${project.domain}` : "-"],
      ["PID", project.pid ? String(project.pid) : "-"],
      ["Started", project.startedAt || "-"],
    ]);
  }

  const running = projects.filter(async (p) => p.pid && await isProcessAlive(p.pid));
  log.plain("");
  log.dim(`${projects.length} project(s) registered`);
}
