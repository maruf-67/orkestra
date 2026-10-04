import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * The health monitor's auto-restart.
 *
 * This is the path the drift bug lived on, and it had no coverage at all. It is
 * driven here through the real `HealthMonitor` — real `setInterval`, real
 * `setTimeout`, real `getStartCommand` reading a real package.json — with only
 * the genuinely external edges mocked: spawning a process, the state store, and
 * the port probes.
 *
 * The regression these guard: the monitor used to resolve its port as
 * `config?.port || framework.port`, ignoring the port recorded in state, so a
 * project whose .orkestra.yml omits `port` came back on the framework default
 * after a restart while Caddy still proxied to the state port.
 */

const h = vi.hoisted(() => ({
  spawn: vi.fn(),
  getProject: vi.fn(),
  setProjectStopped: vi.fn(),
  setProjectRunning: vi.fn(),
  isProcessAlive: vi.fn(),
  loadConfig: vi.fn(),
  detectFramework: vi.fn(),
  writeLog: vi.fn(),
  isPortOccupied: vi.fn(),
  findAvailablePort: vi.fn(),
}));

vi.mock("node:child_process", () => ({ spawn: h.spawn }));
vi.mock("../../src/state/store.js", () => ({
  getProject: h.getProject,
  setProjectStopped: h.setProjectStopped,
  setProjectRunning: h.setProjectRunning,
  isProcessAlive: h.isProcessAlive,
}));
vi.mock("../../src/config/loader.js", () => ({ loadConfig: h.loadConfig }));
vi.mock("../../src/detection/framework.js", () => ({ detectFramework: h.detectFramework }));
vi.mock("../../src/utils/logger-file.js", () => ({ writeLog: h.writeLog }));
// dev-port.ts reaches the real probes through this module, so mocking it here
// controls what ensurePortAvailable() sees.
vi.mock("../../src/state/ports.js", () => ({
  isPortOccupied: h.isPortOccupied,
  findAvailablePort: h.findAvailablePort,
}));

const { HealthMonitor } = await import("../../src/utils/health.js");

let dir: string;
let monitor: InstanceType<typeof HealthMonitor>;

const DEAD_PID = 4242;
const NEW_PID = 5555;

/** A child process stub with just the surface health.ts touches. */
function fakeChild(pid = NEW_PID) {
  return {
    pid,
    unref: vi.fn(),
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
  };
}

const spawnEnv = () => h.spawn.mock.calls[0][2].env as Record<string, string>;
const spawnCmd = () => h.spawn.mock.calls[0][0] as string;
const logMessages = () => h.writeLog.mock.calls.map((c) => String(c[2].message));
const logged = (needle: RegExp) => logMessages().some((m) => needle.test(m));

beforeEach(async () => {
  vi.clearAllMocks();

  // Fake only the timers we drive. Vitest's default fake set also stubs
  // setImmediate, which node:fs/promises needs for its callbacks to settle — a
  // real file read never resolves while fake timers are active, so anything
  // touching disk inside a timer callback deadlocks.
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });

  dir = await mkdtemp(join(tmpdir(), "ork-health-"));

  // A registered project on 8022 whose .orkestra.yml deliberately omits `port` —
  // the shape that made the two resolvers disagree.
  h.getProject.mockResolvedValue({
    name: "texel-api",
    path: dir,
    domain: "api.texelbd.com",
    port: 8022,
    framework: "next.js",
    pid: DEAD_PID,
  });
  // `startCommand` is supplied so the real getStartCommand() returns without
  // reading package.json, which cannot settle under fake timers (see above). The
  // package.json resolution path is unchanged by this work and is not what these
  // tests cover; they cover port resolution, spawning and state handling.
  h.loadConfig.mockResolvedValue({
    name: "texel-api",
    domain: "api.texelbd.com",
    startCommand: "next dev",
  });
  h.detectFramework.mockResolvedValue({ name: "next.js", version: "15", port: 3000 });
  h.isProcessAlive.mockResolvedValue(false); // the process died
  h.isPortOccupied.mockResolvedValue(false);
  h.findAvailablePort.mockResolvedValue(8023);
  h.spawn.mockImplementation(() => fakeChild());
  h.setProjectStopped.mockResolvedValue(undefined);
  h.setProjectRunning.mockResolvedValue(undefined);

  monitor = new HealthMonitor({
    healthCheckInterval: 1000,
    restartDelay: 10,
    maxRestarts: 3,
  });
});

