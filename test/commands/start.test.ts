import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * `orkestra start` — production mode (build + start).
 *
 * A near-copy of `up.ts`, and it carried its own copy of the port precedence
 * chain verbatim. That is how `up.ts` and the health monitor came to disagree
 * about which port a project was on, so this file had the same latent drift
 * waiting to happen. It now shares deployment/dev-port.ts.
 *
 * Real timers, real package.json; only process spawning, the store, the port
 * probes and the proxy are mocked.
 */

const h = vi.hoisted(() => ({
  spawn: vi.fn(),
  execSync: vi.fn(),
  getProject: vi.fn(),
  listProjects: vi.fn(),
  setProjectRunning: vi.fn(),
  updateProjectPort: vi.fn(),
  isProcessAlive: vi.fn(),
  isPortAllocated: vi.fn(),
  loadConfig: vi.fn(),
  detectFramework: vi.fn(),
  isPortOccupied: vi.fn(),
  findAvailablePort: vi.fn(),
  registerProjectAuto: vi.fn(),
  writeLog: vi.fn(),
  getLogPath: vi.fn(),
  startMonitoring: vi.fn(),
  detectProxy: vi.fn(),
  proxyUnregister: vi.fn(),
  proxyRegister: vi.fn(),
  isCommandAvailable: vi.fn(),
  execFileSync: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  spawn: h.spawn,
  execSync: h.execSync,
  execFileSync: h.execFileSync,
}));
vi.mock("../../src/state/store.js", () => ({
  getProject: h.getProject,
  listProjects: h.listProjects,
  setProjectRunning: h.setProjectRunning,
  updateProjectPort: h.updateProjectPort,
  isProcessAlive: h.isProcessAlive,
  isPortAllocated: h.isPortAllocated,
}));
vi.mock("../../src/config/loader.js", () => ({ loadConfig: h.loadConfig }));
vi.mock("../../src/detection/framework.js", () => ({ detectFramework: h.detectFramework }));
vi.mock("../../src/state/ports.js", () => ({
  isPortOccupied: h.isPortOccupied,
  findAvailablePort: h.findAvailablePort,
}));
vi.mock("../../src/utils/registration.js", () => ({ registerProjectAuto: h.registerProjectAuto }));
vi.mock("../../src/utils/logger-file.js", () => ({
  writeLog: h.writeLog,
  getLogPath: h.getLogPath,
}));
vi.mock("../../src/utils/health.js", () => ({
  healthMonitor: { startMonitoring: h.startMonitoring, stopMonitoring: vi.fn(), stopAll: vi.fn() },
}));
vi.mock("../../src/detection/proxy.js", () => ({ detectProxy: h.detectProxy }));
vi.mock("../../src/utils/exec.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/utils/exec.js")>();
  return { ...actual, isCommandAvailable: h.isCommandAvailable };
});
vi.mock("../../src/utils/logger.js", () => ({
  log: { plain: vi.fn(), info: vi.fn(), dim: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn() },
  heading: vi.fn(),
  spinner: () => ({ start: vi.fn(), stop: vi.fn(), succeed: vi.fn(), fail: vi.fn() }),
}));

const { start } = await import("../../src/commands/start.js");

let dir: string;
let exitSpy: ReturnType<typeof vi.spyOn>;

const CHILD_PID = 24680;

function fakeChild() {
  return { pid: CHILD_PID, unref: vi.fn(), stdout: { on: vi.fn() }, stderr: { on: vi.fn() }, on: vi.fn() };
}

const spawnEnv = () => h.spawn.mock.calls[0][2].env as Record<string, string>;
const spawnOpts = () => h.spawn.mock.calls[0][2] as Record<string, any>;
const spawnCmd = () => h.spawn.mock.calls[0][0] as string;

class ExitCalled extends Error {
  constructor(public code: number) {
    super(`process.exit(${code})`);
  }
}

