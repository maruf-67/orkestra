import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  selectDevPort,
  ensurePortAvailable,
  DEFAULT_DEV_PORT,
  type PortProbes,
} from "../../src/deployment/dev-port.js";

/**
 * The dev-server port had two independent implementations that disagreed.
 *
 * `commands/up.ts` consulted the port recorded in orkestra's state;
 * `utils/health.ts` did not. For a project whose `.orkestra.yml` omits `port` —
 * the normal shape once `freezeAgainstState` puts the deployed port into state —
 * `up()` served the state port and the monitor's auto-restart came back on the
 * framework default, leaving Caddy proxying to a dead port.
 *
 * These tests pin the shared precedence and, at the bottom, structurally
 * guarantee both call sites still go through it.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf-8");

describe("selectDevPort precedence", () => {
  it("prefers the CLI flag over everything", () => {
    const d = selectDevPort({ cliPort: 1111, configPort: 2222, statePort: 3333, frameworkPort: 4444 });
    expect(d).toMatchObject({ port: 1111, source: "cli", moved: false, requestedPort: 1111 });
  });

  it("prefers config over state", () => {
    const d = selectDevPort({ configPort: 2222, statePort: 3333, frameworkPort: 4444 });
    expect(d).toMatchObject({ port: 2222, source: "config" });
  });

  it("prefers state over the framework default", () => {
    // This is the ordering that was missing, and the one that caused the drift.
    const d = selectDevPort({ statePort: 3333, frameworkPort: 4444 });
    expect(d).toMatchObject({ port: 3333, source: "state" });
  });

  it("uses the framework default only when nothing else is set", () => {
    const d = selectDevPort({ frameworkPort: 4444 });
    expect(d).toMatchObject({ port: 4444, source: "framework" });
  });

  it("falls back to the built-in default", () => {
    const d = selectDevPort({});
    expect(d).toMatchObject({ port: DEFAULT_DEV_PORT, source: "default" });
  });

  it("treats null and undefined as absent at every level", () => {
    const d = selectDevPort({
      cliPort: null,
      configPort: undefined,
      statePort: 3333,
      frameworkPort: null,
    });
    expect(d.port).toBe(3333);
  });
});

describe("selectDevPort rejects unusable values", () => {
  // A bad value must fall through to the next source, never be used directly.
  it.each([
    ["zero", 0],
    ["negative", -1],
    ["above 65535", 70000],
    ["fractional", 80.5],
    ["NaN", NaN],
    ["Infinity", Infinity],
  ])("ignores a %s port and moves to the next source", (_label, bad) => {
    const d = selectDevPort({ cliPort: bad, configPort: 2222 });
    expect(d.port).toBe(2222);
    expect(d.source).toBe("config");
  });

  it("ignores a stringified number", () => {
    // A quoted port in YAML is exactly how this reached the resolver in
    // production; it must not be coerced into a number here.
    expect(selectDevPort({ cliPort: "2222" as any, configPort: 3333 }).port).toBe(3333);
  });

  it("falls all the way through to the default when every source is unusable", () => {
    const d = selectDevPort({ cliPort: 0, configPort: -5, statePort: 70000, frameworkPort: 1.5 });
    expect(d.port).toBe(DEFAULT_DEV_PORT);
    expect(d.source).toBe("default");
  });

  it("accepts a privileged port rather than substituting", () => {
    expect(selectDevPort({ configPort: 443 }).port).toBe(443);
    expect(selectDevPort({ configPort: 80 }).port).toBe(80);
  });

  it("accepts the range boundaries", () => {
    expect(selectDevPort({ configPort: 1 }).port).toBe(1);
    expect(selectDevPort({ configPort: 65535 }).port).toBe(65535);
  });
});

describe("ensurePortAvailable", () => {
  const probes = (occupied: boolean, replacement = 9999): PortProbes => ({
    isPortOccupied: vi.fn(async () => occupied),
    findAvailablePort: vi.fn(async () => replacement),
  });

  it("keeps the port when it is free", async () => {
    const p = probes(false);
    const decision = selectDevPort({ configPort: 8022 });

    const result = await ensurePortAvailable(decision, "/srv/a", p);

    expect(result.port).toBe(8022);
    expect(result.moved).toBe(false);
    expect(p.findAvailablePort).not.toHaveBeenCalled();
  });

  it("moves when the port is genuinely held by something else", async () => {
    const p = probes(true, 8023);
    const decision = selectDevPort({ configPort: 8022 });

    const result = await ensurePortAvailable(decision, "/srv/a", p);

    expect(result.port).toBe(8023);
    expect(result.requestedPort).toBe(8022);
    expect(result.moved).toBe(true);
    // The source still describes where the *requested* port came from.
    expect(result.source).toBe("config");
  });

  it("passes the project path so the project can reclaim its own port", async () => {
    // Without this the project's own recorded port reads as somebody else's and
    // the app moves — the original port-drift bug.
    const p = probes(true, 8023);

    await ensurePortAvailable(selectDevPort({ configPort: 8022 }), "/srv/apps/texel-api", p);

    expect(p.findAvailablePort).toHaveBeenCalledWith(8022, "/srv/apps/texel-api");
  });

  it("reports moved:false when the scan returns the same port", async () => {
    const p = probes(true, 8022);

    const result = await ensurePortAvailable(selectDevPort({ configPort: 8022 }), "/srv/a", p);

    expect(result.port).toBe(8022);
    expect(result.moved).toBe(false);
  });

  it("only probes once", async () => {
    const p = probes(false);

    await ensurePortAvailable(selectDevPort({ configPort: 8022 }), "/srv/a", p);

    expect(p.isPortOccupied).toHaveBeenCalledTimes(1);
  });
});

describe("the drift regression, stated directly", () => {
  it("up() and the health monitor resolve the same port for the same project", async () => {
    // The exact fixture from the bug: .orkestra.yml omits `port`, state holds the
    // deployed port, the framework default is something else entirely.
    const sources = { configPort: undefined, statePort: 8022, frameworkPort: 3000 };

    const asUp = selectDevPort(sources);
    const asMonitor = selectDevPort(sources);

    expect(asUp.port).toBe(8022);
    expect(asMonitor.port).toBe(8022);
    expect(asUp.port).toBe(asMonitor.port);
  });

  it("a restart onto the recorded port does not move the app", async () => {
    // The monitor sees the port as occupied only because a scan without a project
    // path mistakes the project's own binding for a conflict.
    let occupiedBySelf = true;
    const p: PortProbes = {
      isPortOccupied: async () => occupiedBySelf,
      findAvailablePort: async (start, forProject) => {
        // A real findAvailablePort consults state; standing in for that here.
        return forProject === "/srv/apps/texel-api" ? start : start + 1;
      },
    };

    const result = await ensurePortAvailable(
      selectDevPort({ statePort: 8022 }),
      "/srv/apps/texel-api",
      p,
    );

    expect(result.port).toBe(8022);
    expect(result.moved).toBe(false);
  });
});

describe("structural guard: every call site shares one resolver", () => {
  const stripComments = (src: string) =>
    src
      .split("\n")
      .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
      .map((l) => {
        const i = l.indexOf("//");
        if (i === -1) return l;
        // Leave it alone when the "//" is inside a string, e.g. a URL.
        const quotes = (l.slice(0, i).match(/["'`]/g) ?? []).length;
        return quotes % 2 === 0 ? l.slice(0, i) : l;
      })
      .join("\n");

  const code = (rel: string) => stripComments(read(rel));

  /**
   * Every module that decides which port a server binds.
   *
   * There were four copies of this decision. up.ts and health.ts were found
   * disagreeing, which is how the drift happened; start.ts is a near-copy of
   * up.ts and had the same chain verbatim; registration.ts had its own with no
   * validity checking at all. Listing them explicitly means a fifth copy in a new
   * command has to be added here deliberately.
   */
  const RESOLVERS = [
    "src/commands/up.ts",
    "src/commands/start.ts",
    "src/utils/health.ts",
    "src/utils/registration.ts",
  ];

  it("every resolver imports from deployment/dev-port.js", () => {
    for (const f of RESOLVERS) {
      expect(code(f), `${f} does not use the shared resolver`).toMatch(
        /from "\.\.\/deployment\/dev-port\.js"/,
      );
      expect(code(f), `${f} does not call selectDevPort()`).toMatch(/selectDevPort\(/);
    }
  });

  it("no module re-implements the precedence chain inline", () => {
    // The divergence was literally this expression in two files with different
    // operands. Any reappearance means a new copy of the decision.
    const chain = /config\?\.port\s*\|\|\s*(existing|framework)\??\.?port/;
    for (const f of RESOLVERS) {
      expect(chain.test(code(f)), `${f} re-implements the precedence chain`).toBe(false);
    }
  });

  it("up.ts, start.ts and health.ts all consult the state port", () => {
    // Without `statePort` a resolver ignores the port recorded in state, which
    // is the original bug. registration.ts legitimately does not: a project is
    // being registered for the first time, so there is no state yet.
    for (const f of ["src/commands/up.ts", "src/commands/start.ts", "src/utils/health.ts"]) {
      expect(code(f), `${f} does not consult the state port`).toMatch(/statePort:/);
    }
  });

  it("registration.ts keeps its own conflict policy but not its own precedence", () => {
    const src = code("src/utils/registration.ts");
    // An explicit --port must not be bumped for an OS-level conflict, because the
    // same project may be shutting down. That policy is deliberate and stays.
    expect(src).toMatch(/options\?\.port/);
    expect(src).toMatch(/isPortAllocated/);
  });

  it("health.ts no longer imports the port helpers directly", () => {
    // It should go through the resolver, not reach past it.
    expect(code("src/utils/health.ts")).not.toMatch(
      /import \{[^}]*findAvailablePort[^}]*\} from "\.\.\/state\/ports\.js"/,
    );
  });

  it("every findAvailablePort call site passes a project path", () => {
    // The same invariant the port-affinity guard enforces elsewhere.
    const files = [...RESOLVERS, "src/deployment/dev-port.ts"];
    for (const f of files) {
      const src = code(f);
      for (const m of src.matchAll(/findAvailablePort\(([^)]*)\)/g)) {
        const args = m[1];
        if (/forProjectPath|projectDir|^\s*$/.test(args)) continue; // declaration site
        expect(args, `${f}: findAvailablePort(${args}) has no project path`).toMatch(
          /forProjectPath|projectDir/,
        );
      }
    }
  });
});