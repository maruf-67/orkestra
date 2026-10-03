import { describe, it, expect } from "vitest";
import { LaravelProvider } from "../../src/deployment/providers/laravel/provider.js";
import type { DeploymentContext, ApplicationDetection } from "../../src/deployment/providers/types.js";
import type { OrkestraConfig } from "../../src/config/schema.js";

/**
 * End-to-end guard for P0-1.
 *
 * `laravel/provider.ts services()` resolves the Reverb port and puts it in
 * `ServiceDefinition.port`. `pipeline.ts`/`redeploy.ts` previously failed to
 * forward that to `installService`, so the unit template fell back to a
 * hardcoded 8080. These tests assert the value that leaves the provider.
 */

const provider = new LaravelProvider();

const detection: ApplicationDetection = {
  name: "texel/api",
  framework: "laravel",
  version: "^13.8",
  language: "php",
  packageManager: "composer",
  runtime: "php",
  defaultPort: 8000,
  capabilities: {
    hasOctane: true,
    octaneServer: "roadrunner",
    hasReverb: true,
    hasQueue: true,
  },
};

function ctx(config: unknown, projectName = "texel-api"): DeploymentContext {
  return {
    projectDir: "/srv/apps/texel-api",
    projectName,
    branch: "main",
    config: config as OrkestraConfig,
    binaries: { php: "/usr/bin/php", composer: "/usr/bin/composer" } as any,
    options: {} as any,
  };
}

describe("Laravel provider service port resolution", () => {
  it("emits the configured reverb port on the reverb service definition", async () => {
    const services = await provider.services(
      ctx({ reverbPort: 8822, reverbDomain: "reverb.texelbd.com", port: 8022 }),
      detection
    );

    const reverb = services.find((s) => s.type === "reverb");
    expect(reverb).toBeDefined();
    expect(reverb!.port).toBe(8822);
    expect(reverb!.command).toContain("--port=8822");
  });

  it("prefers proxy.realtime.port for the reverb service", async () => {
    const services = await provider.services(
      ctx({
        port: 8022,
        proxy: { api: { domain: "api.texelbd.com", port: 8022 }, realtime: { domain: "reverb.texelbd.com", port: 8822 } },
      }),
      detection
    );

    expect(services.find((s) => s.type === "reverb")!.port).toBe(8822);
  });

  it("prefers services.reverb.port over top-level reverbPort", async () => {
    const services = await provider.services(
      ctx({ port: 8022, reverbPort: 1111, services: { reverb: { port: 8822 } } }),
      detection
    );

    expect(services.find((s) => s.type === "reverb")!.port).toBe(8822);
  });

  it("does not leak the reverb port onto the octane service", async () => {
    const services = await provider.services(ctx({ port: 8022, reverbPort: 8822 }), detection);

    const octane = services.find((s) => s.type === "octane");
    expect(octane!.port).toBe(8022);
    expect(octane!.command).toContain("--port=8022");
    expect(octane!.command).not.toContain("8822");
  });

  it("keeps distinct ports across multiple projects", async () => {
    const picl = await provider.services(ctx({ port: 8007, reverbPort: 8087 }, "picl-api"), detection);
    const digitalLibrary = await provider.services(
      ctx({ port: 8005, reverbPort: 8805 }, "digital-library-api"),
      detection
    );

    expect(picl.find((s) => s.type === "reverb")!.port).toBe(8087);
    expect(digitalLibrary.find((s) => s.type === "reverb")!.port).toBe(8805);
  });
});

describe("Laravel provider systemd tunables", () => {
  it("forwards the octane server and max-requests onto the service definition", async () => {
    const services = await provider.services(
      ctx({ port: 8022, services: { octane: { server: "swoole", maxRequests: 1500 } } }),
      detection
    );

    const octane = services.find((s) => s.type === "octane")!;
    expect(octane.octaneServer).toBe("swoole");
    expect(octane.maxRequests).toBe(1500);
  });

  it("forwards queue tuning onto the queue service definition", async () => {
    const services = await provider.services(
      ctx({
        port: 8022,
        services: {
          queue: { connection: "redis", queues: "high,default", sleep: 5, tries: 2, timeout: 120, maxJobs: 250, maxTime: 1800 },
        },
      }),
      detection
    );

    const queue = services.find((s) => s.type === "queue")!;
    expect(queue.queueConnection).toBe("redis");
    expect(queue.queues).toBe("high,default");
    expect(queue.queueSleep).toBe(5);
    expect(queue.queueTries).toBe(2);
    expect(queue.queueTimeout).toBe(120);
    expect(queue.queueMaxJobs).toBe(250);
    expect(queue.queueMaxTime).toBe(1800);
  });
});

describe("Laravel provider proxy + health consistency", () => {
  it("uses the same reverb port for services, proxy and health checks", async () => {
    const config = {
      port: 8022,
      reverbPort: 8822,
      reverbDomain: "reverb.texelbd.com",
      services: { reverb: { port: 8822 } },
    };

    const services = await provider.services(ctx(config), detection);
    const proxies = await provider.proxy(ctx(config), detection);
    const health = await provider.healthChecks(ctx(config), detection);

    const svcPort = services.find((s) => s.type === "reverb")!.port;
    const proxyEntry = proxies.find((p) => p.websocket);
    const healthEntry = health.find((h) => h.port !== undefined);

    // The three chains used to be independent copies of the same precedence
    // logic, which is how they drifted apart in production.
    expect(proxyEntry!.port).toBe(svcPort);
    expect(healthEntry!.port).toBe(svcPort);
  });

  it("omits the realtime proxy entry when no reverb domain is configured", async () => {
    const proxies = await provider.proxy(ctx({ port: 8022, reverbPort: 8822 }), detection);
    expect(proxies.find((p) => p.websocket)).toBeUndefined();
  });

  it("omits the reverb service entirely when reverb is disabled", async () => {
    const services = await provider.services(
      ctx({ port: 8022, services: { reverb: { enabled: false } } }),
      detection
    );
    expect(services.find((s) => s.type === "reverb")).toBeUndefined();
  });

  it("falls back to the laravel web service when octane is disabled", async () => {
    const services = await provider.services(
      ctx({ port: 8022, services: { octane: { enabled: false } } }),
      detection
    );

    const web = services.find((s) => s.type === "web");
    expect(web).toBeDefined();
    expect(web!.command).toContain("artisan serve");
    expect(web!.command).toContain("--port=8022");
  });
});