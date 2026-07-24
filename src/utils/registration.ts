import { resolve, basename } from "node:path";
import { readFile } from "node:fs/promises";
import { detectFramework } from "../detection/framework.js";
import { detectProxy } from "../detection/proxy.js";
import { HostsFileProvider } from "../providers/hosts/hosts.js";
import { registerProject, getProject, ProjectState } from "../state/store.js";
import { findAvailablePort } from "../state/ports.js";
import { loadConfig } from "../config/loader.js";
import { OrkestraConfig } from "../config/schema.js";
import { addAllowedHost } from "./host-config.js";
import type { FrameworkInfo } from "../providers/types.js";

export interface RegistrationOptions {
  domain?: string;
  port?: number;
  proxy?: string;
  skipPrompts?: boolean;
}

export interface RegistrationResult {
  project: ProjectState;
  framework: FrameworkInfo | null;
  config: OrkestraConfig | null;
}

/**
 * Detect port from project files (package.json scripts, .env, composer.json).
 */
export async function detectPortFromProject(dir: string, frameworkName: string): Promise<number | null> {
  // Try package.json scripts
  if (["node.js", "next.js", "nuxt", "express", "fastify", "vite", "remix", "astro", "sveltekit"].includes(frameworkName)) {
    try {
      const pkg = JSON.parse(await readFile(resolve(dir, "package.json"), "utf-8"));
      const devScript = pkg.scripts?.dev || pkg.scripts?.start || "";
      const portMatch = devScript.match(/(?:--port|-p)\s+(\d+)/);
      if (portMatch) return parseInt(portMatch[1]);
      const portEnvMatch = devScript.match(/PORT=(\d+)/);
      if (portEnvMatch) return parseInt(portEnvMatch[1]);
    } catch {}
  }

  // Try composer.json (Laravel)
  if (frameworkName === "laravel") {
    try {
      const composer = JSON.parse(await readFile(resolve(dir, "composer.json"), "utf-8"));
      const serveScript = composer.scripts?.serve || "";
      const portMatch = serveScript.match(/--port[= ](\d+)/);
      if (portMatch) return parseInt(portMatch[1]);
    } catch {}
  }

  // Try .env
  try {
    const env = await readFile(resolve(dir, ".env"), "utf-8");
    const portMatch = env.match(/^PORT=(\d+)/m);
    if (portMatch) return parseInt(portMatch[1]);
  } catch {}

  return null;
}

/**
 * Auto-register a project. Used by both `register` and `up` commands.
 *
 * Flow:
 * 1. Load .orkestra.yml config
 * 2. Detect framework
 * 3. Resolve domain (CLI flag > config > auto-generate `${name}.dev.com`)
 * 4. Resolve port (CLI flag > config > project files > framework default > 3000)
 * 5. Add domain to /etc/hosts
 * 6. Detect and configure proxy
 * 7. Call addAllowedHost() for Vite/Nuxt
 * 8. Save to state store
 */
export async function registerProjectAuto(
  dir: string,
  options?: RegistrationOptions
): Promise<RegistrationResult> {
  const projectDir = resolve(dir);

  // Load config
  const config = await loadConfig(projectDir);

  // Detect framework
  const framework = await detectFramework(projectDir);

  // Resolve project name
  const projectName = config?.name || basename(projectDir);

  // Resolve domain
  const domain = options?.domain || config?.domain || `${projectName}.dev.com`;

  // Resolve port
  let port = options?.port || config?.port;
  if (!port) {
    const detectedPort = await detectPortFromProject(projectDir, framework?.name || "");
    port = detectedPort || framework?.port || 3000;
  }
  port = await findAvailablePort(port);

  // Add to hosts file
  const hosts = new HostsFileProvider();
  await hosts.add(domain);

  // Detect and configure proxy
  const proxy = await detectProxy(options?.proxy || config?.proxy);
  if (proxy) {
    await proxy.register({ domain, port, ssl: config?.ssl ?? true });
  }

  // Add allowed host for Vite/Nuxt
  await addAllowedHost(projectDir, domain);

  // Save to state store
  const project: ProjectState = {
    name: projectName,
    domain,
    port,
    framework: framework?.name || "unknown",
    proxy: proxy?.name || "none",
    path: projectDir,
    registeredAt: new Date().toISOString(),
  };
  await registerProject(project);

  return { project, framework, config };
}
