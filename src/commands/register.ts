import { resolve, basename } from "node:path";
import { log, spinner, heading } from "../utils/logger.js";
import { detectFramework } from "../detection/framework.js";
import { getProject } from "../state/store.js";
import { loadConfig } from "../config/loader.js";
import { registerProjectAuto, detectPortFromProject } from "../utils/registration.js";
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

  // Use shared registration utility
  const regSpin = spinner("Registering project...");
  regSpin.start();

  try {
    const result = await registerProjectAuto(projectDir, {
      domain,
      port,
      proxy: options.proxy,
    });

    regSpin.succeed("Project registered successfully!");

    heading("Summary");
    log.plain(`  Domain:    https://${result.project.domain}`);
    log.plain(`  Port:      ${result.project.port}`);
    log.plain(`  Language:  ${result.framework?.language || "unknown"}`);
    log.plain(`  Framework: ${result.framework?.name || "unknown"}`);
    log.plain(`  Proxy:     ${result.project.proxy}`);
  } catch (error) {
    regSpin.fail("Registration failed");
    throw error;
  }
}
