import { resolve } from "node:path";
import { log, spinner, heading } from "../utils/logger.js";
import { getProject, setProjectStopped, isProcessAlive } from "../state/store.js";
import { down } from "./down.js";
import { up } from "./up.js";

interface RestartOptions {
  dir?: string;
}

export async function restart(options: RestartOptions) {
  heading("Restart Dev Server");

  const projectDir = resolve(options.dir || process.cwd());
  const project = await getProject(projectDir);

  if (!project) {
    log.error("Project not registered. Run `orkestra register` first.");
    process.exit(1);
  }

  // Stop if running
  if (project.pid && await isProcessAlive(project.pid)) {
    const stopSpin = spinner(`Stopping ${project.name}...`);
    stopSpin.start();
    process.kill(project.pid, "SIGTERM");
    await setProjectStopped(projectDir);
    stopSpin.succeed(`Stopped ${project.name}`);

    // Wait a moment for port to be freed
    await new Promise((r) => setTimeout(r, 1000));
  }

  // Start again
  await up({ dir: projectDir });
}
