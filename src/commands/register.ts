import { resolve, basename } from "node:path";
import { readFile } from "node:fs/promises";
import { log, spinner, heading } from "../utils/logger.js";
import { detectFramework } from "../detection/framework.js";
import { detectProxy } from "../detection/proxy.js";
import { HostsFileProvider } from "../providers/hosts/hosts.js";
import { registerProject, getProject } from "../state/store.js";
import { findAvailablePort } from "../state/ports.js";
import { loadConfig } from "../config/loader.js";
import { addAllowedHost } from "../utils/host-config.js";
import prompts from "prompts";

interface RegisterOptions {
  dir?: string;
  domain?: string;
  port?: number;
  proxy?: string;
}

async function detectPortFromProject(dir: string, frameworkName: string): Promise<number | null> {
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

export async function register(options: RegisterOptions) {
  const projectDir = resolve(options.dir || process.cwd());

  heading("Register Project");

  // Load project config if exists
  const config = await loadConfig(projectDir);

  // Detect framework
  const spin = spinner("Detecting framework...");
  spin.start();
  const framework = await detectFramework(projectDir);
  if (framework) {
    spin.succeed(`Framework: ${framework.name} ${framework.version}`);
  } else {
    spin.fail("No framework detected");
  }

  const projectName = config?.name || basename(projectDir);

  // Auto-generate domain
  let domain = options.domain || config?.domain || `${projectName}.dev.com`;

  // Prompt only if no domain provided via flag or config
  if (!options.domain && !config?.domain) {
    const response = await prompts({
      type: "text",
      name: "domain",
      message: "Domain name:",
      initial: domain,
    });
    if (response.domain) domain = response.domain;
  }

  // Check if already registered
  const existing = await getProject(projectDir);
  if (existing) {
    log.warn(`Project already registered as ${existing.domain}`);
    const response = await prompts({
      type: "confirm",
      name: "reRegister",
      message: "Re-register with new settings?",
      initial: false,
    });
    if (!response.reRegister) {
      log.info("Aborted.");
      return;
    }
  }

  // Auto-detect port from project files
  let port = options.port || config?.port;
  if (!port) {
    const detectedPort = await detectPortFromProject(projectDir, framework?.name || "");
    port = detectedPort || framework?.port || 8000;
  }

  // Ensure port is available
  port = await findAvailablePort(port);

  // Detect proxy
  const proxySpin = spinner("Detecting proxy...");
  proxySpin.start();
  const proxy = await detectProxy(options.proxy || config?.proxy);
  if (!proxy) {
    proxySpin.fail("No proxy detected");
    log.warn("Project available at:");
    log.plain(`  http://localhost:${port}`);
    log.info("Install Caddy for local HTTPS: https://caddyserver.com/download");

    await registerProject({
      name: projectName,
      domain,
      port,
      framework: framework?.name || "unknown",
      proxy: "none",
      path: projectDir,
      registeredAt: new Date().toISOString(),
    });
    log.success("Project registered (without proxy)");
    return;
  }

  proxySpin.succeed(`Proxy: ${proxy.name}`);

  // Update hosts file (needs sudo password)
  const hostsSpin = spinner("Updating hosts file...");
  hostsSpin.start();
  const hosts = new HostsFileProvider();
  await hosts.add(domain);
  hostsSpin.succeed(`Added ${domain} to hosts file`);

  // Update proxy config
  const configSpin = spinner("Configuring proxy...");
  configSpin.start();
  await proxy.register({ domain, port, ssl: config?.ssl ?? true });
  configSpin.succeed("Proxy configured");

  // Allow domain in Vite/Nuxt dev server
  const hostSpin = spinner("Configuring dev server...");
  hostSpin.start();
  const hostAdded = await addAllowedHost(projectDir, domain);
  if (hostAdded) {
    hostSpin.succeed(`Added ${domain} to allowed hosts`);
  } else {
    hostSpin.succeed("Dev server config unchanged");
  }

  // Save state
  await registerProject({
    name: projectName,
    domain,
    port,
    framework: framework?.name || "unknown",
    proxy: proxy.name,
    path: projectDir,
    registeredAt: new Date().toISOString(),
  });

  log.success("Project registered successfully!");
  heading("Summary");
  log.plain(`  Domain:    https://${domain}`);
  log.plain(`  Port:      ${port}`);
  log.plain(`  Language:  ${framework?.language || "unknown"}`);
  log.plain(`  Framework: ${framework?.name || "unknown"}`);
  log.plain(`  Proxy:     ${proxy.name}`);
}
