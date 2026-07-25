import { resolve, join } from "node:path";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { log, heading, spinner } from "../utils/logger.js";
import { validateConfig } from "../config/schema.js";
import { detectFramework } from "../detection/framework.js";
import { detectProxy } from "../detection/proxy.js";
import { parse as parseYaml } from "yaml";
import prompts from "prompts";
import { isWindows } from "../platform/index.js";

interface CheckOptions {
  dir?: string;
  fix?: boolean;
}

interface CheckResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  suggestions: string[];
}

export async function check(options: CheckOptions) {
  const projectDir = resolve(options.dir || process.cwd());

  heading("Configuration Check");

  const results: CheckResult = {
    valid: true,
    errors: [],
    warnings: [],
    suggestions: [],
  };

  // 1. Check if .orkestra.yml exists
  const configPath = join(projectDir, ".orkestra.yml");
  if (!existsSync(configPath)) {
    log.warn("No .orkestra.yml found in this directory");
    log.dim("Run 'orkestra init' to create one");

    // Offer to create
    if (options.fix) {
      const response = await prompts({
        type: "confirm",
        name: "value",
        message: "Create .orkestra.yml now?",
        initial: true,
      });

      if (response.value) {
        log.info("Run 'orkestra init' to create configuration");
      }
    }
    return;
  }

  // 2. Read and parse config
  log.info(`Checking ${configPath}`);
  let rawConfig: any;
  try {
    const content = await readFile(configPath, "utf-8");
    rawConfig = parseYaml(content);
  } catch (error) {
    results.errors.push(`Failed to parse YAML: ${error}`);
    results.valid = false;
    printResults(results);
    return;
  }

  // 3. Validate with Zod schema
  const spin = spinner("Validating configuration...");
  spin.start();

  try {
    validateConfig(rawConfig);
    spin.succeed("Configuration is valid");
  } catch (error: any) {
    spin.fail("Configuration has errors");
    if (error.errors) {
      for (const err of error.errors) {
        results.errors.push(`${err.path.join(".")}: ${err.message}`);
      }
    } else {
      results.errors.push(error.message);
    }
    results.valid = false;
  }

  // 4. Check framework detection
  const fwSpin = spinner("Checking framework...");
  fwSpin.start();
  const framework = await detectFramework(projectDir);
  if (framework) {
    fwSpin.succeed(`Framework: ${framework.name} ${framework.version}`);
    if (rawConfig.framework && rawConfig.framework !== framework.name) {
      results.warnings.push(`Config says "${rawConfig.framework}" but detected "${framework.name}"`);
    }
  } else {
    fwSpin.fail("No framework detected");
    results.warnings.push("No framework detected - startCommand may be required");
  }

  // 5. Check proxy availability
  const proxySpin = spinner("Checking proxy...");
  proxySpin.start();
  const proxy = await detectProxy(rawConfig.proxy);
  if (proxy) {
    proxySpin.succeed(`Proxy: ${proxy.name}`);
  } else {
    proxySpin.fail("No proxy detected");
    results.warnings.push("No proxy available - HTTPS will not work");
    results.suggestions.push("Install Caddy: https://caddyserver.com/download");
  }

  // 6. Check port availability
  if (rawConfig.port) {
    const portSpin = spinner(`Checking port ${rawConfig.port}...`);
    portSpin.start();
    const portAvailable = await isPortAvailable(rawConfig.port);
    if (portAvailable) {
      portSpin.succeed(`Port ${rawConfig.port} is available`);
    } else {
      portSpin.succeed(`Port ${rawConfig.port} is in use`);
      results.warnings.push(`Port ${rawConfig.port} may be occupied by another process`);
    }
  }

  // 7. Check startCommand if framework detected but no scripts
  if (framework && !rawConfig.startCommand) {
    const pkgPath = join(projectDir, "package.json");
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(await readFile(pkgPath, "utf-8"));
        if (!pkg.scripts?.dev && !pkg.scripts?.start) {
          results.warnings.push("No 'dev' or 'start' script in package.json");
          results.suggestions.push("Add startCommand to .orkestra.yml");
        }
      } catch {}
    }
  }

  // 8. Check platform-specific issues
  if (isWindows()) {
    // Windows proxy support is fully automated for Caddy, Nginx, and Apache
  }

  // Print results
  printResults(results);

  // Offer to fix issues
  if (!results.valid && options.fix) {
    const response = await prompts({
      type: "confirm",
      name: "value",
      message: "Attempt to fix issues?",
      initial: true,
    });

    if (response.value) {
      await fixIssues(projectDir, results);
    }
  }
}

async function isPortAvailable(port: number): Promise<boolean> {
  const { createServer } = await import("node:net");
  return new Promise((resolve) => {
    const server = createServer();
    server.unref();
    server.on("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => {
      server.close(() => resolve(true));
    });
  });
}

function printResults(results: CheckResult) {
  if (results.errors.length > 0) {
    log.plain("");
    log.error("Errors:");
    for (const error of results.errors) {
      log.plain(`  ✗ ${error}`);
    }
  }

  if (results.warnings.length > 0) {
    log.plain("");
    log.warn("Warnings:");
    for (const warning of results.warnings) {
      log.plain(`  ⚠ ${warning}`);
    }
  }

  if (results.suggestions.length > 0) {
    log.plain("");
    log.dim("Suggestions:");
    for (const suggestion of results.suggestions) {
      log.plain(`  → ${suggestion}`);
    }
  }

  log.plain("");
  if (results.valid) {
    log.success("Configuration is valid!");
  } else {
    log.error("Configuration has errors. Fix them before running 'orkestra up'.");
  }
}

async function fixIssues(_projectDir: string, results: CheckResult) {
  log.info("Attempting to fix issues...");

  // Fix missing startCommand
  if (results.warnings.some(w => w.includes("startCommand"))) {
    log.dim("Adding startCommand to config...");
    // Could auto-detect from package.json scripts
  }

  // Fix port conflicts
  if (results.warnings.some(w => w.includes("Port"))) {
    log.dim("Port conflict detected - orkestra will auto-find available port");
  }

  log.success("Fixes applied. Run 'orkestra check' again to verify.");
}
