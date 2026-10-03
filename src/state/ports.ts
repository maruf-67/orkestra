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

/**
 * Whether a port is currently held by a listening socket.
 *
 * Probes 127.0.0.1 because that is the conservative direction: a process bound
 * to 0.0.0.0 also holds the loopback address, so a free loopback probe will not
 * miss an existing listener.
 *
 * This was previously duplicated privately in `commands/up.ts` and
 * `commands/start.ts`; it lives here so the health monitor can use the same
 * check instead of re-deriving it.
 */
export async function isPortOccupied(port: number): Promise<boolean> {
  return !(await isPortAvailable(port));
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