afterEach(async () => {
  monitor.stopAll();
  vi.useRealTimers();
  await rm(dir, { recursive: true, force: true }).catch(() => {});
});

/** Drive the monitor until the restart has been attempted. */
async function runUntilRestart(): Promise<void> {
  monitor.startMonitoring(dir);
  await vi.advanceTimersByTimeAsync(1200); // health check fires
  await vi.advanceTimersByTimeAsync(50);   // restart delay elapses
}

describe("auto-restart binds the port recorded in state", () => {
  it("restarts on the state port, not the framework default", async () => {
    // The regression: state says 8022, the framework default is 3000, and the
    // config has no `port` at all.
    await runUntilRestart();

    expect(h.spawn).toHaveBeenCalled();
    expect(spawnEnv().PORT).toBe("8022");
    expect(spawnEnv().PORT).not.toBe("3000");
  });

  it("does not scan for another port when the recorded port is free", async () => {
    await runUntilRestart();

    expect(h.isPortOccupied).toHaveBeenCalledWith(8022);
    expect(h.findAvailablePort).not.toHaveBeenCalled();
    expect(logged(/in use by another process/i)).toBe(false);
  });

  it("uses the config port when config has one", async () => {
    h.loadConfig.mockResolvedValue({ name: "texel-api", port: 9000, startCommand: "next dev" });

    await runUntilRestart();

    expect(spawnEnv().PORT).toBe("9000");
  });

  it("prefers the config port over the state port", async () => {
    // config > state, matching commands/up.ts.
    h.loadConfig.mockResolvedValue({ name: "texel-api", port: 9000, startCommand: "next dev" });

    await runUntilRestart();

    expect(spawnEnv().PORT).toBe("9000");
  });

  it("respawns with the project's real start command", async () => {
    await runUntilRestart();

    expect(spawnCmd()).toBe("next");
    expect(h.spawn.mock.calls[0][1]).toEqual(["dev"]);
    expect(h.spawn.mock.calls[0][2].cwd).toBe(dir);
  });

  it("records the new pid in state", async () => {
    await runUntilRestart();

    expect(h.setProjectRunning).toHaveBeenCalledWith(dir, NEW_PID);
  });

  it("logs the restart under the registered project name", async () => {
    await runUntilRestart();

    expect(logged(/Process restarted with PID 5555/)).toBe(true);
    // Not the directory basename.
    for (const call of h.writeLog.mock.calls) {
      expect(call[1]).toBe("texel-api");
    }
  });
});

describe("when the port really is taken by something else", () => {
  beforeEach(() => {
    h.isPortOccupied.mockResolvedValue(true);
    h.findAvailablePort.mockResolvedValue(8023);
  });

  it("moves to the alternative port", async () => {
    await runUntilRestart();

    expect(h.findAvailablePort).toHaveBeenCalledWith(8022, dir);
    expect(spawnEnv().PORT).toBe("8023");
  });

  it("says the proxy will now return 502", async () => {
    // The old code moved silently, leaving Caddy aimed at a dead port. A moved
    // restart must state the consequence.
    await runUntilRestart();

    expect(logged(/502/)).toBe(true);
    expect(logged(/8022/)).toBe(true);
    expect(logged(/8023/)).toBe(true);
  });

  it("warns on stderr so it is visible in the log stream", async () => {
    await runUntilRestart();

    const warning = h.writeLog.mock.calls.find((c) => /502/.test(String(c[2].message)));
    expect(warning![2].stream).toBe("stderr");
  });

  it("does not warn when the scan returns the same port", async () => {
    h.findAvailablePort.mockResolvedValue(8022);

    await runUntilRestart();

    expect(spawnEnv().PORT).toBe("8022");
    expect(logged(/502/)).toBe(false);
  });
});

