import { resolve } from "node:path";
import { log, heading, table, spinner } from "../utils/logger.js";
import { detectDatabases, type DatabaseInfo } from "../detection/database.js";
import { run } from "../utils/exec.js";
import prompts from "prompts";

interface DbOptions {
  action?: "list" | "create" | "drop";
  name?: string;
  dir?: string;
}

export async function db(options: DbOptions) {
  const projectDir = resolve(options.dir || process.cwd());

  if (!options.action) {
    // Show database status
    heading("Databases");

    const spin = spinner("Detecting databases...");
    spin.start();
    const databases = await detectDatabases(projectDir);
    spin.stop();

    const results: [string, string, string][] = [];
    for (const db of databases) {
      results.push([db.name, db.detected ? "✓" : "✗", db.command || ""]);
    }

    table([
      ["Name", "Detected", "Command"],
      ...results,
    ]);

    log.plain("");
    log.dim("Commands:");
    log.dim("  orkestra db create <name>   Create a database");
    log.dim("  orkestra db drop <name>     Drop a database");
    log.dim("  orkestra db list            List databases");
    return;
  }

  if (options.action === "list") {
    heading("Databases");
    const databases = await detectDatabases(projectDir);
    const detected = databases.filter((d) => d.detected);
    if (detected.length === 0) {
      log.info("No databases detected in this project.");
      return;
    }
    for (const db of detected) {
      log.plain(`  ${db.name} (${db.type})`);
    }
    return;
  }

  if (options.action === "create") {
    if (!options.name) {
      const response = await prompts({
        type: "text",
        name: "name",
        message: "Database name:",
      });
      options.name = response.name;
    }

    if (!options.name) {
      log.error("Database name is required.");
      process.exit(1);
    }

    await createDatabase(projectDir, options.name);
    return;
  }

  if (options.action === "drop") {
    if (!options.name) {
      const response = await prompts({
        type: "text",
        name: "name",
        message: "Database name to drop:",
      });
      options.name = response.name;
    }

    if (!options.name) {
      log.error("Database name is required.");
      process.exit(1);
    }

    const confirm = await prompts({
      type: "confirm",
      name: "value",
      message: `Drop database "${options.name}"? This cannot be undone.`,
      initial: false,
    });

    if (!confirm.value) {
      log.info("Aborted.");
      return;
    }

    await dropDatabase(projectDir, options.name);
    return;
  }
}

async function createDatabase(dir: string, name: string) {
  const databases = await detectDatabases(dir);
  const detected = databases.filter((d) => d.detected && d.command);

  if (detected.length === 0) {
    log.error("No database detected. Install PostgreSQL, MySQL, or SQLite.");
    return;
  }

  // Try each detected database
  for (const db of detected) {
    const spin = spinner(`Creating ${name} on ${db.name}...`);
    spin.start();

    let result;
    if (db.name === "postgresql" && db.command === "psql") {
      result = await run("createdb", [name]);
    } else if (db.name === "mysql" && db.command === "mysql") {
      result = await run("mysql", ["-e", `CREATE DATABASE ${name}`]);
    } else if (db.name === "sqlite") {
      // SQLite creates on first connect
      log.info("SQLite databases are created automatically on first use.");
      spin.succeed(`SQLite database will be created at ${name}.db`);
      return;
    }

    if (result && result.exitCode === 0) {
      spin.succeed(`Created ${name} on ${db.name}`);
      return;
    } else {
      spin.fail(`Failed to create on ${db.name}`);
    }
  }
}

async function dropDatabase(dir: string, name: string) {
  const databases = await detectDatabases(dir);
  const detected = databases.filter((d) => d.detected && d.command);

  for (const db of detected) {
    const spin = spinner(`Dropping ${name} from ${db.name}...`);
    spin.start();

    let result;
    if (db.name === "postgresql" && db.command === "psql") {
      result = await run("dropdb", [name]);
    } else if (db.name === "mysql" && db.command === "mysql") {
      result = await run("mysql", ["-e", `DROP DATABASE ${name}`]);
    } else if (db.name === "sqlite") {
      const { unlink } = await import("node:fs/promises");
      const { join } = await import("node:path");
      const dbPath = join(dir, `${name}.db`);
      try {
        await unlink(dbPath);
        spin.succeed(`Deleted ${dbPath}`);
        return;
      } catch {
        spin.fail(`File not found: ${dbPath}`);
        return;
      }
    }

    if (result && result.exitCode === 0) {
      spin.succeed(`Dropped ${name} from ${db.name}`);
      return;
    } else {
      spin.fail(`Failed to drop from ${db.name}`);
    }
  }
}
