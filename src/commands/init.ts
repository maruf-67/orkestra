import { resolve, basename, join } from "node:path";
import { writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { log, spinner, heading } from "../utils/logger.js";
import { detectFramework } from "../detection/framework.js";
import { detectPackageManager } from "../detection/package-manager.js";
import { registerProjectAuto, detectPortFromProject } from "../utils/registration.js";
import { getProject } from "../state/store.js";
import {
  isPortInUse,
  registerReverbDomain,
  updateLaravelEnvForReverb,
  parseExistingReverbConfig,
  generateReverbCredentials,
  injectReverbYaml,
} from "../utils/reverb.js";
import { syncLaravelProject } from "../utils/laravel.js";
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
    log.dim('Example: startCommand: "pnpm dev"');
  }

  // Detect package manager
  const pmSpin = spinner("Detecting package manager...");
  pmSpin.start();
  const pm = await detectPackageManager(projectDir);
  if (pm) {
    pmSpin.succeed(`Package manager: ${pm.name}`);
  } else {
    pmSpin.fail("No package manager detected");
    log.dim("Install pnpm, npm, yarn, or bun");
  }

  // Generate defaults
  const projectName = basename(projectDir);
  const defaultDomain = `${projectName}.dev.com`;
  const defaultPort =
    (await detectPortFromProject(projectDir, framework?.name || "")) ||
    framework?.port ||
    3000;

  // ─────────────────────────────────────────────
  // Phase 1: Standard project prompts
  // ─────────────────────────────────────────────
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

  // ─────────────────────────────────────────────
  // Phase 2: Laravel Reverb setup (conditional)
  // ─────────────────────────────────────────────
  let reverbEnabled = false;
  let reverbPort = 8080;
  let reverbDomain = `${name}-reverb.dev.com`;

  const isLaravel =
    framework?.name?.toLowerCase() === "laravel" ||
    existsSync(join(projectDir, "artisan"));

  if (isLaravel && !options.yes) {
    const reverbQuestion = await prompts({
      type: "confirm",
      name: "enabled",
      message: "Use Laravel Reverb (real-time WebSocket)?",
      initial: false,
    });

    reverbEnabled = reverbQuestion.enabled === true;

    if (reverbEnabled) {
      // Read existing config to prefill
      const existingReverb = await parseExistingReverbConfig(projectDir);
      const defaultReverbPort = existingReverb.serverPort ?? 8080;
      const defaultReverbDomain =
        existingReverb.domain ?? `${name}-reverb.dev.com`;

      // Ask for port — validate & detect conflicts interactively
      let chosenPort: number | undefined;

      while (chosenPort === undefined) {
        const portAnswer = await prompts({
          type: "number",
          name: "port",
          message: "Reverb WebSocket server port (must be unique per project):",
          initial: defaultReverbPort,
          validate: (v: number) =>
            v >= 1024 && v <= 65535
              ? true
              : "Port must be between 1024 and 65535",
        });

        const candidatePort: number = portAnswer.port ?? defaultReverbPort;

        // Check if port is already in use
        const inUse = await isPortInUse(candidatePort);
        if (inUse) {
          log.warn(
            `  Port ${candidatePort} is already in use by another process.`
          );
          const retry = await prompts({
            type: "confirm",
            name: "change",
            message: "Choose a different port?",
            initial: true,
          });
          if (!retry.change) {
            // User wants to keep the conflicting port (maybe they'll restart)
            chosenPort = candidatePort;
            log.dim(
              `  Using ${candidatePort} anyway — stop the conflicting process before starting.`
            );
          }
          // else loop again
        } else {
          chosenPort = candidatePort;
        }
      }

      reverbPort = chosenPort;

      // Ask for Reverb domain
      const domainAnswer = await prompts({
        type: "text",
        name: "domain",
        message: "Reverb domain (will be added to /etc/hosts + Caddy):",
        initial: defaultReverbDomain,
        validate: (v: string) =>
          /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(v)
            ? true
            : "Must be a valid domain like project-reverb.dev.com",
      });

      reverbDomain = domainAnswer.domain ?? defaultReverbDomain;
    }
  }

  // ─────────────────────────────────────────────
  // Phase 3: Overwrite check & YAML generation
  // ─────────────────────────────────────────────
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

  let yaml = generateYaml({ name, framework: framework?.name || "unknown", proxy: "auto", runtime: "auto", port, domain, ssl });

  if (reverbEnabled) {
    yaml = injectReverbYaml(yaml, reverbPort, reverbDomain);
  }

  await writeFile(configPath, yaml, "utf-8");
  log.success(".orkestra.yml created!");

  // Add .orkestra to .gitignore
  await addToGitignore(projectDir);

  // ─────────────────────────────────────────────
  // Phase 4: Register project (proxy + hosts)
  // ─────────────────────────────────────────────
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

    // ─────────────────────────────────────────────
    // Phase 5: Reverb domain registration
    // ─────────────────────────────────────────────
    if (reverbEnabled) {
      const reverbSpin = spinner("Registering Reverb domain...");
      reverbSpin.start();

      try {
        await registerReverbDomain(reverbDomain, reverbPort, ssl, options.proxy);

        // Update .env
        const { appKey, appSecret, appId } = generateReverbCredentials(name);
        const existingCreds = await parseExistingReverbConfig(projectDir);

        await updateLaravelEnvForReverb(
          projectDir,
          {
            domain: reverbDomain,
            serverPort: reverbPort,
            appKey: existingCreds.appKey ?? appKey,
            appSecret: existingCreds.appSecret ?? appSecret,
            appId: existingCreds.appId ?? appId,
          },
          ssl
        );

        reverbSpin.succeed(
          `Reverb registered: wss://${reverbDomain} -> localhost:${reverbPort}`
        );
      } catch (err) {
        reverbSpin.fail("Reverb domain registration failed");
        log.warn(
          "  You may need to run with sudo privileges for /etc/hosts and Caddy config access."
        );
        throw err;
      }
    }

    // ─────────────────────────────────────────────
    // Phase 6: Laravel project files synchronization
    // ─────────────────────────────────────────────
    if (isLaravel) {
      await syncLaravelProject(projectDir, {
        port,
        domain,
        reverbPort: reverbEnabled ? reverbPort : undefined,
        reverbDomain: reverbEnabled ? reverbDomain : undefined,
      });
    }

    // ─────────────────────────────────────────────
    // Summary
    // ─────────────────────────────────────────────
    heading("Summary");
    log.plain(`  Domain:    https://${result.project.domain}`);
    log.plain(`  Port:      ${result.project.port}`);
    log.plain(`  Language:  ${result.framework?.language || "unknown"}`);
    log.plain(`  Framework: ${result.framework?.name || "unknown"}`);
    log.plain(`  Proxy:     ${result.project.proxy}`);

    if (reverbEnabled) {
      log.plain(``);
      log.plain(`  Reverb:`);
      log.plain(`    Domain:  wss://${reverbDomain}`);
      log.plain(`    Port:    ${reverbPort} (server) -> 443 (public)`);
      log.plain(`    .env:    REVERB_* variables updated`);
    }

    log.plain("");
    log.dim("Start with: orkestra up");
  } catch (error) {
    regSpin.fail("Registration failed");
    throw error;
  }
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

async function addToGitignore(projectDir: string): Promise<void> {
  const gitignorePath = join(projectDir, ".gitignore");
  const entry = ".orkestra";

  try {
    let content = "";
    if (existsSync(gitignorePath)) {
      content = await readFile(gitignorePath, "utf-8");
    }

    if (content.includes(entry)) return;

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