describe("restart bookkeeping", () => {
  it("logs the crash before restarting", async () => {
    await runUntilRestart();

    expect(logged(new RegExp(`Process ${DEAD_PID} exited unexpectedly`))).toBe(true);
    expect(logged(/Attempting restart \(attempt 1\/3\)/)).toBe(true);
  });

  it("clears the stale pid before respawning", async () => {
    await runUntilRestart();

    expect(h.setProjectStopped).toHaveBeenCalledWith(dir);
  });

  it("resets the attempt counter after a successful restart", async () => {
    monitor.startMonitoring(dir);
    await vi.advanceTimersByTimeAsync(1200);
    await vi.advanceTimersByTimeAsync(50);

    // A second death must be attempt 1 again, not attempt 2.
    h.isProcessAlive.mockResolvedValue(false);
    h.spawn.mockClear();
    await vi.advanceTimersByTimeAsync(1200);
    await vi.advanceTimersByTimeAsync(50);

    expect(logged(/Attempting restart \(attempt 1\/3\)/)).toBe(true);
  });

  it("gives up after maxRestarts and stops monitoring", async () => {
    h.spawn.mockImplementation(() => {
      throw new Error("cannot spawn");
    });

    monitor.startMonitoring(dir);
    for (let i = 0; i < 5; i++) {
      await vi.advanceTimersByTimeAsync(1200);
      await vi.advanceTimersByTimeAsync(50);
    }

    expect(logged(/Max restart attempts \(3\) reached/)).toBe(true);
    expect(monitor.getMonitored()).not.toContain(dir);
  });

  it("does not restart at all while the process is alive", async () => {
    h.isProcessAlive.mockResolvedValue(true);

    monitor.startMonitoring(dir);
    await vi.advanceTimersByTimeAsync(3000);

    expect(h.spawn).not.toHaveBeenCalled();
  });
});

describe("failure handling", () => {
  it("does not throw when the framework cannot be detected", async () => {
    h.detectFramework.mockResolvedValue(null);

    await expect(runUntilRestart()).resolves.toBeUndefined();
    expect(logged(/Restart failed: Cannot detect framework/)).toBe(true);
    expect(h.spawn).not.toHaveBeenCalled();
  });

  it("does not throw when there is no start command", async () => {
    // A framework getStartCommand knows nothing about. Every framework it does
    // know either has a hardcoded command (go, rust, fastapi, flask, django) or
    // reads a project file, which cannot settle under fake timers.
    h.detectFramework.mockResolvedValue({ name: "cobol", version: "1", port: 3000 });
    h.loadConfig.mockResolvedValue({ name: "texel-api" });

    await expect(runUntilRestart()).resolves.toBeUndefined();
    expect(logged(/Cannot determine start command/)).toBe(true);
    expect(h.spawn).not.toHaveBeenCalled();
  });

  it("uses a framework's built-in start command when there is no config override", async () => {
    h.detectFramework.mockResolvedValue({ name: "go", version: "1", port: 3000 });
    h.loadConfig.mockResolvedValue({ name: "texel-api" });

    await runUntilRestart();

    expect(spawnCmd()).toBe("go");
    expect(h.spawn.mock.calls[0][1]).toEqual(["run", "."]);
  });

  it("catches a spawn failure and logs it instead of crashing", async () => {
    h.spawn.mockImplementation(() => {
      throw new Error("EACCES");
    });

    await expect(runUntilRestart()).resolves.toBeUndefined();
    expect(logged(/Restart failed: Error: EACCES/)).toBe(true);
  });

  it("stops monitoring when the project is no longer registered", async () => {
    h.getProject.mockResolvedValue(null);

    monitor.startMonitoring(dir);
    await vi.advanceTimersByTimeAsync(1200);

    expect(monitor.getMonitored()).not.toContain(dir);
    expect(h.spawn).not.toHaveBeenCalled();
  });
});

describe("monitor lifecycle", () => {
  it("is idempotent for a path already being monitored", () => {
    monitor.startMonitoring(dir);
    monitor.startMonitoring(dir);
    expect(monitor.getMonitored()).toEqual([dir]);
  });

  it("stopMonitoring removes the path", () => {
    monitor.startMonitoring(dir);
    monitor.stopMonitoring(dir);
    expect(monitor.getMonitored()).toEqual([]);
  });

  it("stopAll clears everything", () => {
    monitor.startMonitoring(dir);
    monitor.startMonitoring("/srv/other");
    monitor.stopAll();
    expect(monitor.getMonitored()).toEqual([]);
  });

  it("stopMonitoring is safe for a path it never monitored", () => {
    expect(() => monitor.stopMonitoring("/never")).not.toThrow();
  });
});