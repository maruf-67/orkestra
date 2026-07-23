import { createServer } from "node:net";
import { isPortAllocated } from "./store.js";

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

export async function findAvailablePort(preferred?: number): Promise<number> {
  const start = preferred || 8000;
  const max = 9999;

  for (let port = start; port <= max; port++) {
    if (await isPortAllocated(port)) continue;
    if (await isPortAvailable(port)) return port;
  }

  throw new Error(`No available port found in range ${start}-${max}`);
}
