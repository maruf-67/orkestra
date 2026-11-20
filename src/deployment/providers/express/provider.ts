import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type {
  ApplicationProvider,
  ApplicationDetection,
  DeploymentContext,
  ServiceDefinition,
  ProxyDefinition,
  HealthCheckDefinition,
} from "../types.js";
import { run } from "../../../utils/exec.js";
import { resolvePorts } from "../../ports.js";

function parseSimpleEnv(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    result[key] = val;
  }
  return result;
}

function sanitizeDatabaseUrl(urlStr: string): string {
  if (!urlStr) return urlStr;
  const match = urlStr.match(
    /^([a-zA-Z0-9+.-]+):\/\/([^:]+):(.*)@([^@\/:?#]+)(?::([0-9]+))?(\/[^?#]*)?(?:\?(.*))?$/
  );
  if (!match) return urlStr;
  const [, protocol, user, pass, host, port, path, query] = match;
  if (!protocol || !user || pass === undefined || !host) return urlStr;

  let decodedPass = pass;
  try {
    decodedPass = decodeURIComponent(pass);
  } catch {}
  const encodedPass = encodeURIComponent(decodedPass);
  const portPart = port ? `:${port}` : "";
  const pathPart = path || "";
  const queryPart = query ? `?${query}` : "";
  let decodedUser = user;
  try {
    decodedUser = decodeURIComponent(user);
  } catch {}
  return `${protocol}://${encodeURIComponent(decodedUser)}:${encodedPass}@${host}${portPart}${pathPart}${queryPart}`;
}

function resolveDatabaseUrl(envMap: Record<string, string>): string | undefined {
  if (envMap.DATABASE_URL && envMap.DATABASE_URL.trim() !== "") {
    return sanitizeDatabaseUrl(envMap.DATABASE_URL.trim());
  }
  if (envMap.DB_HOST || envMap.DB_PASSWORD || envMap.DB_DATABASE || envMap.DB_USERNAME) {
    const rawConn = envMap.DB_CONNECTION || "pgsql";
    const conn = rawConn === "pgsql" || rawConn === "postgres" ? "postgresql" : rawConn;
    const user = encodeURIComponent(envMap.DB_USERNAME || "postgres");
    const pass = envMap.DB_PASSWORD ? `:${encodeURIComponent(envMap.DB_PASSWORD)}` : "";
    const host = envMap.DB_HOST || "127.0.0.1";
    const port = envMap.DB_PORT || "5432";
    const db = envMap.DB_DATABASE || "portfolio_db";
    const schema = envMap.DB_SCHEMA || "public";
    return `${conn}://${user}${pass}@${host}:${port}/${db}?schema=${schema}`;
  }
  return undefined;
}

export class ExpressProvider implements ApplicationProvider {
  readonly name = "express";
  readonly framework = "express";

  private detectPackageManager(dir: string, explicitPm?: string): "bun" | "pnpm" | "npm" | "yarn" {
    if (explicitPm && explicitPm !== "auto") {
      return explicitPm as "bun" | "pnpm" | "npm" | "yarn";
    }
    // Top Priority: Bun, then pnpm, then npm, then yarn
    if (existsSync(join(dir, "bun.lock")) || existsSync(join(dir, "bun.lockb"))) return "bun";
    if (existsSync(join(dir, "pnpm-lock.yaml"))) return "pnpm";
    if (existsSync(join(dir, "package-lock.json"))) return "npm";
    if (existsSync(join(dir, "yarn.lock"))) return "yarn";
    return "bun";
  }

  async detect(dir: string): Promise<ApplicationDetection | null> {
    const pkgPath = join(dir, "package.json");
    if (!existsSync(pkgPath)) return null;

    let pkg: any = null;
    try {
      pkg = JSON.parse(await readFile(pkgPath, "utf-8"));
    } catch {
      return null;
    }

    const allDeps = {
      ...(pkg.dependencies || {}),
      ...(pkg.devDependencies || {}),
    };

    const isExpress = Boolean(allDeps["express"]) || Boolean(allDeps["fastify"]);
    if (!isExpress) return null;

    const pm = this.detectPackageManager(dir);
    const hasBun = Boolean(allDeps["bun"]) || pm === "bun";
    const hasPrisma =
      existsSync(join(dir, "prisma", "schema.prisma")) ||
      Boolean(allDeps["@prisma/client"]) ||
      Boolean(allDeps["prisma"]);

    const buildCmd = pkg.scripts?.build
      ? `${pm} run build`
      : hasPrisma
      ? `${pm === "bun" ? "bunx" : "npx"} prisma generate`
      : undefined;

    const startCmd = pkg.scripts?.start
      ? `${pm} run start`
      : hasBun
      ? "bun src/server.ts"
      : "node src/server.js";

    return {
      name: pkg.name || "express-app",
      framework: "express",
      version: allDeps["express"] || allDeps["fastify"] || "unknown",
      language: existsSync(join(dir, "tsconfig.json")) ? "typescript" : "javascript",
      packageManager: pm,
      runtime: hasBun ? "bun" : "node",
      defaultPort: 4000,
      buildCommand: buildCmd,
      startCommand: startCmd,
      capabilities: {
        hasPrisma,
        hasTypeScript: existsSync(join(dir, "tsconfig.json")),
      },
    };
  }

  async installDependencies(context: DeploymentContext): Promise<{ durationMs: number; output: string }> {
    const start = Date.now();
    const explicitPm = context.config?.deployment?.packageManager || context.config?.packageManager;
    const pm = this.detectPackageManager(context.projectDir, explicitPm);
    let cmd = context.binaries[pm] || pm;
    let args: string[] = [];

    switch (pm) {
      case "bun":
        args = ["install", "--frozen-lockfile"];
        break;
      case "pnpm":
        args = ["install", "--frozen-lockfile"];
        break;
      case "yarn":
        args = ["install", "--immutable"];
        break;
      case "npm":
        args = ["ci"];
        break;
    }

    const res = await run(cmd, args, { cwd: context.projectDir });
    if (res.exitCode !== 0) {
      // Fallback to standard install if frozen lockfile fails
      const fallback = await run(cmd, ["install"], { cwd: context.projectDir });
      if (fallback.exitCode !== 0) {
        throw new Error(`Failed to install dependencies with ${pm}:\n${fallback.stderr || fallback.stdout}`);
      }
      return { durationMs: Date.now() - start, output: fallback.stdout || fallback.stderr };
    }

    return { durationMs: Date.now() - start, output: res.stdout || res.stderr };
  }

  async prepare(context: DeploymentContext): Promise<{ output?: string }> {
    let output = "";
    const explicitPm = context.config?.deployment?.packageManager || context.config?.packageManager;
    const pm = this.detectPackageManager(context.projectDir, explicitPm);
    const runner = pm === "bun" ? (context.binaries.bun ? `${context.binaries.bun}x` : "bunx") : "npx";

    const schemaPath = join(context.projectDir, "prisma", "schema.prisma");
    const hasPrisma = existsSync(schemaPath);

    if (hasPrisma) {
      let envOverrides: Record<string, string> | undefined;
      const envPath = join(context.projectDir, ".env");
      if (existsSync(envPath)) {
        try {
          const envContent = await readFile(envPath, "utf-8");
          const parsed = parseSimpleEnv(envContent);
          const resolvedDbUrl = resolveDatabaseUrl(parsed);
          if (resolvedDbUrl) {
            envOverrides = { DATABASE_URL: resolvedDbUrl };
          }
        } catch {}
      }

      // 1. Prisma Generate
      const genRes = await run(runner, ["prisma", "generate"], { cwd: context.projectDir, env: envOverrides });
      if (genRes.exitCode !== 0) {
        const fallbackGen = await run("npx", ["prisma", "generate"], { cwd: context.projectDir, env: envOverrides });
        if (fallbackGen.exitCode !== 0) {
          throw new Error(`Prisma generate failed:\n${fallbackGen.stderr || fallbackGen.stdout || genRes.stderr}`);
        }
        output += (fallbackGen.stdout || "") + "\n";
      } else {
        output += (genRes.stdout || "") + "\n";
      }

      // 2. Prisma Migrate or DB Push
      const shouldMigrate =
        context.config?.deployment?.database?.migrate !== false &&
        !context.options.noMigrate;

      if (shouldMigrate) {
        const migrationsDir = join(context.projectDir, "prisma", "migrations");
        const hasMigrations = existsSync(migrationsDir);

        if (hasMigrations) {
          const migRes = await run(runner, ["prisma", "migrate", "deploy"], { cwd: context.projectDir, env: envOverrides });
          if (migRes.exitCode !== 0) {
            const fallbackMig = await run("npx", ["prisma", "migrate", "deploy"], { cwd: context.projectDir, env: envOverrides });
            if (fallbackMig.exitCode !== 0) {
              throw new Error(`Prisma migrate deploy failed:\n${fallbackMig.stderr || fallbackMig.stdout || migRes.stderr}`);
            }
            output += (fallbackMig.stdout || "") + "\n";
          } else {
            output += (migRes.stdout || "") + "\n";
          }
        } else {
          // If no migrations folder exists, push schema definitions to database
          const pushRes = await run(runner, ["prisma", "db", "push", "--skip-generate"], { cwd: context.projectDir, env: envOverrides });
          if (pushRes.exitCode !== 0) {
            const fallbackPush = await run("npx", ["prisma", "db", "push", "--skip-generate"], { cwd: context.projectDir, env: envOverrides });
            if (fallbackPush.exitCode !== 0) {
              throw new Error(`Prisma db push failed:\n${fallbackPush.stderr || fallbackPush.stdout || pushRes.stderr}`);
            }
            output += (fallbackPush.stdout || "") + "\n";
          } else {
            output += (pushRes.stdout || "") + "\n";
          }
        }
      }

      // 3. Optional Database Seed
      if (context.config?.deployment?.database?.seed) {
        await run(runner, ["prisma", "db", "seed"], { cwd: context.projectDir, env: envOverrides }).catch(() => {});
      }
    }

    return { output };
  }

  async build(context: DeploymentContext): Promise<{ durationMs: number; output: string }> {
    const start = Date.now();
    const explicitPm = context.config?.deployment?.packageManager || context.config?.packageManager;
    const pm = this.detectPackageManager(context.projectDir, explicitPm);
    const cmd = context.binaries[pm] || pm;

    const pkgPath = join(context.projectDir, "package.json");
    let hasBuild = false;
    try {
      const pkg = JSON.parse(await readFile(pkgPath, "utf-8"));
      hasBuild = Boolean(pkg.scripts?.build);
    } catch {}

    if (hasBuild) {
      const res = await run(cmd, ["run", "build"], {
        cwd: context.projectDir,
        env: {
          NODE_ENV: "production",
        },
      });

      if (res.exitCode !== 0) {
        throw new Error(`Express build failed:\n${res.stderr || res.stdout}`);
      }
      return { durationMs: Date.now() - start, output: res.stdout || res.stderr };
    }

    return { durationMs: Date.now() - start, output: "No build script required" };
  }

  async services(
    context: DeploymentContext,
    _detection: ApplicationDetection
  ): Promise<ServiceDefinition[]> {
    const { apiPort: port } = resolvePorts(context.config, {
      projectName: context.projectName,
      defaultApiPort: 4000,
    });

    const explicitPm = context.config?.deployment?.packageManager || context.config?.packageManager;
    const pm = this.detectPackageManager(context.projectDir, explicitPm);
    let execStart = "";

    if (context.config?.startCommand) {
      execStart = context.config.startCommand;
    } else if (pm === "bun" || context.binaries.bun) {
      const bunBin = context.binaries.bun || "bun";
      execStart = `${bunBin} run start`;
    } else {
      const nodeBin = context.binaries.node || "node";
      execStart = `${nodeBin} src/server.js`;
    }

    return [
      {
        name: "web",
        type: "web",
        port,
        command: execStart,
        env: {
          PORT: String(port),
          NODE_ENV: "production",
          HOST: "127.0.0.1",
        },
      },
    ];
  }

  async proxy(
    context: DeploymentContext,
    _detection: ApplicationDetection
  ): Promise<ProxyDefinition[]> {
    const { apiDomain: domain, apiPort: port } = resolvePorts(context.config, {
      projectName: context.projectName,
      defaultApiPort: 4000,
    });

    return [
      {
        domain,
        port,
        ssl: context.config?.ssl ?? true,
      },
    ];
  }

  async healthChecks(
    context: DeploymentContext,
    _detection: ApplicationDetection
  ): Promise<HealthCheckDefinition[]> {
    const domain =
      (typeof context.config?.proxy === "object" ? context.config.proxy.api?.domain : undefined) ||
      context.config?.domain;

    if (domain) {
      const checkPath = context.config?.health?.api?.url || `https://${domain}/api/health`;
      return [
        {
          apiUrl: checkPath,
          expectedStatus: 200,
          timeoutMs: 5000,
        },
      ];
    }

    return [];
  }

  async rollback(context: DeploymentContext): Promise<void> {
    await this.installDependencies(context);
    await this.prepare(context);
    await this.build(context);
  }
}
