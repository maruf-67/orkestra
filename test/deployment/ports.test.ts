import { describe, it, expect } from "vitest";
import { resolvePorts, freezeAgainstState, DEFAULT_API_PORT, DEFAULT_REVERB_PORT } from "../../src/deployment/ports.js";
import type { OrkestraConfig } from "../../src/config/schema.js";
import type { ProjectState } from "../../src/state/store.js";

function state(overrides: Partial<ProjectState> = {}): ProjectState {
  return {
    name: "texel-api",
    domain: "api.texelbd.com",
    port: 8022,
    framework: "laravel",
    proxy: "caddy",
    path: "/srv/apps/texel-api",
    registeredAt: "2026-10-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("resolvePorts precedence", () => {
  it("falls back to framework defaults when nothing is configured", () => {
    const r = resolvePorts(null, { projectName: "app" });
    expect(r.apiPort).toBe(DEFAULT_API_PORT);
    expect(r.reverbPort).toBe(DEFAULT_REVERB_PORT);
    expect(r.apiDomain).toBe("app.dev.com");
  });

  it("prefers proxy.api over services.octane and top-level port", () => {
    const cfg = {
      port: 3000,
      services: { octane: { port: 4000 } },
      proxy: { api: { domain: "api.example.com", port: 5000 } },
    } as unknown as OrkestraConfig;

    const r = resolvePorts(cfg, { projectName: "app" });
    expect(r.apiPort).toBe(5000);
    expect(r.apiDomain).toBe("api.example.com");
  });

  it("prefers services.reverb over top-level reverbPort", () => {
    const cfg = {
      reverbPort: 1111,
      services: { reverb: { port: 2222 } },
    } as unknown as OrkestraConfig;

    expect(resolvePorts(cfg, { projectName: "app" }).reverbPort).toBe(2222);
  });

  it("uses top-level reverbPort when no structured override exists", () => {
    const cfg = { reverbPort: 8822 } as unknown as OrkestraConfig;
    expect(resolvePorts(cfg, { projectName: "app" }).reverbPort).toBe(8822);
  });

  it("ignores out-of-range ports instead of propagating them", () => {
    const cfg = { reverbPort: 80, port: 70000 } as unknown as OrkestraConfig;
    const r = resolvePorts(cfg, { projectName: "app" });
    expect(r.reverbPort).toBe(DEFAULT_REVERB_PORT);
    expect(r.apiPort).toBe(DEFAULT_API_PORT);
  });
});

/**
 * Regression guard for P0-1: `deploy` runs `git reset --hard origin/<branch>`,
 * which reverts .orkestra.yml to a repository default. The deployed port in
 * state.json is authoritative and must always win.
 */
describe("deployed state wins over reverted config", () => {
  it("keeps the deployed reverb port when config reverts to 8080", () => {
    const reverted = {
      reverbPort: 8080,
      services: { reverb: { port: 8080 } },
    } as unknown as OrkestraConfig;

    const r = resolvePorts(reverted, {
      state: state({ reverbPort: 8822, reverbDomain: "reverb.texelbd.com" }),
      projectName: "texel-api",
    });

    expect(r.reverbPort).toBe(8822);
    expect(r.reverbDomain).toBe("reverb.texelbd.com");
  });

  it("keeps the deployed api port when config reverts to a different port", () => {
    const reverted = { port: 8000, domain: "texel-api.almaruf67.com" } as unknown as OrkestraConfig;

    const r = resolvePorts(reverted, { state: state(), projectName: "texel-api" });

    expect(r.apiPort).toBe(8022);
    expect(r.apiDomain).toBe("api.texelbd.com");
  });

  it("state overrides a structured proxy endpoint too", () => {
    const reverted = {
      proxy: { api: { domain: "old.example.com", port: 9999 }, realtime: { domain: "ws.old.example.com", port: 7000 } },
    } as unknown as OrkestraConfig;

    const r = resolvePorts(reverted, {
      state: state({ reverbPort: 8822, reverbDomain: "reverb.texelbd.com" }),
      projectName: "texel-api",
    });

    expect(r.apiPort).toBe(8022);
    expect(r.apiDomain).toBe("api.texelbd.com");
    expect(r.reverbPort).toBe(8822);
    expect(r.reverbDomain).toBe("reverb.texelbd.com");
  });

  it("falls back to config when state has no reverb recorded", () => {
    const cfg = { reverbPort: 8805 } as unknown as OrkestraConfig;
    const r = resolvePorts(cfg, { state: state(), projectName: "texel-api" });
    expect(r.reverbPort).toBe(8805);
  });
});

describe("freezeAgainstState", () => {
  it("does not mutate the input config", () => {
    const cfg = { port: 8000, reverbPort: 8080 } as unknown as OrkestraConfig;
    const before = JSON.stringify(cfg);

    freezeAgainstState(cfg, state({ port: 8022, reverbPort: 8822 }));

    expect(JSON.stringify(cfg)).toBe(before);
  });

  it("writes frozen values into both structured and flat fields", () => {
    const cfg = {
      port: 8000,
      proxy: { api: { domain: "old.com", port: 8000 }, realtime: { domain: "ws.old.com", port: 8080 } },
    } as unknown as OrkestraConfig;

    const merged = freezeAgainstState(cfg, state({ reverbPort: 8822, reverbDomain: "reverb.texelbd.com" }))!;

    expect(merged.port).toBe(8022);
    expect(merged.domain).toBe("api.texelbd.com");
    expect(merged.reverbPort).toBe(8822);

    const proxy = merged.proxy as any;
    expect(proxy.api.port).toBe(8022);
    expect(proxy.api.domain).toBe("api.texelbd.com");
    expect(proxy.realtime.port).toBe(8822);
    expect(proxy.realtime.domain).toBe("reverb.texelbd.com");
  });

  it("propagates reverb port into services.reverb so providers agree", () => {
    const cfg = { services: { reverb: { port: 8080 } } } as unknown as OrkestraConfig;
    const merged = freezeAgainstState(cfg, state({ reverbPort: 8822 }))!;
    expect(merged.services?.reverb?.port).toBe(8822);
  });

  it("returns config unchanged when there is no state", () => {
    const cfg = { port: 3000 } as unknown as OrkestraConfig;
    expect(freezeAgainstState(cfg, null)).toBe(cfg);
  });
});