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

  it("rejects only values outside the TCP range", () => {
    const cfg = { port: 70000, reverbPort: 0 } as unknown as OrkestraConfig;
    const r = resolvePorts(cfg, { projectName: "app" });
    expect(r.apiPort).toBe(DEFAULT_API_PORT);
    expect(r.reverbPort).toBe(DEFAULT_REVERB_PORT);
  });

  it("honours a privileged port instead of silently substituting a default", () => {
    // Regression: the range used to start at 1024, so an explicit `port: 443`
    // was discarded and replaced with 8000. Silently ignoring a value the
    // operator asked for is the exact failure this resolver exists to prevent.
    expect(resolvePorts({ port: 443 } as OrkestraConfig).apiPort).toBe(443);
    expect(resolvePorts({ port: 80 } as OrkestraConfig).apiPort).toBe(80);
    expect(resolvePorts({ reverbPort: 443 } as OrkestraConfig).reverbPort).toBe(443);
  });

  it("ignores non-integer and negative values", () => {
    const cfg = { port: -1, reverbPort: 80.5 } as unknown as OrkestraConfig;
    const r = resolvePorts(cfg, { projectName: "app" });
    expect(r.apiPort).toBe(DEFAULT_API_PORT);
    expect(r.reverbPort).toBe(DEFAULT_REVERB_PORT);
  });

  it("accepts the boundary values 1 and 65535", () => {
    expect(resolvePorts({ port: 65535 } as OrkestraConfig).apiPort).toBe(65535);
    expect(resolvePorts({ port: 1 } as OrkestraConfig).apiPort).toBe(1);
  });

  it("never lets the API domain fall back to the Reverb domain", () => {
    // Regression: the API chain ended with `services.reverb.domain`, so a config
    // that only declared a realtime domain served the public API from the
    // WebSocket host.
    const r = resolvePorts({
      services: { reverb: { domain: "reverb.example.com" } },
    } as OrkestraConfig, { projectName: "api" });

    expect(r.apiDomain).toBe("api.dev.com");
    expect(r.apiDomain).not.toBe("reverb.example.com");
    // The Reverb endpoint still gets its own domain.
    expect(r.reverbDomain).toBe("reverb.example.com");
  });
});

describe("freezeAgainstState does not mutate its input", () => {
  it("leaves the caller's nested config untouched", () => {
    const config: any = {
      name: "texel-api",
      port: 8022,
      domain: "old.example.com",
      services: { reverb: { port: 8822, domain: "reverb.old.example.com" } },
      proxy: {
        provider: "caddy",
        api: { domain: "old.example.com", port: 8022 },
        realtime: { domain: "reverb.old.example.com", port: 8822 },
      },
    };
    const before = JSON.stringify(config);

    const frozen: any = freezeAgainstState(config, {
      domain: "api.texelbd.com",
      port: 8022,
      reverbPort: 8822,
      reverbDomain: "reverb.texelbd.com",
    } as any);

    // The caller's object must be byte-identical afterwards.
    expect(JSON.stringify(config)).toBe(before);

    // ...while the returned copy carries the frozen deploy values.
    expect(frozen.domain).toBe("api.texelbd.com");
    expect(frozen.services.reverb.domain).toBe("reverb.texelbd.com");
    expect(frozen.proxy.api.domain).toBe("api.texelbd.com");
    expect(frozen.proxy.realtime.domain).toBe("reverb.texelbd.com");
  });

  it("passes the config through untouched when there is no state to freeze", () => {
    // Nothing is written in this path, so returning the same reference is fine;
    // what matters is that no mutation occurs.
    const config: any = { name: "a", port: 8022, services: { reverb: { port: 8822 } } };
    const before = JSON.stringify(config);

    const frozen: any = freezeAgainstState(config, null as any);

    expect(JSON.stringify(frozen)).toBe(before);
    expect(JSON.stringify(config)).toBe(before);
  });

  it("survives repeated freezes without accumulating drift", () => {
    const config: any = { name: "a", services: { reverb: { port: 8822 } } };
    const state: any = { domain: "api.texelbd.com", port: 8022, reverbPort: 8822 };

    const first: any = freezeAgainstState(config, state);
    const second: any = freezeAgainstState(first, state);
    const third: any = freezeAgainstState(second, state);

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(JSON.stringify(second)).toBe(JSON.stringify(third));
  });

  it("does not mutate when state carries no usable values", () => {
    const config: any = {
      name: "a",
      domain: "keep.example.com",
      services: { reverb: { port: 8822 } },
    };
    const before = JSON.stringify(config);

    freezeAgainstState(config, {} as any);

    expect(JSON.stringify(config)).toBe(before);
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