beforeEach(async () => {
  vi.clearAllMocks();

  dir = await mkdtemp(join(tmpdir(), "ork-start-"));
  await writeFile(
    join(dir, "package.json"),
    JSON.stringify({ name: "texel-api", scripts: { start: "next start" } }),
    "utf-8",
  );

  h.getProject.mockResolvedValue({
    name: "texel-api", path: dir, domain: "api.texelbd.com",
    port: 8022, framework: "next.js",
  });
  h.listProjects.mockResolvedValue([]);
  h.loadConfig.mockResolvedValue({ name: "texel-api", domain: "api.texelbd.com" });
  h.detectFramework.mockResolvedValue({ name: "next.js", version: "15", port: 3000 });
  h.isProcessAlive.mockResolvedValue(false);
  h.isPortOccupied.mockResolvedValue(false);
  h.findAvailablePort.mockResolvedValue(8023);
  h.spawn.mockImplementation(() => fakeChild());
  h.setProjectRunning.mockResolvedValue(undefined);
  h.updateProjectPort.mockResolvedValue(undefined);
  h.startMonitoring.mockImplementation(() => {});
  h.getLogPath.mockReturnValue(join(dir, ".orkestra", "texel-api.log"));
  h.isCommandAvailable.mockImplementation(async (c: string) => c === "npx" || c === "mise");
  h.detectProxy.mockResolvedValue({ unregister: h.proxyUnregister, register: h.proxyRegister });
  h.proxyUnregister.mockResolvedValue(undefined);
  h.proxyRegister.mockResolvedValue(undefined);
  h.execSync.mockReturnValue("");
  h.execFileSync.mockReturnValue("");

  exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    throw new ExitCalled(code ?? 0);
  }) as never);
});

afterEach(async () => {
  exitSpy.mockRestore();
  await rm(dir, { recursive: true, force: true }).catch(() => {});
});

describe("which port start() binds", () => {
  it("uses the state port when config omits one", async () => {
    // The latent drift: this command resolved `options.port || config?.port ||
    // existing?.port || config?.port || framework.port`, so it agreed with up.ts
    // by luck rather than by construction.
    await start({ dir });

    expect(spawnEnv().PORT).toBe("8022");
    expect(spawnEnv().PORT).not.toBe("3000");
  });

  it("honours --port above everything", async () => {
    await start({ dir, port: 9999 });

    expect(spawnEnv().PORT).toBe("9999");
  });

  it("lets config outrank state", async () => {
    h.loadConfig.mockResolvedValue({ name: "texel-api", port: 7000, startCommand: "next start" });

    await start({ dir });

    expect(spawnEnv().PORT).toBe("7000");
  });

  it("exports the port as both PORT and SERVER_PORT", async () => {
    await start({ dir });

    expect(spawnEnv().PORT).toBe("8022");
    expect(spawnEnv().SERVER_PORT).toBe("8022");
  });
});

describe("port conflict", () => {
  beforeEach(() => {
    h.isPortOccupied.mockResolvedValue(true);
    h.findAvailablePort.mockResolvedValue(8023);
  });

  it("moves and passes the project path so it can reclaim its own port", async () => {
    await start({ dir });

    expect(h.findAvailablePort).toHaveBeenCalledWith(8022, dir);
    expect(spawnEnv().PORT).toBe("8023");
  });

  it("re-points the proxy and persists the new port", async () => {
    h.loadConfig.mockResolvedValue({
      name: "texel-api", proxy: { provider: "caddy" }, startCommand: "next start",
    });

    await start({ dir });

    expect(h.proxyUnregister).toHaveBeenCalledWith("api.texelbd.com");
    expect(h.proxyRegister).toHaveBeenCalledWith(
      expect.objectContaining({ port: 8023 }),
    );
    expect(h.updateProjectPort).toHaveBeenCalledWith(dir, 8023);
  });

  it("leaves proxy and state alone when there is no conflict", async () => {
    h.isPortOccupied.mockResolvedValue(false);
    h.proxyUnregister.mockClear();
    h.updateProjectPort.mockClear();

    await start({ dir });

    expect(h.proxyUnregister).not.toHaveBeenCalled();
    expect(h.updateProjectPort).not.toHaveBeenCalled();
  });
});

