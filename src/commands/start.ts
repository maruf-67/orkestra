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

interface StartOptions {
  dir?: string;
  project?: string;
  port?: number;
  foreground?: boolean;
  build?: boolean;
}

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

async function getProductionCommand(
  dir: string,
  frameworkName: string,
  config?: OrkestraConfig | null
): Promise<{ cmd: string; args: string[] } | null> {
  if (config?.startCommand) {
    const parts = config.startCommand.split(/\s+/);
    return { cmd: parts[0], args: parts.slice(1) };
  }

  if (frameworkName === "laravel") {
    // Prefer Octane if available, fall back to artisan serve
    try {
      const { execSync } = await import("node:child_process");
      execSync("php artisan octane:list", { cwd: dir, stdio: "pipe" });
      return { cmd: "php", args: ["artisan", "octane:start", "--host=0.0.0.0"] };
    } catch {
      return { cmd: "php", args: ["artisan", "serve", "--host=0.0.0.0"] };
    }
  }

  if (["next.js", "nuxt", "node.js", "vite", "astro", "sveltekit"].includes(frameworkName)) {
    try {
      const pkg = JSON.parse(await readFile(resolve(dir, "package.json"), "utf-8"));
      const scripts = pkg.scripts || {};

      if (scripts.start) {
        const parts = scripts.start.split(/\s+/);
        return { cmd: parts[0], args: parts.slice(1) };
      }
    } catch {}
  }

  return null;
}

