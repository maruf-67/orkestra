import { resolve, basename, join } from "node:path";
import { writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { log, spinner, heading } from "../utils/logger.js";
import { detectFramework } from "../detection/framework.js";
import { detectPackageManager } from "../detection/package-manager.js";
import { registerProjectAuto, detectPortFromProject } from "../utils/registration.js";
import { getProject } from "../state/store.js";
import prompts from "prompts";

interface InitOptions {
  dir?: string;
  domain?: string;
  port?: number;
  proxy?: string;
  yes?: boolean;
}

export async function init(options: InitOptions) {
  const projectDir = resolve(options.dir || process.cwd());

  heading("Initialize Project");

  // Check if already registered
  const existing = await getProject(projectDir);

  // Detect framework
  const fwSpin = spinner("Detecting framework...");
  fwSpin.start();
  const framework = await detectFramework(projectDir);
  if (framework) {
    fwSpin.succeed(`Framework: ${framework.name} ${framework.version}`);
  } else {
    fwSpin.fail("No framework detected");
    log.warn("No framework detected. You'll need to set startCommand in .orkestra.yml");
    log.dim("Example: startCommand: \"pnpm dev\"");
  }

  // Detect package manager
  const pmSpin = spinner("Detecting package manager...");
  pmSpin.start();
  const pm = await detectPackageManager();
  if (pm) {
    pmSpin.succeed(`Package manager: ${pm.name}`);
  } else {
    pmSpin.fail("No package manager detected");
    log.dim("Install pnpm, npm, yarn, or bun");
  }

  // Generate defaults
  const projectName = basename(projectDir);
  const defaultDomain = `${projectName}.dev.com`;
  const defaultPort = await detectPortFromProject(projectDir, framework?.name || "") || framework?.port || 3000;

  // Interactive prompts (skip if --yes or options provided)
  let name = projectName;
  let domain = options.domain || defaultDomain;
  let port = options.port || defaultPort;
  let ssl = true;

  if (!options.yes && (!options.domain || !options.port)) {
    const response = await prompts([
      {
        type: options.domain ? null : "text",
        name: "name",
        message: "Project name:",
        initial: projectName,
      },
      {
        type: options.domain ? null : "text",
        name: "domain",
        message: "Domain name:",
        initial: defaultDomain,
      },
      {
        type: options.port ? null : "number",
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

    if (response.name) name = response.name;
    if (response.domain) domain = response.domain;
    if (response.port) port = response.port;
    if (response.ssl !== undefined) ssl = response.ssl;
  }

  // Create .orkestra.yml
  const configPath = join(projectDir, ".orkestra.yml");
  const configExists = existsSync(configPath);

  if (configExists && !existing && !options.yes) {
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

  const config = {
    name,
    framework: framework?.name || "unknown",
    proxy: "auto",
    runtime: "auto",
    port,
    domain,
    ssl,
  };

  const yaml = generateYaml(config);
  await writeFile(configPath, yaml, "utf-8");
  log.success(".orkestra.yml created!");

  // Add .orkestra to .gitignore
  await addToGitignore(projectDir);

  // Register with proxy, hosts, etc.
  const regSpin = spinner("Registering project...");
  regSpin.start();

  try {
    const result = await registerProjectAuto(projectDir, {
      domain,
      port,
      proxy: options.proxy,
      skipPrompts: options.yes,
    });

    regSpin.succeed("Project registered successfully!");

    heading("Summary");
    log.plain(`  Domain:    https://${result.project.domain}`);
    log.plain(`  Port:      ${result.project.port}`);
    log.plain(`  Language:  ${result.framework?.language || "unknown"}`);
    log.plain(`  Framework: ${result.framework?.name || "unknown"}`);
    log.plain(`  Proxy:     ${result.project.proxy}`);
    log.plain("");
    log.dim("Start with: orkestra up");
  } catch (error) {
    regSpin.fail("Registration failed");
    throw error;
  }
}

async function addToGitignore(projectDir: string): Promise<void> {
  const gitignorePath = join(projectDir, ".gitignore");
  const entry = ".orkestra";

  try {
    let content = "";
    if (existsSync(gitignorePath)) {
      content = await readFile(gitignorePath, "utf-8");
    }

    // Check if already in gitignore
    if (content.includes(entry)) {
      return;
    }

    // Add entry
    const separator = content.endsWith("\n") ? "" : "\n";
    const newContent = content + separator + "\n# Orkestra\n" + entry + "\n";
    await writeFile(gitignorePath, newContent, "utf-8");
    log.dim("Added .orkestra to .gitignore");
  } catch {}
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
