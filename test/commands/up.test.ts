import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, writeFile, rm, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * `orkestra up` — the command in the port-drift report, and the largest file in
 * the project with no coverage.
 *
 * Real timers throughout: `up()` schedules nothing, so unlike the health monitor
 * there is no need to fake them, and the real `getStartCommand` can read a real
 * package.json. Only the genuinely external edges are mocked: spawning a process,
 * the state store, the port probes and the proxy.
 */

const h = vi.hoisted(() => ({
  spawn: vi.fn(),
  execSync: vi.fn(),
  getProject: vi.fn(),
  listProjects: vi.fn(),
  setProjectRunning: vi.fn(),
  updateProjectPort: vi.fn(),
  isProcessAlive: vi.fn(),
  loadConfig: vi.fn(),
  detectFramework: vi.fn(),
  isPortOccupied: vi.fn(),
  findAvailablePort: vi.fn(),
  registerProjectAuto: vi.fn(),
  writeLog: vi.fn(),
  getLogPath: vi.fn(),
  startMonitoring: vi.fn(),
  cleanupLaravelProcesses: vi.fn(),
  detectProxy: vi.fn(),
  proxyUnregister: vi.fn(),
  proxyRegister: vi.fn(),
  isCommandAvailable: vi.fn(),
}));

vi.mock("node:child_process", () => ({ spawn: h.spawn, execSync: h.execSync }));
vi.mock("../../src/state/store.js", () => ({
  getProject: h.getProject,
  listProjects: h.listProjects,
  setProjectRunning: h.setProjectRunning,
  updateProjectPort: h.updateProjectPort,
  isProcessAlive: h.isProcessAlive,
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
vi.mock("../../src/utils/laravel.js", () => ({ cleanupLaravelProcesses: h.cleanupLaravelProcesses }));
vi.mock("../../src/detection/proxy.js", () => ({ detectProxy: h.detectProxy }));
vi.mock("../../src/utils/exec.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/utils/exec.js")>();
  return { ...actual, isCommandAvailable: h.isCommandAvailable };
});
// Keep the terminal quiet; the assertions are on the mock calls.
vi.mock("../../src/utils/logger.js", () => ({
  log: { plain: vi.fn(), info: vi.fn(), dim: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn() },
  heading: vi.fn(),
  spinner: () => ({ start: vi.fn(), stop: vi.fn(), succeed: vi.fn(), fail: vi.fn() }),
}));

const { up } = await import("../../src/commands/up.js");

let dir: string;
let exitSpy: ReturnType<typeof vi.spyOn>;

const CHILD_PID = 31337;

function fakeChild() {
  return {
    pid: CHILD_PID,
    unref: vi.fn(),
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
    on: vi.fn(),
  };
}

const spawnArgs = () => h.spawn.mock.calls[0];
const spawnEnv = () => h.spawn.mock.calls[0][2].env as Record<string, string>;
const spawnOpts = () => h.spawn.mock.calls[0][2] as Record<string, any>;

/** Stands in for process.exit so the exit paths can be asserted. */
class ExitCalled extends Error {
  constructor(public code: number) {
    super(`process.exit(${code})`);
  }
}

beforeEach(async () => {
  vi.clearAllMocks();

  dir = await mkdtemp(join(tmpdir(), "ork-up-"));
  await writeFile(
    join(dir, "package.json"),
    JSON.stringify({ name: "texel-api", scripts: { dev: "next dev" } }),
    "utf-8",
  );

  h.getProject.mockResolvedValue({
    name: "texel-api",
    path: dir,
    domain: "api.texelbd.com",
    port: 8022,
    framework: "next.js",
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
  // up() asks twice: whether the command it is about to spawn exists, and
  // whether mise does. Default to both present.
  h.isCommandAvailable.mockImplementation(async (c: string) => c === "npx" || c === "mise");
  h.detectProxy.mockResolvedValue({
    unregister: h.proxyUnregister,
    register: h.proxyRegister,
  });
  h.proxyUnregister.mockResolvedValue(undefined);
  h.proxyRegister.mockResolvedValue(undefined);

  exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    throw new ExitCalled(code ?? 0);
  }) as never);
});

