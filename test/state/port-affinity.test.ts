import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * `findAvailablePort` accepts an optional `forProjectPath`. When supplied, a
 * project may reclaim the port already recorded for it. When omitted, every
 * port in `state.allocatedPorts` is skipped — including the caller's own.
 *
 * Three call sites omit it, which is how a running project gets silently moved
 * to a different port than the one registered for it.
 */

const storeState = vi.hoisted(() => ({
  allocated: [] as number[],
  projects: {} as Record<string, { port: number }>,
}));

vi.mock("../../src/state/store.js", () => ({
  isPortAllocated: async (port: number) => storeState.allocated.includes(port),
  getProject: async (path: string) => storeState.projects[path] ?? null,
}));

const { findAvailablePort } = await import("../../src/state/ports.js");

const PROJECT = "/srv/apps/texel-front";
const OWN_PORT = 3022;

beforeEach(() => {
  storeState.allocated = [OWN_PORT];
  storeState.projects = { [PROJECT]: { port: OWN_PORT } };
});

describe("findAvailablePort project affinity", () => {
  it("reclaims the project's own registered port when given the project path", async () => {
    // What registration.ts does.
    expect(await findAvailablePort(OWN_PORT, PROJECT)).toBe(OWN_PORT);
  });

  it("does NOT reclaim the project's own port when the project path is omitted", async () => {
    // What health.ts, up.ts and start.ts do: the project's own registered port
    // is treated as taken by someone else and a different port is handed back.
    const chosen = await findAvailablePort(OWN_PORT);
    expect(chosen).not.toBe(OWN_PORT);
  });

  it("documents the drift so the omission cannot be reintroduced silently", async () => {
    const withoutPath = await findAvailablePort(OWN_PORT);
    const withPath = await findAvailablePort(OWN_PORT, PROJECT);

    // Both the state record and the OS are free on OWN_PORT, so the only thing
    // separating the two results is the missing argument.
    expect(withoutPath).not.toBe(withPath);
  });

  it("still skips a port genuinely allocated to another project", async () => {
    storeState.allocated = [3022, 3023];
    storeState.projects = { [PROJECT]: { port: 3022 } };

    const chosen = await findAvailablePort(3022, PROJECT);
    expect(chosen).toBe(3022);

    // From another project's perspective 3022 is unavailable.
    const other = await findAvailablePort(3022, "/srv/apps/other");
    expect(other).not.toBe(3022);
    expect(other).not.toBe(3023);
  });
});