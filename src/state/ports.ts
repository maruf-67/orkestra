import { createServer } from "node:net";
import { isPortAllocated, getProject } from "./store.js";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.unref();
    server.on("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => {
      server.close(() => resolve(true));
    });
  });
}

export async function findAvailablePort(preferred?: number, forProjectPath?: string): Promise<number> {
  const start = preferred || 8000;
  const max = 9999;

  // Check if current project already owns the preferred port
  if (forProjectPath && preferred) {
    const currentProject = await getProject(forProjectPath);
    if (currentProject && currentProject.port === preferred) {
      return preferred;
    }
  }

  for (let port = start; port <= max; port++) {
    if (await isPortAllocated(port)) {
      // If port is allocated to the SAME project being registered/updated, it's safe to reuse
      if (forProjectPath) {
        const currentProject = await getProject(forProjectPath);
        if (currentProject && currentProject.port === port) {
          return port;
        }
      }
      continue;
    }
    if (await isPortAvailable(port)) return port;
  }

  throw new Error(`No available port found in range ${start}-${max}`);
}
