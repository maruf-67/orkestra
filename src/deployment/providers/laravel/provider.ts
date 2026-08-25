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
import { installComposerDependencies } from "../../composer.js";
import { runLaravelMigrations, ensureStorageLink, optimizeLaravel } from "../../laravel.js";

export class LaravelProvider implements ApplicationProvider {
  readonly name = "laravel";
  readonly framework = "laravel";

  async detect(dir: string): Promise<ApplicationDetection | null> {
    const composerPath = join(dir, "composer.json");
    if (!existsSync(composerPath) && !existsSync(join(dir, "artisan"))) {
      return null;
    }

    let composer: any = null;
    try {
      composer = JSON.parse(await readFile(composerPath, "utf-8"));
    } catch {}

    const requireDeps: Record<string, string> = composer?.require || {};
    const requireDevDeps: Record<string, string> = composer?.["require-dev"] || {};
    const allDeps = { ...requireDeps, ...requireDevDeps };

    const isLaravel =
      Boolean(allDeps["laravel/framework"]) ||
      existsSync(join(dir, "artisan"));

    if (!isLaravel) return null;

    const hasOctane = Boolean(allDeps["laravel/octane"]);
    const hasReverb = Boolean(allDeps["laravel/reverb"]);

    let octaneServer: "roadrunner" | "swoole" | "frankenphp" | "none" = "none";
    if (hasOctane) {
      if (existsSync(join(dir, ".rr.yaml")) || existsSync(join(dir, "rr"))) {
        octaneServer = "roadrunner";
      } else {
        octaneServer = "roadrunner";
      }
    }

    return {
      name: composer?.name || "laravel-app",
      framework: "laravel",
      version: allDeps["laravel/framework"] || "unknown",
      language: "php",
      packageManager: "composer",
      runtime: "php",
      defaultPort: 8000,
      buildCommand: "php artisan optimize",
      startCommand: hasOctane ? "php artisan octane:start" : "php artisan serve",
      capabilities: {
        hasOctane,
        octaneServer,
        hasReverb,
        hasQueue: true,
      },
    };
  }

  async installDependencies(context: DeploymentContext): Promise<{ durationMs: number; output: string }> {
    const flags =
      typeof context.config?.deployment?.composer === "object"
        ? context.config.deployment.composer.flags
        : undefined;

    return installComposerDependencies({
      composerBinary: context.binaries.composer,
      flags,
      cwd: context.projectDir,
    });
  }

  async prepare(context: DeploymentContext): Promise<{ output?: string }> {
    const shouldMigrate =
      context.config?.deployment?.database?.migrate !== false &&
      !context.options.noMigrate;

    let output = "";

    if (shouldMigrate) {
      const res = await runLaravelMigrations({
        phpBinary: context.binaries.php,
        cwd: context.projectDir,
        seed: context.config?.deployment?.database?.seed,
      });
      output += res.output + "\n";
    }

    await ensureStorageLink({
      phpBinary: context.binaries.php,
      cwd: context.projectDir,
    });

    return { output };
  }

  async build(context: DeploymentContext): Promise<{ durationMs: number; output: string }> {
    const start = Date.now();
    let output = "";

    if (context.config?.deployment?.optimize !== false) {
      const res = await optimizeLaravel({
        phpBinary: context.binaries.php,
        cwd: context.projectDir,
      });
      output = res.output;
    }

    return { durationMs: Date.now() - start, output };
  }