describe("production command", () => {
  it("prefers the package.json start script", async () => {
    await start({ dir });

    expect(h.spawn).toHaveBeenCalled();
    expect(spawnCmd()).toBe("npx");
    expect(h.spawn.mock.calls[0][1]).toEqual(["--yes", "next", "start"]);
  });

  it("lets startCommand override it", async () => {
    h.loadConfig.mockResolvedValue({ name: "texel-api", startCommand: "node server.js" });
    h.isCommandAvailable.mockImplementation(async (c: string) => c === "node" || c === "mise");

    await start({ dir });

    // node is not a bare framework binary, so it is not npx-wrapped.
    expect(spawnCmd()).toBe("node");
    expect(h.spawn.mock.calls[0][1]).toEqual(["server.js"]);
  });

  it("exits when there is no production command", async () => {
    h.detectFramework.mockResolvedValue({ name: "cobol", version: "1", port: 3000 });
    h.loadConfig.mockResolvedValue({ name: "texel-api" });

    await expect(start({ dir })).rejects.toThrow(ExitCalled);
    expect(h.spawn).not.toHaveBeenCalled();
  });

  it("exits when the framework cannot be detected", async () => {
    h.detectFramework.mockResolvedValue(null);

    await expect(start({ dir })).rejects.toThrow(ExitCalled);
    expect(h.spawn).not.toHaveBeenCalled();
  });
});

describe("build step", () => {
  it("runs the build through execFileSync argv before starting", async () => {
    await writeFile(join(dir, "bun.lockb"), "", "utf-8");
    h.isCommandAvailable.mockImplementation(async (c: string) => c === "bun" || c === "mise");

    await start({ dir, build: true });

    // argv, not a concatenated string. execSync would hand this to a shell,
    // which is the pattern removed from run() in 1.0.10.
    expect(h.execFileSync).toHaveBeenCalledWith(
      "bun",
      ["run", "build"],
      expect.objectContaining({ cwd: dir }),
    );
    expect(h.spawn).toHaveBeenCalled();
  });

  it("passes the resolved port into the build environment", async () => {
    await writeFile(join(dir, "bun.lockb"), "", "utf-8");
    h.isCommandAvailable.mockImplementation(async (c: string) => c === "bun" || c === "mise");

    await start({ dir, build: true });

    const env = h.execFileSync.mock.calls[0][2].env as Record<string, string>;
    expect(env.PORT).toBe("8022");
    expect(env.SERVER_PORT).toBe("8022");
  });

  it("falls back to npm when no lockfile identifies a package manager", async () => {
    // No lockfile: the build falls back to npm while the server still runs via
    // npx, and up() checks availability for the command it is about to spawn.
    h.isCommandAvailable.mockImplementation(
      async (c: string) => c === "npm" || c === "npx" || c === "mise",
    );

    await start({ dir, build: true });

    expect(h.execFileSync.mock.calls[0][0]).toBe("npm");
  });

  it("skips the build by default", async () => {
    await start({ dir });

    expect(h.execFileSync).not.toHaveBeenCalled();
    expect(h.spawn).toHaveBeenCalled();
  });
});

describe("process state", () => {
  it("records the pid and starts monitoring", async () => {
    await start({ dir });

    expect(h.setProjectRunning).toHaveBeenCalledWith(dir, CHILD_PID);
    expect(h.startMonitoring).toHaveBeenCalledWith(dir);
  });

  it("runs attached in foreground mode with no monitoring", async () => {
    const child = fakeChild();
    h.spawn.mockImplementation(() => child);

    await start({ dir, foreground: true });

    expect(spawnOpts().detached).toBe(false);
    expect(child.unref).not.toHaveBeenCalled();
    expect(h.startMonitoring).not.toHaveBeenCalled();
  });

  it("returns without spawning when already running", async () => {
    h.getProject.mockResolvedValue({
      name: "texel-api", path: dir, domain: "api.texelbd.com",
      port: 8022, framework: "next.js", pid: 999,
    });
    h.isProcessAlive.mockResolvedValue(true);

    await start({ dir });

    expect(h.spawn).not.toHaveBeenCalled();
  });
});

describe("auto-registration", () => {
  it("registers an unknown project and uses the chosen port", async () => {
    h.getProject.mockResolvedValue(null);
    h.registerProjectAuto.mockResolvedValue({
      project: { name: "newapp", domain: "newapp.dev.com", port: 3123 },
    });

    await start({ dir });

    expect(h.registerProjectAuto).toHaveBeenCalled();
    expect(spawnEnv().PORT).toBe("3123");
  });
});