afterEach(async () => {
  exitSpy.mockRestore();
  await rm(dir, { recursive: true, force: true }).catch(() => {});
});

describe("which port up() binds", () => {
  it("uses the state port when config omits one", async () => {
    // The bug's exact shape: state says 8022, the framework default is 3000.
    await up({ dir });

    expect(spawnEnv().PORT).toBe("8022");
  });

  it("honours --port above everything", async () => {
    await up({ dir, port: 9999 });

    expect(spawnEnv().PORT).toBe("9999");
  });

  it("lets config outrank state", async () => {
    h.loadConfig.mockResolvedValue({ name: "texel-api", port: 7000, startCommand: "next dev" });

    await up({ dir });

    expect(spawnEnv().PORT).toBe("7000");
  });

  it("falls back to the framework default when nothing is configured", async () => {
    h.getProject.mockResolvedValue(null);
    h.registerProjectAuto.mockResolvedValue({
      project: { name: "texel-api", domain: "auto.dev.com", port: 3022 },
    });

    await up({ dir });

    expect(spawnEnv().PORT).toBe("3022");
  });

  it("exports the port to the child as both PORT and SERVER_PORT", async () => {
    await up({ dir });

    expect(spawnEnv().PORT).toBe("8022");
    // Laravel's `composer dev` reads SERVER_PORT rather than PORT.
    expect(spawnEnv().SERVER_PORT).toBe("8022");
  });
});

describe("already running", () => {
  it("returns without spawning when the pid is alive", async () => {
    // The guard is `existing?.pid && isProcessAlive(existing.pid)`, so state must
    // actually carry a pid for "already running" to mean anything.
    h.getProject.mockResolvedValue({
      name: "texel-api", path: dir, domain: "api.texelbd.com",
      port: 8022, framework: "next.js", pid: 999,
    });
    h.isProcessAlive.mockResolvedValue(true);

    await up({ dir });

    expect(h.spawn).not.toHaveBeenCalled();
    expect(h.setProjectRunning).not.toHaveBeenCalled();
  });

  it("starts normally when the recorded pid is dead", async () => {
    h.isProcessAlive.mockResolvedValue(false);

    await up({ dir });

    expect(h.spawn).toHaveBeenCalled();
  });
});

describe("port conflict and migration", () => {
  beforeEach(() => {
    h.isPortOccupied.mockResolvedValue(true);
    h.findAvailablePort.mockResolvedValue(8023);
  });

  it("moves to an available port", async () => {
    await up({ dir });

    expect(h.findAvailablePort).toHaveBeenCalledWith(8022, dir);
    expect(spawnEnv().PORT).toBe("8023");
  });

  it("passes the project path so the project can reclaim its own port", async () => {
    // Without this the project's own recorded port looks occupied and it drifts.
    await up({ dir });

    expect(h.findAvailablePort.mock.calls[0][1]).toBe(dir);
  });

  it("re-points the proxy at the new port", async () => {
    h.loadConfig.mockResolvedValue({
      name: "texel-api",
      proxy: { provider: "caddy" },
      startCommand: "next dev",
    });

    await up({ dir });

    expect(h.proxyUnregister).toHaveBeenCalledWith("api.texelbd.com");
    expect(h.proxyRegister).toHaveBeenCalledWith(
      expect.objectContaining({ domain: "api.texelbd.com", port: 8023 }),
    );
  });

  it("persists the new port in state", async () => {
    await up({ dir });

    expect(h.updateProjectPort).toHaveBeenCalledWith(dir, 8023);
  });

  it("leaves the proxy and state alone when there is no conflict", async () => {
    h.isPortOccupied.mockResolvedValue(false);
    h.proxyUnregister.mockClear();
    h.updateProjectPort.mockClear();

    await up({ dir });

    expect(h.proxyUnregister).not.toHaveBeenCalled();
    expect(h.proxyRegister).not.toHaveBeenCalled();
    expect(h.updateProjectPort).not.toHaveBeenCalled();
  });
});

