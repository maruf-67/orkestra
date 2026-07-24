import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { isCommandAvailable } from "../utils/exec.js";

export interface DatabaseInfo {
  name: string;
  type: "sql" | "nosql";
  detected: boolean;
  command?: string;
}

async function readText(dir: string, file: string): Promise<string> {
  try {
    return await readFile(join(dir, file), "utf-8");
  } catch {
    return "";
  }
}

async function detectFromEnv(dir: string): Promise<string[]> {
  const env = await readText(dir, ".env");
  const dbs: string[] = [];

  if (env.includes("DB_CONNECTION=pgsql") || env.includes("DB_CONNECTION=postgres")) {
    dbs.push("postgresql");
  }
  if (env.includes("DB_CONNECTION=mysql")) {
    dbs.push("mysql");
  }
  if (env.includes("DB_CONNECTION=sqlite")) {
    dbs.push("sqlite");
  }
  if (env.includes("DATABASE_URL")) {
    if (env.includes("postgres")) dbs.push("postgresql");
    if (env.includes("mysql")) dbs.push("mysql");
    if (env.includes("sqlite")) dbs.push("sqlite");
    if (env.includes("mongodb")) dbs.push("mongodb");
  }

  return dbs;
}

async function detectFromLaravel(dir: string): Promise<string[]> {
  const env = await readText(dir, ".env");
  const dbs: string[] = [];

  if (env.includes("DB_CONNECTION=pgsql")) dbs.push("postgresql");
  if (env.includes("DB_CONNECTION=mysql")) dbs.push("mysql");
  if (env.includes("DB_CONNECTION=sqlite")) dbs.push("sqlite");

  return dbs;
}

async function detectFromDockerCompose(dir: string): Promise<string[]> {
  const compose = await readText(dir, "docker-compose.yml");
  const composeOverride = await readText(dir, "docker-compose.override.yml");
  const all = compose + composeOverride;
  const dbs: string[] = [];

  if (all.includes("image: postgres") || all.includes("image: postgresql")) dbs.push("postgresql");
  if (all.includes("image: mysql") || all.includes("image: mariadb")) dbs.push("mysql");
  if (all.includes("image: mongo")) dbs.push("mongodb");
  if (all.includes("image: redis")) dbs.push("redis");

  return dbs;
}

async function detectFromPackageJson(dir: string): Promise<string[]> {
  try {
    const pkg = JSON.parse(await readFile(join(dir, "package.json"), "utf-8"));
    const allDeps = { ...(pkg.dependencies as object), ...(pkg.devDependencies as object) };
    const dbs: string[] = [];

    if (allDeps?.["pg"] || allDeps?.["postgres"]) dbs.push("postgresql");
    if (allDeps?.["mysql2"] || allDeps?.["mysql"]) dbs.push("mysql");
    if (allDeps?.["better-sqlite3"] || allDeps?.["sqlite3"]) dbs.push("sqlite");
    if (allDeps?.["mongodb"] || allDeps?.["mongoose"]) dbs.push("mongodb");
    if (allDeps?.["redis"] || allDeps?.["ioredis"]) dbs.push("redis");

    return dbs;
  } catch {
    return [];
  }
}

async function detectFromRequirements(dir: string): Promise<string[]> {
  const req = await readText(dir, "requirements.txt");
  const pyproject = await readText(dir, "pyproject.toml");
  const all = req + pyproject;
  const dbs: string[] = [];

  if (all.includes("psycopg2") || all.includes("asyncpg")) dbs.push("postgresql");
  if (all.includes("pymysql") || all.includes("mysqlclient")) dbs.push("mysql");
  if (all.includes("pymongo")) dbs.push("mongodb");
  if (all.includes("redis")) dbs.push("redis");

  return dbs;
}

async function detectFromGoMod(dir: string): Promise<string[]> {
  const gomod = await readText(dir, "go.mod");
  const dbs: string[] = [];

  if (gomod.includes("lib/pq") || gomod.includes("pgx")) dbs.push("postgresql");
  if (gomod.includes("go-sql-driver/mysql")) dbs.push("mysql");
  if (gomod.includes("go.mongodb.org")) dbs.push("mongodb");
  if (gomod.includes("go-redis")) dbs.push("redis");

  return dbs;
}

async function detectFromCargoToml(dir: string): Promise<string[]> {
  const cargo = await readText(dir, "Cargo.toml");
  const dbs: string[] = [];

  if (cargo.includes("postgres") || cargo.includes("sqlx")) dbs.push("postgresql");
  if (cargo.includes("mysql")) dbs.push("mysql");
  if (cargo.includes("mongodb")) dbs.push("mongodb");
  if (cargo.includes("redis")) dbs.push("redis");

  return dbs;
}

export async function detectDatabases(dir: string): Promise<DatabaseInfo[]> {
  const detected = new Set<string>();

  // Detect from various sources
  const sources = [
    detectFromEnv(dir),
    detectFromLaravel(dir),
    detectFromDockerCompose(dir),
    detectFromPackageJson(dir),
    detectFromRequirements(dir),
    detectFromGoMod(dir),
    detectFromCargoToml(dir),
  ];

  const results = await Promise.all(sources);
  for (const dbs of results) {
    for (const db of dbs) {
      detected.add(db);
    }
  }

  // Check if database commands are available
  const dbCommands: Record<string, string> = {
    postgresql: "psql",
    mysql: "mysql",
    sqlite: "sqlite3",
    mongodb: "mongosh",
    redis: "redis-cli",
  };

  const databases: DatabaseInfo[] = [];
  for (const [name, command] of Object.entries(dbCommands)) {
    const isAvailable = await isCommandAvailable(command);
    databases.push({
      name,
      type: name === "mongodb" ? "nosql" : "sql",
      detected: detected.has(name),
      command: isAvailable ? command : undefined,
    });
  }

  return databases;
}

export function listDatabases(): string[] {
  return ["postgresql", "mysql", "sqlite", "mongodb", "redis"];
}
