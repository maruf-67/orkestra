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

export class NuxtProvider implements ApplicationProvider {
  readonly name = "nuxt";
  readonly framework = "nuxt";

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

    if (!allDeps["nuxt"]) return null;

    const pm = this.detectPackageManager(dir);
    const hasBun = Boolean(allDeps["bun"]) || pm === "bun";

    return {
      name: pkg.name || "nuxt-app",
      framework: "nuxt",
      version: allDeps["nuxt"] || "unknown",
      language: existsSync(join(dir, "tsconfig.json")) ? "typescript" : "javascript",
      packageManager: pm,
      runtime: hasBun ? "bun" : "node",
      defaultPort: 3000,
      buildCommand: `${pm} run build`,
      startCommand: `node .output/server/index.mjs`,
      capabilities: {
        hasNitro: true,
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

  async prepare(_context: DeploymentContext): Promise<{ output?: string }> {
    return { output: "" };
  }

  async build(context: DeploymentContext): Promise<{ durationMs: number; output: string }> {
    const start = Date.now();
    const explicitPm = context.config?.deployment?.packageManager || context.config?.packageManager;
    const pm = this.detectPackageManager(context.projectDir, explicitPm);
    const cmd = context.binaries[pm] || pm;

    const res = await run(cmd, ["run", "build"], {
      cwd: context.projectDir,
      env: {
        NODE_ENV: "production",
      },
    });

    if (res.exitCode !== 0) {
      throw new Error(`Nuxt build failed:\n${res.stderr || res.stdout}`);
    }

    return { durationMs: Date.now() - start, output: res.stdout || res.stderr };
  }

  async services(
    context: DeploymentContext,
    _detection: ApplicationDetection
  ): Promise<ServiceDefinition[]> {
    const port =
      (typeof context.config?.proxy === "object" ? context.config.proxy.api?.port : undefined) ||
      context.config?.port ||
      3000;

    const explicitPm = context.config?.deployment?.packageManager || context.config?.packageManager;
    const pm = this.detectPackageManager(context.projectDir, explicitPm);
    const serverFile = join(context.projectDir, ".output", "server", "index.mjs");
    let execStart = "";

    if (pm === "bun" || context.binaries.bun) {
      execStart = `${context.binaries.bun} ${serverFile}`;
    } else {
      execStart = `${context.binaries.node} ${serverFile}`;
    }

    return [
      {
        name: "web",
        type: "web",
        port,
        command: execStart,
        env: {
          PORT: String(port),
          HOST: "127.0.0.1",
          NODE_ENV: "production",
        },
      },
    ];
  }

  async proxy(
    context: DeploymentContext,
    _detection: ApplicationDetection
  ): Promise<ProxyDefinition[]> {
    const domain =
      (typeof context.config?.proxy === "object" ? context.config.proxy.api?.domain : undefined) ||
      context.config?.domain ||
      `${context.projectName}.dev.com`;

    const port =
      (typeof context.config?.proxy === "object" ? context.config.proxy.api?.port : undefined) ||
      context.config?.port ||
      3000;

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
    await this.build(context);
  }
}
