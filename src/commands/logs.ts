import { resolve } from "node:path";
import { log, heading } from "../utils/logger.js";
import { getProject, isProcessAlive } from "../state/store.js";
import { spawn } from "node:child_process";

interface LogsOptions {
  dir?: string;
  follow?: boolean;
}

export async function logs(options: LogsOptions) {
  heading("Server Logs");

  const projectDir = resolve(options.dir || process.cwd());
  const project = await getProject(projectDir);

  if (!project) {
    log.error("Project not registered. Run `orkestra register` first.");
    process.exit(1);
  }

  if (!project.pid || !await isProcessAlive(project.pid)) {
    log.error(`No running server for ${project.name}. Start with: orkestra up`);
    process.exit(1);
  }

  log.info(`Tailing logs for ${project.name} (PID: ${project.pid})...`);
  log.dim("Press Ctrl+C to stop tailing\n");

  // We can't actually tail the stdout of a detached process after the fact,
  // so we'll show a helpful message
  log.warn("Note: Logs from detached servers are not captured.");
  log.info("To see logs, start the server in the foreground:");
  log.plain(`  cd ${projectDir}`);
  log.plain(`  npm run dev`);
  log.plain("");
  log.dim("Or use `orkestra up --foreground` (coming soon)");
}
