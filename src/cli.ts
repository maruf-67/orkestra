import { Command } from "commander";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { doctor } from "./commands/doctor.js";
import { register } from "./commands/register.js";
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
    .command("init")
    .description("Initialize a project with .orkestra.yml config")
    .option("-d, --dir <path>", "Project directory")
    .action(init);

  program
    .command("register")
    .description("Register project with proxy and hosts")
    .option("-d, --dir <path>", "Project directory")
    .option("--domain <domain>", "Domain name")
    .option("--port <port>", "Dev server port", parseInt)
    .option("--proxy <proxy>", "Proxy provider (caddy, apache, nginx)")
    .action(register);

  program
    .command("remove")
    .description("Remove project from proxy, hosts, certs, and config")
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
    .action(status);

  program
    .command("logs")
    .description("View dev server logs")
    .option("-d, --dir <path>", "Project directory")
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

  program.parse();
}

run();