  async services(
    context: DeploymentContext,
    detection: ApplicationDetection
  ): Promise<ServiceDefinition[]> {
    const config = context.config;
    const services: ServiceDefinition[] = [];

    const apiPort =
      (typeof config?.proxy === "object" ? config.proxy.api?.port : undefined) ||
      config?.services?.octane?.port ||
      config?.port ||
      8000;

    const reverbPort =
      (typeof config?.proxy === "object" ? config.proxy.realtime?.port : undefined) ||
      config?.services?.reverb?.port ||
      config?.reverbPort ||
      8080;

    // Octane
    const octaneEnabled =
      config?.services?.octane?.enabled === true ||
      (config?.services?.octane?.enabled === "auto" && detection.capabilities.hasOctane) ||
      (config?.services?.octane?.enabled === undefined && detection.capabilities.hasOctane);

    if (octaneEnabled) {
      const serverType = detection.capabilities.octaneServer !== "none"
        ? detection.capabilities.octaneServer
        : "roadrunner";

      services.push({
        name: "octane",
        type: "octane",
        port: apiPort,
        command: `${context.binaries.php} artisan octane:start --server=${serverType} --host=127.0.0.1 --port=${apiPort} --no-interaction`,
      });
    }

    // Queue
    const queueEnabled = config?.services?.queue?.enabled !== false;
    if (queueEnabled) {
      services.push({
        name: "queue",
        type: "queue",
        queueConnection: config?.services?.queue?.connection || "redis",
        queues: config?.services?.queue?.queues || "default",
        command: `${context.binaries.php} artisan queue:work --sleep=3 --tries=3 --no-interaction`,
      });
    }

    // Reverb
    const reverbEnabled =
      config?.services?.reverb?.enabled === true ||
      (config?.services?.reverb?.enabled === "auto" && detection.capabilities.hasReverb) ||
      (config?.services?.reverb?.enabled === undefined && detection.capabilities.hasReverb);

    if (reverbEnabled) {
      services.push({
        name: "reverb",
        type: "reverb",
        port: reverbPort,
        command: `${context.binaries.php} artisan reverb:start --host=127.0.0.1 --port=${reverbPort} --no-interaction`,
      });
    }

    return services;
  }

  async proxy(
    context: DeploymentContext,
    detection: ApplicationDetection
  ): Promise<ProxyDefinition[]> {
    const config = context.config;
    const proxies: ProxyDefinition[] = [];

    const apiDomain =
      (typeof config?.proxy === "object" ? config.proxy.api?.domain : undefined) ||
      config?.domain ||
      `${context.projectName}.dev.com`;

    const apiPort =
      (typeof config?.proxy === "object" ? config.proxy.api?.port : undefined) ||
      config?.services?.octane?.port ||
      config?.port ||
      8000;

    proxies.push({
      domain: apiDomain,
      port: apiPort,
      ssl: config?.ssl ?? true,
    });

    const reverbDomain =
      (typeof config?.proxy === "object" ? config.proxy.realtime?.domain : undefined) ||
      config?.reverbDomain;

    const reverbPort =
      (typeof config?.proxy === "object" ? config.proxy.realtime?.port : undefined) ||
      config?.services?.reverb?.port ||
      config?.reverbPort ||
      8080;

    if (reverbDomain && detection.capabilities.hasReverb) {
      proxies.push({
        domain: reverbDomain,
        port: reverbPort,
        ssl: config?.ssl ?? true,
        websocket: true,
      });
    }

    return proxies;
  }

  async healthChecks(
    context: DeploymentContext,
    detection: ApplicationDetection
  ): Promise<HealthCheckDefinition[]> {
    const config = context.config;
    const checks: HealthCheckDefinition[] = [];

    const apiDomain =
      (typeof config?.proxy === "object" ? config.proxy.api?.domain : undefined) ||
      config?.domain;

    if (apiDomain) {
      checks.push({
        apiUrl: `https://${apiDomain}/up`,
        expectedStatus: 200,
        timeoutMs: 5000,
      });
    }

    if (detection.capabilities.hasReverb) {
      const reverbPort =
        (typeof config?.proxy === "object" ? config.proxy.realtime?.port : undefined) ||
        config?.services?.reverb?.port ||
        config?.reverbPort ||
        8080;

      checks.push({
        port: reverbPort,
        domain: (typeof config?.proxy === "object" ? config.proxy.realtime?.domain : undefined) || config?.reverbDomain,
      });
    }

    return checks;
  }

  async rollback(context: DeploymentContext): Promise<void> {
    await this.installDependencies(context);
    await this.build(context);
  }
}
