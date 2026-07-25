import { resolve, basename } from "node:path";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { log, spinner, heading } from "../utils/logger.js";
import { detectFramework } from "../detection/framework.js";
import { getProject, setProjectRunning, isProcessAlive } from "../state/store.js";
import { loadConfig } from "../config/loader.js";
import { findAvailablePort } from "../state/ports.js";
import { registerProjectAuto } from "../utils/registration.js";
import { writeLog, getLogPath } from "../utils/logger-file.js";
import { healthMonitor } from "../utils/health.js";
import type { OrkestraConfig } from "../config/schema.js";

interface UpOptions {
  dir?: string;
  port?: number;
  foreground?: boolean;
  all?: boolean;
}

/**
 * Check if a port is occupied by another process.
 */
async function isPortOccupied(port: number): Promise<boolean> {
  const { createServer } = await import("node:net");
  return new Promise((resolve) => {
    const server = createServer();
    server.unref();
    server.on("error", () => resolve(true));
    server.listen(port, "127.0.0.1", () => {
      server.close(() => resolve(false));
    });
  });
}

async function getStartCommand(
  dir: string,
  frameworkName: string,
  config?: OrkestraConfig | null
): Promise<{ cmd: string; args: string[] } | null> {
  // 1. Check config.startCommand first
  if (config?.startCommand) {
    const parts = config.startCommand.split(/\s+/);
    return { cmd: parts[0], args: parts.slice(1) };
  }

  // 2. Try package.json scripts
  if (["node.js", "next.js", "nuxt", "express", "fastify", "vite", "remix", "astro", "sveltekit"].includes(frameworkName)) {
    try {
      const pkg = JSON.parse(await readFile(resolve(dir, "package.json"), "utf-8"));
      const scripts = pkg.scripts || {};

      if (scripts.dev) {
        const parts = scripts.dev.split(/\s+/);
        return { cmd: parts[0], args: parts.slice(1) };
      }
      if (scripts.start) {
        const parts = scripts.start.split(/\s+/);
        return { cmd: parts[0], args: parts.slice(1) };
      }
    } catch {}
  }

  // 3. Try composer.json scripts (Laravel)
  if (frameworkName === "laravel") {
    try {
      const composer = JSON.parse(await readFile(resolve(dir, "composer.json"), "utf-8"));
      const scripts = composer.scripts || {};

      // Laravel dev script (preferred - runs server + queue + logs + vite)
      if (scripts.dev) {
        // Laravel dev script is often an array or uses concurrently
        // Use composer dev to run it properly
        return { cmd: "composer", args: ["dev"] };
      }

      // Laravel serve script
      if (scripts.serve) {
        // Parse the serve command to extract port if specified
        const serveScript = Array.isArray(scripts.serve) ? scripts.serve.join(" ") : scripts.serve;
        const portMatch = serveScript.match(/--port[= ](\d+)/);
        if (portMatch) {
          return { cmd: "php", args: ["artisan", "serve", `--port=${portMatch[1]}`] };
        }
        return { cmd: "php", args: ["artisan", "serve"] };
      }
    } catch {}
  }

  // 4. Go
  if (frameworkName === "go") {
    return { cmd: "go", args: ["run", "."] };
  }

  // 5. Rust
  if (frameworkName === "rust") {
    return { cmd: "cargo", args: ["run"] };
  }

  // 6. Python
  if (["fastapi", "flask", "django"].includes(frameworkName)) {
    if (frameworkName === "fastapi") {
      return { cmd: "uvicorn", args: ["main:app", "--reload"] };
    }
    if (frameworkName === "flask") {
      return { cmd: "flask", args: ["run"] };
    }
    if (frameworkName === "django") {
      return { cmd: "python", args: ["manage.py", "runserver"] };
    }
  }

  return null;
}

