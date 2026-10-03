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
import { installComposerDependencies } from "../../composer.js";
import { runLaravelMigrations, ensureStorageLink, optimizeLaravel } from "../../laravel.js";
import { resolvePorts } from "../../ports.js";
import { loadConfig } from "../../../config/loader.js";

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
      // Detect the configured Octane server rather than defaulting blindly.
      // Order: explicit .orkestra.yml config > RoadRunner binary/config >
      // extension availability > roadrunner (Octane's own default).
      let configured: string | undefined;
      try {
        const cfg = await loadConfig(dir);
        configured = cfg?.services?.octane?.server;
      } catch {}
      if (configured === "swoole" || configured === "frankenphp" || configured === "roadrunner") {
        octaneServer = configured;
      } else if (existsSync(join(dir, ".rr.yaml")) || existsSync(join(dir, "rr")) || existsSync(join(dir, "rr.yaml"))) {
        octaneServer = "roadrunner";
      } else if (
        allDeps["laravel/octane-swoole"] ||
        allDeps["openswoole/openswoole"] ||
        allDeps["swoole/swoole"]
      ) {
        octaneServer = "swoole";
      } else if (allDeps["dunglas/frankenphp"] || allDeps["frankenphp/frankenphp"]) {
        octaneServer = "frankenphp";
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

    // Single source of truth for ports — see deployment/ports.ts
    const { apiPort, reverbPort } = resolvePorts(config, {
      projectName: context.projectName,
      defaultApiPort: detection.defaultPort,
    });

    // HTTP Service: Octane (if available/enabled) or standard Laravel web fallback
    const octaneExplicitlyDisabled = config?.services?.octane?.enabled === false;
    const octaneEnabled =
      !octaneExplicitlyDisabled &&
      (config?.services?.octane?.enabled === true ||
       detection.capabilities.hasOctane);

    if (octaneEnabled) {
      // Explicit config wins over detection so `services.octane.server` is
      // honoured even when detection ran against a different config state.
      const detected = detection.capabilities.octaneServer;
      const configured = config?.services?.octane?.server;
      const serverType =
        configured === "swoole" || configured === "frankenphp" || configured === "roadrunner"
          ? configured
          : detected && detected !== "none"
            ? detected
            : "roadrunner";

      services.push({
        name: "octane",
        type: "octane",
        port: apiPort,
        octaneServer: serverType,
        maxRequests: config?.services?.octane?.maxRequests ?? 500,
        command: `${context.binaries.php} artisan octane:start --server=${serverType} --host=127.0.0.1 --port=${apiPort} --no-interaction`,
      });
    } else {
      // Standard Laravel HTTP Web service fallback (artisan serve under systemd)
      services.push({
        name: "web",
        type: "web",
        port: apiPort,
        command: `${context.binaries.php} artisan serve --host=127.0.0.1 --port=${apiPort} --no-interaction`,
      });
    }

    // Queue Worker
    const queueEnabled = config?.services?.queue?.enabled !== false;
    if (queueEnabled) {
      services.push({
        name: "queue",
        type: "queue",
        queueConnection: config?.services?.queue?.connection || "redis",
        queues: config?.services?.queue?.queues || "default",
        queueSleep: config?.services?.queue?.sleep ?? 3,
        queueTries: config?.services?.queue?.tries ?? 3,
        queueTimeout: config?.services?.queue?.timeout ?? 90,
        queueMaxJobs: config?.services?.queue?.maxJobs ?? 500,
        queueMaxTime: config?.services?.queue?.maxTime ?? 3600,
        command: `${context.binaries.php} artisan queue:work --sleep=3 --tries=3 --no-interaction`,
      });
    }

    // Reverb WebSocket
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

    const { apiDomain, apiPort, reverbDomain, reverbPort } = resolvePorts(config, {
      projectName: context.projectName,
      defaultApiPort: detection.defaultPort,
    });

    proxies.push({
      domain: apiDomain,
      port: apiPort,
      ssl: config?.ssl ?? true,
    });

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

    const { apiDomain, reverbDomain, reverbPort } = resolvePorts(config, {
      projectName: context.projectName,
      defaultApiPort: detection.defaultPort,
    });

    if (apiDomain) {
      checks.push({
        apiUrl: `https://${apiDomain}/up`,
        expectedStatus: 200,
        timeoutMs: 5000,
      });
    }

    if (detection.capabilities.hasReverb) {
      checks.push({
        port: reverbPort,
        domain: reverbDomain,
      });
    }

    return checks;
  }

  async rollback(context: DeploymentContext): Promise<void> {
    await this.installDependencies(context);
    await this.build(context);
  }
}
