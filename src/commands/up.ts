import { resolve, basename } from "node:path";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { log, spinner, heading } from "../utils/logger.js";
import { detectFramework } from "../detection/framework.js";
import { getProject, setProjectRunning, isProcessAlive, registerProject } from "../state/store.js";
import { loadConfig } from "../config/loader.js";
import { findAvailablePort } from "../state/ports.js";
import { detectProxy } from "../detection/proxy.js";
import { HostsFileProvider } from "../providers/hosts/hosts.js";
import prompts from "prompts";

interface UpOptions {
  dir?: string;
  port?: number;
}

async function getStartCommand(dir: string, frameworkName: string): Promise<{ cmd: string; args: string[] } | null> {
  // Try package.json scripts
  if (["node.js", "next.js", "nuxt", "express", "fastify", "vite", "remix", "astro", "sveltekit"].includes(frameworkName)) {
    try {
      const pkg = JSON.parse(await readFile(resolve(dir, "package.json"), "utf-8"));
      const scripts = pkg.scripts || {};

      if (scripts.dev) {
        // Parse the dev script to extract command and args
        const parts = scripts.dev.split(/\s+/);
        return { cmd: parts[0], args: parts.slice(1) };
      }
      if (scripts.start) {
        const parts = scripts.start.split(/\s+/);
        return { cmd: parts[0], args: parts.slice(1) };
      }
    } catch {}
  }

  // Try composer.json scripts (Laravel)
  if (frameworkName === "laravel") {
    try {
      const composer = JSON.parse(await readFile(resolve(dir, "composer.json"), "utf-8"));
      const serveScript = composer.scripts?.serve;
      if (serveScript) {
        const parts = serveScript.split(/\s+/);
        return { cmd: parts[0], args: parts.slice(1) };
      }
    } catch {}
  }

  // Go
  if (frameworkName === "go") {
    return { cmd: "go", args: ["run", "."] };
  }

  // Rust
  if (frameworkName === "rust") {
    return { cmd: "cargo", args: ["run"] };
  }

  // Python
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
  const projectDir = resolve(options.dir || process.cwd());

  heading("Start Dev Server");

  // Check if already running
  const existing = await getProject(projectDir);
  if (existing?.pid && await isProcessAlive(existing.pid)) {
    log.warn(`Server already running (PID: ${existing.pid})`);
    log.info(`URL: https://${existing.domain}`);
    return;
  }

  // Auto-register if not registered
  const config = await loadConfig(projectDir);
  const projectName = config?.name || basename(projectDir);
  let domain = existing?.domain || config?.domain || `${projectName}.dev.com`;
  let port = options.port || existing?.port;

  if (!existing) {
    const regSpin = spinner("Auto-registering project...");
    regSpin.start();

    const framework = await detectFramework(projectDir);
    if (!port) {
      port = framework?.port || 3000;
      port = await findAvailablePort(port);
    }

    // Update hosts
    const hosts = new HostsFileProvider();
    await hosts.add(domain);

    // Update proxy
    const proxy = await detectProxy(config?.proxy);
    if (proxy) {
      await proxy.register({ domain, port, ssl: config?.ssl ?? true });
    }

    await registerProject({
      name: projectName,
      domain,
      port,
      framework: framework?.name || "unknown",
      proxy: proxy?.name || "none",
      path: projectDir,
      registeredAt: new Date().toISOString(),
    });

    regSpin.succeed(`Registered as ${domain}`);
  }

  // Detect framework
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

  // Get start command
  const command = await getStartCommand(projectDir, framework.name);
  if (!command) {
    log.error(`Don't know how to start a ${framework.name} project.`);
    log.info("Add a 'dev' script to your package.json or specify the command manually.");
    process.exit(1);
  }

  // Ensure port is set
  if (!port) {
    port = framework.port;
  }
  port = await findAvailablePort(port);

  // Determine package manager for npx/pnpm exec
  let execCmd = command.cmd;
  let execArgs = [...command.args];

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

  const child = spawn(execCmd, execArgs, {
    cwd: projectDir,
    stdio: "pipe",
    detached: true,
    env: {
      ...process.env,
      PORT: String(port),
    },
  });

  // Detach so we can manage it independently
  child.unref();

  // Save state
  await setProjectRunning(projectDir, child.pid!);

  serverSpin.succeed(`Server started (PID: ${child.pid})`);

  heading("Summary");
  log.plain(`  PID:      ${child.pid}`);
  log.plain(`  URL:      https://${domain}`);
  log.plain(`  Local:    http://localhost:${port}`);
  log.plain(`  Framework: ${framework.name}`);
  log.plain(`  Port:     ${port}`);
  log.plain("");
  log.dim("Stop with: orkestra down");
  log.dim("View logs: orkestra logs");
}
