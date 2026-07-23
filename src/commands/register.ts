import { resolve, basename } from "node:path";
import { log, spinner, heading } from "../utils/logger.js";
import { detectFramework } from "../detection/framework.js";
import { detectProxy } from "../detection/proxy.js";
import { HostsFileProvider } from "../providers/hosts/hosts.js";
import { registerProject, getProject } from "../state/store.js";
import { findAvailablePort } from "../state/ports.js";
import { loadConfig } from "../config/loader.js";
import prompts from "prompts";

interface RegisterOptions {
  dir?: string;
  domain?: string;
  port?: number;
  proxy?: string;
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
    log.warn("Continuing without framework detection...");
  }

  // Determine domain
  let domain = options.domain || config?.domain;
  if (!domain) {
    const defaultDomain = `${basename(projectDir)}.test`;
    const response = await prompts({
      type: "text",
      name: "domain",
      message: "Domain name:",
      initial: defaultDomain,
    });
    domain = response.domain;
  }

  if (!domain) {
    log.error("Domain is required");
    process.exit(1);
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

  // Determine port
  let port = options.port || config?.port;
  if (!port) {
    port = framework?.port || 8000;
    port = await findAvailablePort(port);
    log.info(`Using port: ${port}`);
  }

  // Detect proxy
  const proxySpin = spinner("Detecting proxy...");
  proxySpin.start();
  const proxy = await detectProxy(options.proxy || config?.proxy);
  if (!proxy) {
    proxySpin.fail("No proxy detected");
    log.warn("Skipping domain setup. Project will be available at:");
    log.plain(`  http://localhost:${port}`);
    log.info("Install Caddy for local HTTPS domains: https://caddyserver.com/download");

    // Still register in state
    await registerProject({
      name: basename(projectDir),
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

  // Update hosts file
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

  // Save state
  await registerProject({
    name: basename(projectDir),
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
