import { log, heading, table } from "../utils/logger.js";
import { listProjects, isProcessAlive, ProjectState } from "../state/store.js";
import { isWindows, isMacOS, isLinux } from "../platform/index.js";
import { run } from "../utils/exec.js";

interface StatusOptions {
  project?: string;
  json?: boolean;
  verbose?: boolean;
  watch?: boolean;
}

function calculateUptime(startedAt?: string): string {
  if (!startedAt) return "-";
  const start = new Date(startedAt);
  const now = new Date();
  const diff = now.getTime() - start.getTime();

  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((diff % (1000 * 60)) / 1000);

  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

/**
 * Get memory usage for a process (cross-platform).
 */
async function getMemoryUsage(pid: number): Promise<string> {
  try {
    if (isLinux()) {
      // Linux: Read from /proc/<pid>/status
      const { readFile } = await import("node:fs/promises");
      const status = await readFile(`/proc/${pid}/status`, "utf-8");
      const match = status.match(/VmRSS:\s+(\d+)\s+kB/);
      if (match) {
        const kb = parseInt(match[1]);
        if (kb > 1024) {
          return `${(kb / 1024).toFixed(1)} MB`;
        }
        return `${kb} KB`;
      }
    } else if (isMacOS()) {
      // macOS: Use ps command
      const result = await run("ps", ["-o", "rss=", "-p", String(pid)]);
      if (result.exitCode === 0) {
        const kb = parseInt(result.stdout.trim());
        if (!isNaN(kb)) {
          if (kb > 1024) {
            return `${(kb / 1024).toFixed(1)} MB`;
          }
          return `${kb} KB`;
        }
      }
    } else if (isWindows()) {
      // Windows: Use tasklist command
      const result = await run("tasklist", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"]);
      if (result.exitCode === 0) {
        // Parse CSV output: "node.exe","1234","Console","1","12,345 K"
        const match = result.stdout.match(/"(\d[\d,]*\s*K)"/);
        if (match) {
          const kbStr = match[1].replace(/,/g, "").replace(/\s*K/, "");
          const kb = parseInt(kbStr);
          if (!isNaN(kb)) {
            if (kb > 1024) {
              return `${(kb / 1024).toFixed(1)} MB`;
            }
            return `${kb} KB`;
          }
        }
      }
    }
  } catch {}
  return "-";
}

function formatProjectJson(project: ProjectState, isRunning: boolean, uptime: string, memory: string) {
  return {
    name: project.name,
    domain: project.domain,
    port: project.port,
    framework: project.framework,
    proxy: project.proxy,
    status: isRunning ? "running" : "stopped",
    pid: project.pid || null,
    url: isRunning ? `https://${project.domain}` : null,
    startedAt: project.startedAt || null,
    uptime: isRunning ? uptime : null,
    memory: isRunning ? memory : null,
    path: project.path,
  };
}

function printVerbose(project: ProjectState, isRunning: boolean, memory?: string) {
  log.plain("");
  const statusIcon = isRunning ? "\x1b[32m●\x1b[0m" : "\x1b[31m○\x1b[0m";
  const statusText = isRunning ? "\x1b[32mrunning\x1b[0m" : "\x1b[31mstopped\x1b[0m";

  log.plain(`  ${statusIcon} ${project.name} — ${statusText}`);
  log.plain(`    Domain:     ${project.domain}`);
  log.plain(`    Port:       ${project.port}`);
  log.plain(`    Framework:  ${project.framework}`);
  log.plain(`    Proxy:      ${project.proxy}`);
  log.plain(`    URL:        ${isRunning ? `https://${project.domain}` : "-"}`);
  log.plain(`    PID:        ${project.pid || "-"}`);
  log.plain(`    Registered: ${project.registeredAt}`);

  if (isRunning) {
    log.plain(`    Started:    ${project.startedAt || "-"}`);
    log.plain(`    Memory:     ${memory || "-"}`);
  }
}

function printCompact(project: ProjectState, isRunning: boolean) {
  const statusIcon = isRunning ? "\x1b[32m●\x1b[0m" : "\x1b[31m○\x1b[0m";
  const statusText = isRunning ? "running" : "stopped";

  log.plain("");
  log.plain(`  ${statusIcon} ${project.name}`);
  table([
    ["Status", statusText],
    ["Domain", project.domain],
    ["Port", String(project.port)],
    ["Framework", project.framework],
    ["Proxy", project.proxy],
    ["URL", isRunning ? `https://${project.domain}` : "-"],
    ["PID", project.pid ? String(project.pid) : "-"],
    ["Started", project.startedAt || "-"],
  ]);
}

export async function status(options: StatusOptions) {
  let projects = await listProjects();

  // Filter by project name if provided
  if (options.project) {
    const match = projects.filter(p =>
      p.name.toLowerCase() === options.project!.toLowerCase() ||
      p.path.toLowerCase().includes(options.project!.toLowerCase())
    );
    if (match.length === 0) {
      log.error(`Project not found: ${options.project}`);
      log.dim("Use 'orkestra list' to see all registered projects");
      process.exit(1);
    }
    projects = match;
  }

  if (projects.length === 0) {
    if (!options.json) {
      heading("Project Status");
      log.info("No projects registered.");
      log.dim("Run `orkestra register` in a project directory to get started.");
    }
    return;
  }

  // Check status of all projects
  const results = await Promise.all(
    projects.map(async (project) => {
      const isRunning = project.pid ? await isProcessAlive(project.pid) : false;
      const uptime = isRunning ? calculateUptime(project.startedAt) : "-";
      const memory = isRunning && project.pid ? await getMemoryUsage(project.pid) : "-";
      return { project, isRunning, uptime, memory };
    })
  );

  // JSON output
  if (options.json) {
    const jsonOutput = results.map(({ project, isRunning, uptime, memory }) =>
      formatProjectJson(project, isRunning, uptime, memory)
    );
    console.log(JSON.stringify(jsonOutput, null, 2));
    return;
  }

  heading("Project Status");

  // Watch mode
  if (options.watch) {
    // Clear screen and move cursor to top
    process.stdout.write("\x1b[2J\x1b[0;0H");

    const timestamp = new Date().toLocaleTimeString();
    log.dim(`Refreshed at ${timestamp} (Ctrl+C to stop)\n`);

    for (const { project, isRunning, memory } of results) {
      if (options.verbose) {
        printVerbose(project, isRunning, memory);
      } else {
        printCompact(project, isRunning);
      }
    }

    const running = results.filter((r) => r.isRunning).length;
    log.plain("");
    log.dim(`${results.length} project(s) registered, ${running} running`);

    // Watch loop
    return new Promise<void>((resolve) => {
      const interval = setInterval(async () => {
        // Re-check status
        const freshProjects = await listProjects();
        const freshResults = await Promise.all(
          freshProjects.map(async (project) => {
            const isRunning = project.pid ? await isProcessAlive(project.pid) : false;
            return { project, isRunning };
          })
        );

        // Clear and redraw
        process.stdout.write("\x1b[2J\x1b[0;0H");
        const ts = new Date().toLocaleTimeString();
        log.dim(`Refreshed at ${ts} (Ctrl+C to stop)\n`);

        for (const { project, isRunning } of freshResults) {
          if (options.verbose) {
            printVerbose(project, isRunning);
          } else {
            printCompact(project, isRunning);
          }
        }

        const running = freshResults.filter((r) => r.isRunning).length;
        log.plain("");
        log.dim(`${freshResults.length} project(s) registered, ${running} running`);
      }, 2000);

      process.on("SIGINT", () => {
        clearInterval(interval);
        resolve();
      });
    });
  }

  // Normal output
  for (const { project, isRunning, memory } of results) {
    if (options.verbose) {
      printVerbose(project, isRunning, memory);
    } else {
      printCompact(project, isRunning);
    }
  }

  const running = results.filter((r) => r.isRunning).length;
  log.plain("");
  log.dim(`${results.length} project(s) registered, ${running} running`);
}
