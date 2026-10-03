import { describe, it, expect } from "vitest";
import { NuxtProvider } from "../../src/deployment/providers/nuxt/provider.js";
import { NextjsProvider } from "../../src/deployment/providers/nextjs/provider.js";
import type { DeploymentContext, ApplicationDetection } from "../../src/deployment/providers/types.js";
import type { OrkestraConfig } from "../../src/config/schema.js";

/**
 * Guards that the Node providers use the shared resolution chain, so a
 * Next/Nuxt deployment cannot drift from the Laravel path.
 */

const nuxtDetection: ApplicationDetection = {
  name: "texel-front",
  framework: "nuxt",
  language: "typescript",
  packageManager: "pnpm",
  runtime: "node",
  defaultPort: 3000,
  capabilities: {},
};

const nextDetection: ApplicationDetection = {
  name: "texel-admin",
  framework: "next.js",
  language: "typescript",
  packageManager: "pnpm",
  runtime: "node",
  defaultPort: 3000,
  capabilities: {},
};

function ctx(config: unknown, projectName: string): DeploymentContext {
  return {
    projectDir: `/srv/apps/${projectName}`,
    projectName,
    branch: "main",
    config: config as OrkestraConfig,
    binaries: { node: "/usr/bin/node", bun: "/usr/bin/bun" } as any,
    options: {} as any,
  };
}

describe("Nuxt provider port resolution", () => {
  const provider = new NuxtProvider();

  it("uses the configured port for both service and proxy", async () => {
    const config = { port: 3022, domain: "texelbd.com" };
    const services = await provider.services(ctx(config, "texel-front"), nuxtDetection);
    const proxies = await provider.proxy(ctx(config, "texel-front"), nuxtDetection);

    expect(services[0].port).toBe(3022);
    expect(proxies[0].port).toBe(3022);
    expect(proxies[0].domain).toBe("texelbd.com");
  });

  it("prefers proxy.api over the top-level port", async () => {
    const config = { port: 3000, proxy: { api: { domain: "app.example.com", port: 3022 } } };
    const services = await provider.services(ctx(config, "texel-front"), nuxtDetection);
    expect(services[0].port).toBe(3022);
  });

  it("defaults to 3000 when nothing is configured", async () => {
    const services = await provider.services(ctx({}, "texel-front"), nuxtDetection);
    expect(services[0].port).toBe(3000);
  });

  it("passes the port to Nitro via env, not the command string", async () => {
    // Nitro reads PORT from the environment; the systemd web template renders
    // Environment=PORT={{PORT}} from the same resolved value.
    const services = await provider.services(ctx({ port: 3022 }, "texel-front"), nuxtDetection);
    expect(services[0].env?.PORT).toBe("3022");
    expect(services[0].env?.HOST).toBe("127.0.0.1");
    expect(services[0].env?.NODE_ENV).toBe("production");
  });
});

describe("Next.js provider port resolution", () => {
  const provider = new NextjsProvider();

  it("uses the configured port for both service and proxy", async () => {
    const config = { port: 3023, domain: "admin.texelbd.com" };
    const services = await provider.services(ctx(config, "texel-admin"), nextDetection);
    const proxies = await provider.proxy(ctx(config, "texel-admin"), nextDetection);

    expect(services[0].port).toBe(3023);
    expect(proxies[0].port).toBe(3023);
    expect(proxies[0].domain).toBe("admin.texelbd.com");
  });

  it("prefers proxy.api over the top-level port", async () => {
    const config = { port: 3000, proxy: { api: { domain: "admin.example.com", port: 3023 } } };
    const services = await provider.services(ctx(config, "texel-admin"), nextDetection);
    expect(services[0].port).toBe(3023);
  });

  it("emits the port in the next start command", async () => {
    const services = await provider.services(ctx({ port: 3023 }, "texel-admin"), nextDetection);
    expect(services[0].command).toContain("--port 3023");
  });
});