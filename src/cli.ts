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
    .description("Remove project from proxy and hosts")
    .option("-d, --dir <path>", "Project directory")
    .action(remove);

  program
    .command("list")
    .description("List all registered projects")
    .action(list);

  program
    .command("open")
    .description("Open project in browser")
    .option("-d, --dir <path>", "Project directory")
    .action(open);

  program.parse();
}

run();
