import { resolve } from "node:path";
import { log, spinner, heading } from "../utils/logger.js";
import { getProject } from "../state/store.js";
import { run } from "../utils/exec.js";
import { isWindows } from "../platform/index.js";

interface OpenOptions {
  dir?: string;
}

export async function open(options: OpenOptions) {
  const projectDir = resolve(options.dir || process.cwd());

  heading("Open Project");

  const project = await getProject(projectDir);
  if (!project) {
    log.error("Project not registered. Run `orkestra register` first.");
    process.exit(1);
  }

  const url = `https://${project.domain}`;
  log.info(`Opening ${url}`);

  const platform = isWindows() ? "win32" : process.platform;

  try {
    if (platform === "win32") {
      await run("cmd", ["/c", "start", url]);
    } else if (platform === "darwin") {
      await run("open", [url]);
    } else {
      await run("xdg-open", [url]);
    }
    log.success("Browser opened");
  } catch {
    log.error("Failed to open browser. Open manually:");
    log.plain(`  ${url}`);
  }
}