describe("process state", () => {
  it("records the new pid", async () => {
    await up({ dir });

    expect(h.setProjectRunning).toHaveBeenCalledWith(dir, CHILD_PID);
  });

  it("detaches and unrefs in the default mode", async () => {
    const child = fakeChild();
    h.spawn.mockImplementation(() => child);

    await up({ dir });

    expect(spawnOpts().detached).toBe(true);
    expect(spawnOpts().stdio).toBe("pipe");
    expect(child.unref).toHaveBeenCalled();
  });

  it("starts health monitoring in the default mode", async () => {
    await up({ dir });

    expect(h.startMonitoring).toHaveBeenCalledWith(dir);
  });

  it("runs attached in foreground mode, with no monitoring", async () => {
    const child = fakeChild();
    h.spawn.mockImplementation(() => child);

    await up({ dir, foreground: true });

    expect(spawnOpts().detached).toBe(false);
    expect(spawnOpts().stdio).toBe("inherit");
    expect(child.unref).not.toHaveBeenCalled();
    expect(h.startMonitoring).not.toHaveBeenCalled();
  });

  it("wraps a bare framework binary so it resolves from node_modules", async () => {
    // No lockfile in this fixture, so it falls back to npx. With a bun.lockb it
    // would exec through bun instead — see the package-manager tests below.
    await up({ dir });

    expect(spawnArgs()[0]).toBe("npx");
    expect(spawnArgs()[1]).toEqual(["--yes", "next", "dev"]);
    expect(spawnOpts().cwd).toBe(dir);
  });

  it("prefers bun to run the framework binary when the project uses bun", async () => {
    await writeFile(join(dir, "bun.lockb"), "", "utf-8");
    h.isCommandAvailable.mockImplementation(async (c: string) => c === "bun" || c === "mise");

    await up({ dir });

    expect(spawnArgs()[0]).toBe("bun");
    expect(spawnArgs()[1]).toEqual(["next", "dev"]);
  });

  it("prefers pnpm when a pnpm lockfile is present", async () => {
    await writeFile(join(dir, "pnpm-lock.yaml"), "", "utf-8");
    h.isCommandAvailable.mockImplementation(async (c: string) => c === "pnpm" || c === "mise");

    await up({ dir });

    expect(spawnArgs()[0]).toBe("pnpm");
    expect(spawnArgs()[1]).toEqual(["exec", "next", "dev"]);
  });
});

describe("mise environment", () => {
  // mise is the primary toolchain for this deployment, and up() sources the
  // child's environment from `mise env` rather than from a .env file — so a
  // toolchain activated only by mise would otherwise be invisible to the dev
  // server. Worth pinning.
  it("injects mise's environment into the child process", async () => {
    h.isCommandAvailable.mockImplementation(async (c: string) => c === "mise" || c === "npx");
    h.execSync.mockReturnValue(
      JSON.stringify({ PATH: "/home/u/.local/share/mise/installs/php/8.4/bin:/usr/bin", PHP_VERSION: "8.4" }),
    );

    await up({ dir });

    expect(h.execSync).toHaveBeenCalledWith("mise env -j", expect.anything());
    expect(spawnEnv().PHP_VERSION).toBe("8.4");
    expect(spawnEnv().PATH).toContain("mise/installs/php/8.4/bin");
  });

  it("still sets the port when mise supplies the environment", async () => {
    h.isCommandAvailable.mockImplementation(async (c: string) => c === "mise" || c === "npx");
    h.execSync.mockReturnValue(JSON.stringify({ PHP_VERSION: "8.4" }));

    await up({ dir });

    expect(spawnEnv().PORT).toBe("8022");
    expect(spawnEnv().SERVER_PORT).toBe("8022");
  });

  it("falls back to parsing `mise env` when the -j form is unsupported", async () => {
    h.isCommandAvailable.mockImplementation(async (c: string) => c === "mise" || c === "npx");
    h.execSync
      .mockImplementationOnce(() => {
        throw new Error("unknown flag -j");
      })
      .mockReturnValueOnce('export PHP_VERSION="8.4"\nexport REDIS_URL=redis://127.0.0.1:6379\n');

    await up({ dir });

    expect(spawnEnv().PHP_VERSION).toBe("8.4");
    expect(spawnEnv().REDIS_URL).toBe("redis://127.0.0.1:6379");
  });

  it("starts normally when mise is not installed", async () => {
    // The spawn command exists; mise does not.
    h.isCommandAvailable.mockImplementation(async (c: string) => c === "npx");

    await up({ dir });

    expect(h.execSync).not.toHaveBeenCalled();
    expect(h.spawn).toHaveBeenCalled();
    expect(spawnEnv().PORT).toBe("8022");
  });

  it("ignores non-string values from mise", async () => {
    h.isCommandAvailable.mockImplementation(async (c: string) => c === "mise" || c === "npx");
    h.execSync.mockReturnValue(JSON.stringify({ NESTED: { a: 1 }, PORT: 9999 }));

    await up({ dir });

    // A nested object must not be stringified into the environment, and the
    // resolved port must win over whatever mise claims.
    expect(spawnEnv().NESTED).toBeUndefined();
    expect(spawnEnv().PORT).toBe("8022");
  });
});

