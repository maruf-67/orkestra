import { Command } from "commander";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { doctor } from "./commands/doctor.js";
import { remove } from "./commands/remove.js";
import { list } from "./commands/list.js";
import { init } from "./commands/init.js";
import { open } from "./commands/open.js";
import { up } from "./commands/up.js";
import { start } from "./commands/start.js";
import { down } from "./commands/down.js";
import { restart } from "./commands/restart.js";
import { status } from "./commands/status.js";
import { logs } from "./commands/logs.js";
import { db } from "./commands/db.js";
import { env } from "./commands/env.js";
import { docker } from "./commands/docker.js";
import { shell } from "./commands/shell.js";
import { completions } from "./commands/completions.js";
import { check } from "./commands/check.js";
import { share } from "./commands/share.js";
import { deploy } from "./commands/deploy.js";
import { services } from "./commands/services.js";
import { rollback } from "./commands/rollback.js";
import { monitor } from "./commands/monitor.js";
import { inspect } from "./commands/inspect.js";
import { mcp } from "./commands/mcp.js";
import { audit, security } from "./commands/audit.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(
  readFileSync(join(__dirname, "..", "package.json"), "utf-8")
);

export function run() {
  const program = new Command();

  program
    .name("orkestra")
    .description("A capability-driven development workspace manager and server deployment system")
    .version(pkg.version);

  program
    .command("doctor")
    .description("Check system capabilities and dependencies")
    .action(doctor);

  program
    .command("inspect")
    .description("Inspect project topology, framework, package manager, runtimes, ports, and databases")
    .argument("[dir]", "Project directory path (default: current directory)")
    .option("--json", "Output inspection data as JSON")
    .action((dir, options) => {
      inspect(dir, options);
    });

  program
    .command("monitor")
    .description("Live system and application observability dashboard (CPU, RAM, Disk, Systemd, Infrastructure)")
    .option("-p, --project <name>", "Filter by project name")
    .option("--json", "Output metrics as JSON")
    .option("-w, --watch", "Auto-refresh dashboard every 2 seconds")
    .action(monitor);

  program
    .command("deploy")
    .description("Deploy application (Laravel, Next.js, Nuxt) with git sync, build, systemd services, and Caddy proxy")
    .option("-d, --dir <path>", "Project directory")
    .option("-b, --branch <branch>", "Git branch (default: main)")
    .option("--strategy <strategy>", "Git strategy: reset or pull (default: reset)")
    .option("--dry-run", "Simulate deployment without modifying system state")
    .option("--no-migrate", "Skip database migrations")
    .option("--no-restart", "Skip restarting systemd services")
    .option("--remote <host>", "Remote SSH server host to deploy to")
    .option("-y, --yes", "Skip interactive prompts")
    .action(deploy);

  program
    .command("services")
    .description("Show live status of application and system services (Octane, Queue, Reverb, Caddy, Redis, MySQL)")
    .option("-p, --project <name>", "Project name filter")
    .option("--json", "Output as JSON")
    .option("-w, --watch", "Auto-refresh dashboard")
    .action(services);

  program
    .command("rollback")
    .description("Rollback application deployment to the previous or a specific commit")
    .argument("[project]", "Project name (optional)")
    .option("-d, --dir <path>", "Project directory")
    .option("--to <commit>", "Specific commit SHA to rollback to")
    .option("--dry-run", "Simulate rollback without executing changes")
    .action((projectArg, options) => {
      if (projectArg && !options.project) {
        options.project = projectArg;
      }
      rollback(options);
    });

  program
    .command("mcp")
    .description("Start the Model Context Protocol (MCP) server for AI assistants")
    .action(mcp);

  program
    .command("audit")
    .description("Security bundle: secrets/PII leaks, validation/SQLi/XSS, CVE (npm/composer online), audit trail")
    .option("-d, --dir <path>", "Project directory (default: cwd)")
    .option("--json", "Machine-readable JSON output")
    .option("--no-online", "Skip online CVE registry checks")
    .option("--history", "Show audit trail (last scans)")
    .option("--limit <n>", "History limit", parseInt)
    .action(audit);

  program
    .command("security")
    .description("Alias for audit — full security bundle")
    .option("-d, --dir <path>", "Project directory")
    .option("--json", "Machine-readable JSON output")
    .option("--no-online", "Skip online CVE checks")
    .option("--history", "Show audit trail")
    .action(security);

  program
    .command("check")
    .description("Validate configuration and check for issues")
    .option("-d, --dir <path>", "Project directory")
    .option("--fix", "Attempt to fix issues automatically")
    .action(check);

  program
    .command("init")
    .description("Initialize and register project with proxy, hosts, and SSL")
    .option("-d, --dir <path>", "Project directory")
    .option("--domain <domain>", "Domain name")
    .option("--port <port>", "Dev server port", parseInt)
    .option("--proxy <proxy>", "Proxy provider (caddy, apache, nginx)")
    .option("-y, --yes", "Skip prompts, use defaults (for CI/CD)")
    .action(init);

  program
    .command("remove")
    .description("Remove project from proxy, hosts, certs, logs, and config")
    .option("-d, --dir <path>", "Project directory")
    .action(remove);

  program
    .command("list")
    .description("List all registered projects")
    .action(list);

  program
    .command("up")
    .description("Start dev server")
    .option("-d, --dir <path>", "Project directory")
    .option("-p, --project <name>", "Project name (lookup from state)")
    .option("--port <port>", "Dev server port", parseInt)
    .option("-f, --foreground", "Run in foreground (see output directly)")
    .option("-a, --all", "Start all registered projects")
    .action(up);

  program
    .command("start")
    .description("Start production server (build + start)")
    .option("-d, --dir <path>", "Project directory")
    .option("-p, --project <name>", "Project name (lookup from state)")
    .option("--port <port>", "Server port", parseInt)
    .option("-f, --foreground", "Run in foreground (see output directly)")
    .option("--build", "Run build before starting (default: true)", true)
    .action(start);

  program
    .command("down")
    .description("Stop dev server")
    .option("-d, --dir <path>", "Project directory")
    .option("-p, --project <name>", "Project name (lookup from state)")
    .option("-a, --all", "Stop all running servers")
    .action(down);

  program
    .command("restart")
    .description("Restart dev server")
    .option("-d, --dir <path>", "Project directory")
    .action(restart);

  program
    .command("status")
    .description("Show project status")
    .option("-p, --project <name>", "Project name (lookup from state)")
    .option("--json", "Output as JSON")
    .option("-v, --verbose", "Show detailed information")
    .option("-w, --watch", "Auto-refresh every 2 seconds")
    .action(status);

  program
    .command("logs")
    .description("View dev server logs")
    .option("-d, --dir <path>", "Project directory")
    .option("-p, --project <name>", "Project name (lookup from state)")
    .option("-f, --follow", "Follow logs in real-time")
    .option("--since <time>", "Show logs since (e.g., 5m, 1h, 2d, 2024-01-01)")
    .option("--stream <stream>", "Filter by stream (stdout, stderr)")
    .option("-n, --limit <number>", "Number of recent log entries to show", parseInt)
    .option("-l, --list", "List available log files")
    .action(logs);

  program
    .command("open")
    .description("Open project in browser")
    .option("-d, --dir <path>", "Project directory")
    .option("-p, --project <name>", "Project name (lookup from state)")
    .action(open);

  program
    .command("db")
    .description("Database management")
    .option("-a, --action <action>", "Action: list, create, drop")
    .option("-n, --name <name>", "Database name")
    .option("-d, --dir <path>", "Project directory")
    .action(db);

  program
    .command("env")
    .description("Environment variable management")
    .option("-s, --set <key=value>", "Set a variable")
    .option("-g, --get <key>", "Get a variable")
    .option("-d, --dir <path>", "Project directory")
    .action(env);

  program
    .command("docker")
    .description("Docker compose management")
    .option("-a, --action <action>", "Action: list, up, down, status")
    .option("-d, --dir <path>", "Project directory")
    .action(docker);

  program
    .command("shell")
    .description("Open shell with project environment variables")
    .option("-d, --dir <path>", "Project directory")
    .action(shell);

  program
    .command("completions")
    .description("Generate shell completion scripts")
    .option("--shell <shell>", "Shell type (zsh, bash, fish)")
    .action(completions);

  program
    .command("share")
    .description("Share project via tunnel")
    .argument("[project]", "Project name (optional)")
    .option("-d, --dir <path>", "Project directory")
    .option("-p, --project <name>", "Project name (lookup from state)")
    .option("--provider <provider>", "Share provider (localtunnel)")
    .option("--qr", "Show QR code for mobile scanning")
    .option("--copy", "Copy URL to clipboard")
    .option("--json", "Output as JSON")
    .option("--stop", "Stop sharing")
    .option("--status", "Show share status")
    .option("--url", "Show and copy tunnel URL")
    .action((projectName, options) => {
      if (projectName && !options.project) {
        options.project = projectName;
      }
      share(options);
    });

  program.parse();
}

run();
