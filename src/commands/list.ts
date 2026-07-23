import { log, heading, table } from "../utils/logger.js";
import { listProjects } from "../state/store.js";

export async function list() {
  heading("Registered Projects");

  const projects = await listProjects();

  if (projects.length === 0) {
    log.info("No projects registered.");
    log.dim("Run `orkestra register` in a project directory to get started.");
    return;
  }

  for (const project of projects) {
    log.plain("");
    log.plain(`  ${project.name}`);
    table([
      ["Domain", project.domain],
      ["Port", String(project.port)],
      ["Framework", project.framework],
      ["Proxy", project.proxy],
      ["Path", project.path],
      ["Registered", project.registeredAt],
    ]);
  }

  log.plain("");
  log.dim(`Total: ${projects.length} project(s)`);
}