describe("auto-registration", () => {
  it("registers an unknown project and uses the chosen port", async () => {
    h.getProject.mockResolvedValue(null);
    h.registerProjectAuto.mockResolvedValue({
      project: { name: "newapp", domain: "newapp.dev.com", port: 3123 },
    });

    await up({ dir });

    expect(h.registerProjectAuto).toHaveBeenCalledWith(dir, expect.anything());
    expect(spawnEnv().PORT).toBe("3123");
  });

  it("does not re-register a known project", async () => {
    await up({ dir });

    expect(h.registerProjectAuto).not.toHaveBeenCalled();
  });
});

describe("failure paths exit loudly", () => {
  it("exits when the framework cannot be detected", async () => {
    h.detectFramework.mockResolvedValue(null);

    await expect(up({ dir })).rejects.toThrow(ExitCalled);
    expect(h.spawn).not.toHaveBeenCalled();
  });

  it("exits when there is no start command", async () => {
    // A framework getStartCommand knows nothing about.
    h.detectFramework.mockResolvedValue({ name: "cobol", version: "1", port: 3000 });
    h.loadConfig.mockResolvedValue({ name: "texel-api" });

    await expect(up({ dir })).rejects.toThrow(ExitCalled);
    expect(h.spawn).not.toHaveBeenCalled();
  });

  it("exits when --project names something unregistered", async () => {
    h.listProjects.mockResolvedValue([]);

    await expect(up({ project: "ghost" })).rejects.toThrow(ExitCalled);
    expect(h.spawn).not.toHaveBeenCalled();
  });

  it("does not swallow a spawn failure", async () => {
    h.spawn.mockImplementation(() => {
      throw new Error("EACCES");
    });

    await expect(up({ dir })).rejects.toThrow(/EACCES/);
  });
});

describe("--project lookup", () => {
  it("resolves a project by exact name and starts it", async () => {
    h.listProjects.mockResolvedValue([
      { name: "texel-api", path: dir, domain: "api.texelbd.com", port: 8022, framework: "next.js" },
    ]);

    await up({ project: "TEXEL-API" });

    expect(h.spawn).toHaveBeenCalled();
    expect(spawnOpts().cwd).toBe(dir);
  });
});

describe("--all", () => {
  it("starts every registered project that is not already running", async () => {
    h.listProjects.mockResolvedValue([
      { name: "texel-api", path: dir, domain: "api.texelbd.com", port: 8022, framework: "next.js" },
      { name: "texel-front", path: dir, domain: "texelbd.com", port: 3022, framework: "next.js" },
    ]);
    h.getProject.mockImplementation(async (p: string) =>
      p === dir
        ? null
        : { name: "texel-front", path: dir, domain: "texelbd.com", port: 3022, framework: "next.js" },
    );

    await up({ all: true });

    // One already-registered project skipped, the unregistered one registered.
    expect(h.registerProjectAuto).toHaveBeenCalled();
  });

  it("does nothing when nothing is registered", async () => {
    h.listProjects.mockResolvedValue([]);

    await up({ all: true });

    expect(h.spawn).not.toHaveBeenCalled();
  });
});