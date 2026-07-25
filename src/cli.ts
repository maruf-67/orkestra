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

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(
  readFileSync(join(__dirname, "..", "package.json"), "utf-8")
);

export function run() {
  const program = new Command();

  program
    .name("orkestra")
    .description("A cross-platform development workspace manager")
    .version(pkg.version);

  program
    .command("doctor")
    .description("Check system capabilities and dependencies")
    .action(doctor);

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
    .option("--port <port>", "Dev server port", parseInt)
    .option("-f, --foreground", "Run in foreground (see output directly)")
    .option("-a, --all", "Start all registered projects")
    .action(up);

  program
    .command("down")
    .description("Stop dev server")
    .option("-d, --dir <path>", "Project directory")
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
    .option("--json", "Output as JSON")
    .option("-v, --verbose", "Show detailed information")
    .option("-w, --watch", "Auto-refresh every 2 seconds")
    .action(status);

  program
    .command("logs")
    .description("View dev server logs")
    .option("-d, --dir <path>", "Project directory")
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

  program.parse();
}

run();