export async function start(options: StartOptions) {
  heading("Start Production Server");

  let projectDir: string;
  if (options.project) {
    const { listProjects } = await import("../state/store.js");
    const allProjects = await listProjects();
    const match = allProjects.find(p =>
      p.name.toLowerCase() === options.project!.toLowerCase() ||
      p.path.toLowerCase().includes(options.project!.toLowerCase())
    );
    if (!match) {
      log.error("Project not found: " + options.project);
      log.dim("Use 'orkestra list' to see all registered projects");
      process.exit(1);
    }
    projectDir = match.path;
  } else {
    projectDir = resolve(options.dir || process.cwd());
  }

  const config = await loadConfig(projectDir);
  const existing = await getProject(projectDir);

  if (existing?.pid && await isProcessAlive(existing.pid)) {
    log.warn("Server already running (PID: " + existing.pid + ")");
    log.info("URL: https://" + existing.domain);
    return;
  }

  const framework = await detectFramework(projectDir);
  if (!framework) {
    log.error("Could not detect framework for this project.");
    process.exit(1);
  }

  let port = options.port || config?.port || existing?.port;
  let domain = existing?.domain;

  if (!existing) {
    const regSpin = spinner("Auto-registering project...");
    regSpin.start();
    try {
      const result = await registerProjectAuto(projectDir, { port });
      domain = result.project.domain;
      port = result.project.port;
      regSpin.succeed("Registered as " + domain);
    } catch (error) {
      regSpin.fail("Auto-registration failed");
      throw error;
    }
  }

  const command = await getProductionCommand(projectDir, framework.name, config);
  if (!command) {
    log.error("Don't know how to start " + framework.name + " in production mode.");
    log.dim("Add a 'start' script to your package.json, or set 'startCommand' in .orkestra.yml.");
    process.exit(1);
  }

  if (!port) {
    port = config?.port || framework.port;
  }

  const originalPort = port;
  const isPortInUse = await isPortOccupied(port);
  if (isPortInUse) {
    log.warn("Port " + port + " is in use by another process");
    port = await findAvailablePort(port);
    log.info("Using alternative port: " + port);

    if (domain) {
      const { detectProxy } = await import("../detection/proxy.js");
      const proxyName = typeof config?.proxy === "object" ? config.proxy.provider : config?.proxy;
      const proxy = await detectProxy(proxyName);
      if (proxy) {
        log.dim("Updating proxy configuration for port " + port + "...");
        await proxy.unregister(domain);
        await proxy.register({ domain, port, ssl: config?.ssl ?? true });
      }
    }
  }

  let execCmd = command.cmd;
  let execArgs = [...command.args];

  // Port injection for direct php artisan commands
  if (framework.name === "laravel" && execCmd === "php" && execArgs.includes("artisan")) {
    const hasPort = execArgs.some(arg => arg.includes("--port"));
    if (!hasPort && port) {
      execArgs.push(`--port=${port}`);
    }
  }

  if (options.build) {
    const buildSpin = spinner("Building for production...");
    buildSpin.start();

    let buildCmd: string;
    let buildArgs: string[];

    if (framework.name === "laravel") {
      buildCmd = "php";
      buildArgs = ["artisan", "config:cache"];
    } else {
      const { existsSync } = await import("node:fs");
      if (existsSync(resolve(projectDir, "pnpm-lock.yaml"))) {
        buildCmd = "pnpm";
        buildArgs = ["run", "build"];
      } else if (existsSync(resolve(projectDir, "yarn.lock"))) {
        buildCmd = "yarn";
        buildArgs = ["run", "build"];
      } else if (existsSync(resolve(projectDir, "bun.lockb"))) {
        buildCmd = "bun";
        buildArgs = ["run", "build"];
      } else {
        buildCmd = "npm";
        buildArgs = ["run", "build"];
      }
    }

    const { execSync } = await import("node:child_process");
    try {
      execSync(buildCmd + " " + buildArgs.join(" "), {
        cwd: projectDir,
        stdio: "inherit",
        env: { ...process.env, PORT: String(port), SERVER_PORT: String(port) },
      });
      buildSpin.succeed("Build complete");
    } catch {
      buildSpin.fail("Build failed");
      process.exit(1);
    }
  }

  const needsExec = ["next", "nuxt", "vite", "remix", "astro", "svelte"].some(b => execCmd.startsWith(b));
  if (needsExec) {
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

  const serverSpin = spinner("Starting " + framework.name + " production server...");
  serverSpin.start();

  const projectName = config?.name || basename(projectDir);
  const logPath = getLogPath(projectDir, projectName);

  const { isCommandAvailable } = await import("../utils/exec.js");
  if (!await isCommandAvailable(execCmd)) {
    serverSpin.fail("Command not found: " + execCmd);
    log.error("Cannot start server: " + execCmd + " is not installed.");
    process.exit(1);
  }

  const env: Record<string, string | undefined> = {
    ...process.env,
    PORT: String(port),
    SERVER_PORT: String(port),
    NODE_ENV: "production",
  };

  if (await isCommandAvailable("mise")) {
    try {
      const { execSync } = await import("node:child_process");
      const miseEnv = execSync("mise env -j", { encoding: "utf-8", stdio: "pipe" });
      const miseVars = JSON.parse(miseEnv);
      for (const [key, value] of Object.entries(miseVars)) {
        if (typeof value === "string") {
          env[key] = value;
        }
      }
    } catch {
      try {
        const { execSync } = await import("node:child_process");
        const miseEnv = execSync("mise env", { encoding: "utf-8", stdio: "pipe" });
        const lines = miseEnv.split("\n").filter(line => line.startsWith("export ") || line.includes("="));
        for (const line of lines) {
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

    child.on("exit", (code) => {
      writeLog(projectDir, projectName, {
        timestamp: new Date(),
        stream: "stdout",
        message: `[Process exited with code ${code}]`,
      });
    });
  }

  if (!options.foreground) {
    child.unref();
  }

  if (port !== originalPort && existing) {
    const { updateProjectPort } = await import("../state/store.js");
    await updateProjectPort(projectDir, port);
  }

  await setProjectRunning(projectDir, child.pid!);

  if (!options.foreground) {
    healthMonitor.startMonitoring(projectDir);
  }

  serverSpin.succeed("Server started (PID: " + child.pid + ")");

  heading("Summary");
  log.plain("  PID:      " + child.pid);
  log.plain("  URL:      https://" + domain);
  log.plain("  Local:    http://localhost:" + port);
  log.plain("  Framework: " + framework.name);
  log.plain("  Port:     " + port);
  log.plain("  Logs:     " + logPath);
  log.plain("");
  log.dim("Stop with: orkestra down");

  if (options.foreground) {
    child.on("exit", (code) => {
      process.exit(code ?? 0);
    });
  }
}
