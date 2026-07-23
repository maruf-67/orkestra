import { resolve } from "node:path";
import { writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { log, spinner, heading } from "../utils/logger.js";
import { detectFramework } from "../detection/framework.js";
import { detectPackageManager } from "../detection/package-manager.js";
import { findAvailablePort } from "../state/ports.js";
import { basename } from "node:path";
import prompts from "prompts";

interface InitOptions {
  dir?: string;
}

export async function init(options: InitOptions) {
  const projectDir = resolve(options.dir || process.cwd());

  heading("Initialize Project");

  // Detect framework
  const fwSpin = spinner("Detecting framework...");
  fwSpin.start();
  const framework = await detectFramework(projectDir);
  if (framework) {
    fwSpin.succeed(`Framework: ${framework.name} ${framework.version}`);
  } else {
    fwSpin.fail("No framework detected");
  }

  // Detect package manager
  const pmSpin = spinner("Detecting package manager...");
  pmSpin.start();
  const pm = await detectPackageManager();
  if (pm) {
    pmSpin.succeed(`Package manager: ${pm.name}`);
  } else {
    pmSpin.fail("No package manager detected");
  }

  // Generate defaults
  const projectName = basename(projectDir);
  const defaultDomain = `${projectName}.test`;
  const defaultPort = framework?.port || 8000;

  // Interactive prompts
  const response = await prompts([
    {
      type: "text",
      name: "name",
      message: "Project name:",
      initial: projectName,
    },
    {
      type: "text",
      name: "domain",
      message: "Domain name:",
      initial: defaultDomain,
    },
    {
      type: "number",
      name: "port",
      message: "Dev server port:",
      initial: defaultPort,
    },
    {
      type: "confirm",
      name: "ssl",
      message: "Enable SSL?",
      initial: true,
    },
  ]);

  // Generate config
  const config = {
    name: response.name,
    framework: framework?.name || "unknown",
    proxy: "auto",
    runtime: "auto",
    port: response.port,
    domain: response.domain,
    ssl: response.ssl,
  };

  // Write config file
  const configPath = resolve(projectDir, ".orkestra.yml");
  if (existsSync(configPath)) {
    const overwrite = await prompts({
      type: "confirm",
      name: "value",
      message: ".orkestra.yml already exists. Overwrite?",
      initial: false,
    });
    if (!overwrite.value) {
      log.info("Aborted.");
      return;
    }
  }

  const yaml = generateYaml(config);
  await writeFile(configPath, yaml, "utf-8");

  log.success(".orkestra.yml created!");
  log.info("Run `orkestra register` to register with your proxy.");
}

function generateYaml(config: {
  name: string;
  framework: string;
  proxy: string;
  runtime: string;
  port: number;
  domain: string;
  ssl: boolean;
}): string {
  return `name: ${config.name}
framework: ${config.framework}
proxy: ${config.proxy}
runtime: ${config.runtime}
port: ${config.port}
domain: ${config.domain}
ssl: ${config.ssl}
`;
}
