import { resolve, basename, join } from "node:path";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { detectFramework } from "../detection/framework.js";
import { detectProxy } from "../detection/proxy.js";
import { HostsFileProvider } from "../providers/hosts/hosts.js";
import { registerProject, ProjectState } from "../state/store.js";
import { findAvailablePort } from "../state/ports.js";
import { loadConfig } from "../config/loader.js";
import { OrkestraConfig } from "../config/schema.js";
import { addAllowedHost } from "./host-config.js";
import { syncLaravelProject } from "./laravel.js";
import { log } from "../utils/logger.js";
import { installCaddy, setAutoInstall } from "./installer.js";
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
      // Match --port=3007, --port 3007, -p 3007, -p3007
      const portMatch = devScript.match(/(?:--port=?|-p)\s*(\d+)/);
      if (portMatch) return parseInt(portMatch[1]);
      const portEnvMatch = devScript.match(/PORT=(\d+)/);
      if (portEnvMatch) return parseInt(portEnvMatch[1]);
    } catch {}
  }

  // Try composer.json (Laravel)
  if (frameworkName === "laravel") {
    try {
      const composer = JSON.parse(await readFile(resolve(dir, "composer.json"), "utf-8"));
      const scripts = composer.scripts || {};
      const allScriptStrings: string[] = [];

      for (const val of Object.values(scripts)) {
        if (Array.isArray(val)) {
          allScriptStrings.push(...val.filter((x): x is string => typeof x === "string"));
        } else if (typeof val === "string") {
          allScriptStrings.push(val);
        }
      }

      for (const s of allScriptStrings) {
        const octaneMatch = s.match(/octane:start[^\s"']*(\s+--host=\S+)?\s+--port=(\d+)/);
        if (octaneMatch) return parseInt(octaneMatch[2]);
        const portMatch = s.match(/--port[= ](\d+)/);
        if (portMatch && !s.includes("reverb:start")) return parseInt(portMatch[1]);
      }
    } catch {}

    // Try .rr.yaml (RoadRunner)
    try {
      const rr = await readFile(resolve(dir, ".rr.yaml"), "utf-8");
      const rrMatch = rr.match(/address:\s*["']?[^"'\n:]+:(\d+)["']?/);
      if (rrMatch) return parseInt(rrMatch[1]);
    } catch {}
  }

  // Try .env
  try {
    const env = await readFile(resolve(dir, ".env"), "utf-8");
    const portMatch =
      env.match(/^PORT=(\d+)/m) ||
      env.match(/^APP_PORT=(\d+)/m) ||
      env.match(/^SERVER_PORT=(\d+)/m) ||
      env.match(/^OCTANE_PORT=(\d+)/m);
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

  // Set auto-install mode if skipPrompts is true
  if (options?.skipPrompts) {
    setAutoInstall(true);
  }

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
  port = await findAvailablePort(port, projectDir);

  // Add to hosts file
  const hosts = new HostsFileProvider();
  await hosts.add(domain);

  // Detect and configure proxy
  const proxyPref = options?.proxy || (typeof config?.proxy === "object" ? config.proxy.provider : config?.proxy);
  let proxy = await detectProxy(proxyPref);

  if (proxy) {
    await proxy.register({ domain, port, ssl: config?.ssl ?? true });
  } else {
    // No proxy found - offer to install Caddy
    log.warn("No proxy detected (Caddy, Nginx, Apache, or Traefik)");

    const installResult = await installCaddy();
    if (installResult.installed) {
      // Re-detect proxy after installation
      proxy = await detectProxy("caddy");
      if (proxy) {
        await proxy.register({ domain, port, ssl: config?.ssl ?? true });
      }
    } else if (!installResult.skipped) {
      log.error("Failed to install Caddy");
      log.dim("Install manually: https://caddyserver.com/download");
    } else {
      log.dim("Continuing without proxy. HTTP only.");
    }

    if (config?.ssl && !proxy) {
      log.warn("SSL requires a proxy. HTTP only for now.");
    }
  }

  // Add allowed host for Vite/Nuxt
  await addAllowedHost(projectDir, domain);

  // Sync Laravel project files (composer.json, .rr.yaml, .env, pnpm-workspace.yaml)
  const isLaravel =
    framework?.name?.toLowerCase() === "laravel" ||
    existsSync(join(projectDir, "artisan"));

  if (isLaravel) {
    await syncLaravelProject(projectDir, {
      port,
      domain,
      reverbPort: (config as any)?.reverbPort,
      reverbDomain: (config as any)?.reverbDomain,
    });
  }

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