export async function up(options: UpOptions) {
  heading("Start Dev Server");

  // Handle --all flag
  if (options.all) {
    const { listProjects } = await import("../state/store.js");
    const projects = await listProjects();

    if (projects.length === 0) {
      log.info("No projects registered.");
      log.dim("Run `orkestra register` in a project directory to get started.");
      return;
    }

    let started = 0;
    for (const project of projects) {
      if (project.pid && await isProcessAlive(project.pid)) {
        log.plain(`  ⊙ ${project.name} — already running (PID: ${project.pid})`);
        continue;
      }

      try {
        await up({ dir: project.path, foreground: false });
        started++;
      } catch (error) {
        log.error(`Failed to start ${project.name}: ${error}`);
      }
    }

    log.success(`Started ${started} server(s).`);
    return;
  }

  const projectDir = resolve(options.dir || process.cwd());

  // Check if already running
  const existing = await getProject(projectDir);
  if (existing?.pid && await isProcessAlive(existing.pid)) {
    log.warn(`Server already running (PID: ${existing.pid})`);
    log.info(`URL: https://${existing.domain}`);
    return;
  }

  // Load config
  const config = await loadConfig(projectDir);

  // Port priority: CLI flag > config > existing state > auto-detect
  let port = options.port || config?.port || existing?.port;

  // Auto-register if not registered
  let domain = existing?.domain;

  if (!existing) {
    const regSpin = spinner("Auto-registering project...");
    regSpin.start();

    try {
      const result = await registerProjectAuto(projectDir, {
        port,
      });
      domain = result.project.domain;
      port = result.project.port;
      regSpin.succeed(`Registered as ${domain}`);
    } catch (error) {
      regSpin.fail("Auto-registration failed");
      throw error;
    }
  }

  // Detect framework (once)
  const spin = spinner("Detecting framework...");
  spin.start();
  const framework = await detectFramework(projectDir);
  if (framework) {
    spin.succeed(`Framework: ${framework.name} ${framework.version}`);
  } else {
    spin.fail("No framework detected");
    log.error("Cannot start server without framework detection.");
    process.exit(1);
  }

  // Get start command (supports config.startCommand override)
  const command = await getStartCommand(projectDir, framework.name, config);
  if (!command) {
    log.error(`Don't know how to start a ${framework.name} project.`);
    log.info("Add a 'dev' script to your package.json, or set 'startCommand' in .orkestra.yml.");
    process.exit(1);
  }

  // Ensure port is set (priority: CLI > config > existing > framework default)
  if (!port) {
    port = config?.port || framework.port;
  }

  // Only find available port if the configured port is actually in use by ANOTHER process
  // (not by our own stale PID)
  const originalPort = port;
  const isPortInUse = await isPortOccupied(port);
  if (isPortInUse) {
    log.warn(`Port ${port} is in use by another process`);
    port = await findAvailablePort(port);
    log.info(`Using alternative port: ${port}`);

    // Update proxy configuration with new port
    if (domain) {
      const { detectProxy } = await import("../detection/proxy.js");
      const proxy = await detectProxy(config?.proxy);
      if (proxy) {
        log.dim(`Updating proxy configuration for port ${port}...`);
        await proxy.unregister(domain);
        await proxy.register({ domain, port, ssl: config?.ssl ?? true });
      }
    }
  }

  // Determine package manager for npx/pnpm exec
  let execCmd = command.cmd;
  let execArgs = [...command.args];

  // For Laravel, inject port option if not already specified
  if (framework.name === "laravel" && execCmd === "php" && execArgs.includes("artisan")) {
    // Check if port is already in args
    const hasPort = execArgs.some(arg => arg.includes("--port"));
    if (!hasPort && port) {
      execArgs.push(`--port=${port}`);
    }
  }

  // If command is a bin that might need npx/pnpm exec (like "next", "nuxt", "vite")
  const needsExec = ["next", "nuxt", "vite", "remix", "astro", "svelte"].some(b => execCmd.startsWith(b));
  if (needsExec) {
    // Detect package manager
    try {
      const { existsSync } = await import("node:fs");
      if (existsSync(resolve(projectDir, "pnpm-lock.yaml"))) {
        execArgs = [execCmd, ...execArgs];
        execCmd = "pnpm";
        execArgs.unshift("exec");
      } else if (existsSync(resolve(projectDir, "yarn.lock"))) {
        execArgs = ["--", execCmd, ...execArgs];
        execCmd = "yarn";
      } else if (existsSync(resolve(projectDir, "bun.lockb"))) {
        execArgs = [execCmd, ...execArgs];
        execCmd = "bun";
      } else {
        execArgs = ["--yes", execCmd, ...execArgs];
        execCmd = "npx";
      }
    } catch {
      execArgs = ["--yes", execCmd, ...execArgs];
      execCmd = "npx";
    }
  }

  // Start the server
  const serverSpin = spinner(`Starting ${framework.name} server...`);
  serverSpin.start();

  const projectName = config?.name || basename(projectDir);
  const logPath = getLogPath(projectDir, projectName);

  // Check if command exists before spawning
  const { isCommandAvailable } = await import("../utils/exec.js");
  if (!await isCommandAvailable(execCmd)) {
    serverSpin.fail(`Command not found: ${execCmd}`);
    log.error(`Cannot start server: ${execCmd} is not installed.`);
    log.dim(`Install ${execCmd} or set a different startCommand in .orkestra.yml`);
    process.exit(1);
  }

  // Get mise environment if available
  const env = {
    ...process.env,
    PORT: String(port),
  };

  // Check if mise is available and use its environment
  if (await isCommandAvailable("mise")) {
    try {
      const { execSync } = await import("node:child_process");
      // Use mise env -j for JSON output
      const miseEnv = execSync("mise env -j", { encoding: "utf-8", stdio: "pipe" });
      const miseVars = JSON.parse(miseEnv);
      for (const [key, value] of Object.entries(miseVars)) {
        if (typeof value === "string") {
          env[key] = value;
        }
      }
    } catch {
      // Fallback: try without -j flag and parse export format
      try {
        const { execSync } = await import("node:child_process");
        const miseEnv = execSync("mise env", { encoding: "utf-8", stdio: "pipe" });
        const lines = miseEnv.split("\n").filter(line => line.startsWith("export ") || line.includes("="));
        for (const line of lines) {
          // Remove 'export ' prefix if present
          const cleaned = line.replace(/^export\s+/, "");
          const eqIndex = cleaned.indexOf("=");
          if (eqIndex > 0) {
            const key = cleaned.substring(0, eqIndex).trim();
            const value = cleaned.substring(eqIndex + 1).trim().replace(/^['"]|['"]$/g, "");
            env[key] = value;
          }
        }
      } catch {}
    }
  }

  const child = spawn(execCmd, execArgs, {
    cwd: projectDir,
    stdio: options.foreground ? "inherit" : "pipe",
    detached: !options.foreground,
    env,
  });

  // Capture logs to file (unless foreground mode)
  if (!options.foreground && child.stdout && child.stderr) {
    child.stdout.on("data", (data: Buffer) => {
      const lines = data.toString().split("\n").filter(Boolean);
      for (const line of lines) {
        writeLog(projectDir, projectName, {
          timestamp: new Date(),
          stream: "stdout",
          message: line,
        });
      }
    });

    child.stderr.on("data", (data: Buffer) => {
      const lines = data.toString().split("\n").filter(Boolean);
      for (const line of lines) {
        writeLog(projectDir, projectName, {
          timestamp: new Date(),
          stream: "stderr",
          message: line,
        });
      }
    });

    // Handle process exit
    child.on("exit", (code) => {
      writeLog(projectDir, projectName, {
        timestamp: new Date(),
        stream: "stdout",
        message: `[Process exited with code ${code}]`,
      });
    });
  }

  // Detach so we can manage it independently (unless foreground)
  if (!options.foreground) {
    child.unref();
  }

  // Update state with actual port if it changed
  if (port !== originalPort && existing) {
    const { updateProjectPort } = await import("../state/store.js");
    await updateProjectPort(projectDir, port);
  }

  // Save state
  await setProjectRunning(projectDir, child.pid!);

  // Start health monitoring (unless foreground mode)
  if (!options.foreground) {
    healthMonitor.startMonitoring(projectDir);
  }

  serverSpin.succeed(`Server started (PID: ${child.pid})`);

  heading("Summary");
  log.plain(`  PID:      ${child.pid}`);
  log.plain(`  URL:      https://${domain}`);
  log.plain(`  Local:    http://localhost:${port}`);
  log.plain(`  Framework: ${framework.name}`);
  log.plain(`  Port:     ${port}`);
  log.plain(`  Logs:     ${logPath}`);
  log.plain("");
  log.dim("Stop with: orkestra down");
  log.dim("View logs: orkestra logs");

  // If foreground mode, wait for process to exit
  if (options.foreground) {
    child.on("exit", (code) => {
      process.exit(code ?? 0);
    });
  }
}
