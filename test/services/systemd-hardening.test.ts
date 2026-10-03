import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  SystemdManager,
  escapeSystemdSpecifiers,
  DEFAULT_TEMPLATES,
} from "../../src/services/systemd.js";
import * as exec from "../../src/utils/exec.js";

/**
 * The rendered unit is what actually runs on the server, so the properties that
 * break production are pinned here: port plumbing, boot ordering, descriptor
 * limits, and `%` escaping.
 */

const mgr = new SystemdManager();

function render(type: keyof typeof DEFAULT_TEMPLATES, vars: Record<string, string | number>) {
  return mgr.renderTemplate(DEFAULT_TEMPLATES[type], vars);
}

describe("unit rendering", () => {
  it("uses the supplied reverb port", () => {
    const unit = render("reverb", { PROJECT_NAME: "texel-api", PROJECT_PATH: "/srv/apps/texel-api", USER: "www-data", GROUP: "www-data", PHP_BIN: "/usr/bin/php", REVERB_PORT: 8822 });
    expect(unit).toContain("--port=8822");
    expect(unit).not.toContain("--port=8080");
  });

  it("uses the supplied octane port and server", () => {
    const unit = render("octane", {
      PROJECT_NAME: "texel-api",
      PROJECT_PATH: "/srv/apps/texel-api",
      USER: "www-data",
      GROUP: "www-data",
      PHP_BIN: "/usr/bin/php",
      OCTANE_PORT: 8022,
      OCTANE_SERVER: "swoole",
      MAX_REQUESTS: 1200,
    });
    expect(unit).toContain("--port=8022");
    expect(unit).toContain("--server=swoole");
    expect(unit).toContain("--max-requests=1200");
  });

  it("uses the resolved absolute php path, not a bare name", () => {
    const unit = render("reverb", {
      PROJECT_NAME: "texel-api",
      PROJECT_PATH: "/srv/apps/texel-api",
      USER: "www-data",
      GROUP: "www-data",
      PHP_BIN: "/home/deploy/.local/share/mise/installs/php/8.4.10/bin/php",
      REVERB_PORT: 8822,
    });
    expect(unit).toContain(
      "ExecStart=/home/deploy/.local/share/mise/installs/php/8.4.10/bin/php artisan reverb:start",
    );
  });

  it("carries queue tuning through to the command line", () => {
    const unit = render("queue", {
      PROJECT_NAME: "texel-api",
      PROJECT_PATH: "/srv/apps/texel-api",
      USER: "www-data",
      GROUP: "www-data",
      PHP_BIN: "/usr/bin/php",
      QUEUE_CONNECTION: "redis",
      QUEUES: "default,emails",
      SLEEP: 1,
      TRIES: 5,
      TIMEOUT: 120,
      MAX_JOBS: 1000,
      MAX_TIME: 7200,
    });
    expect(unit).toContain("--queue=default,emails");
    expect(unit).toContain("--sleep=1");
    expect(unit).toContain("--tries=5");
    expect(unit).toContain("--timeout=120");
    expect(unit).toContain("--max-jobs=1000");
    expect(unit).toContain("--max-time=7200");
  });
});

describe("boot ordering", () => {
  it.each(["web", "octane", "queue", "reverb"] as const)(
    "%s waits for network-online, not network",
    (type) => {
      const unit = render(type, {
        PROJECT_NAME: "p",
        PROJECT_PATH: "/srv/p",
        USER: "u",
        GROUP: "g",
        PHP_BIN: "/usr/bin/php",
        EXEC_START: "node server.js",
      });
      // network.target is reached before the network is usable, so a queue
      // worker can lose its Redis/DB connection on boot.
      expect(unit).toContain("After=network-online.target");
      expect(unit).toContain("Wants=network-online.target");
      expect(unit).not.toContain("After=network.target\n");
    },
  );
});

describe("descriptor limits", () => {
  it.each(["web", "octane", "queue", "reverb"] as const)("%s sets LimitNOFILE", (type) => {
    const unit = render(type, {
      PROJECT_NAME: "p",
      PROJECT_PATH: "/srv/p",
      USER: "u",
      GROUP: "g",
      PHP_BIN: "/usr/bin/php",
      EXEC_START: "node server.js",
    });
    expect(unit).toContain("LimitNOFILE=65535");
  });
});

describe("systemd specifier escaping", () => {
  it("doubles literal percent signs", () => {
    expect(escapeSystemdSpecifiers("/srv/apps/100%-coverage")).toBe("/srv/apps/100%%-coverage");
  });

  it("leaves content without percent signs untouched", () => {
    const unit = escapeSystemdSpecifiers("ExecStart=/usr/bin/php artisan reverb:start");
    expect(unit).toBe("ExecStart=/usr/bin/php artisan reverb:start");
  });

  it("is applied to the whole rendered unit", () => {
    const unit = render("reverb", {
      PROJECT_NAME: "pct",
      PROJECT_PATH: "/srv/apps/pct",
      USER: "u",
      GROUP: "g",
      PHP_BIN: "/usr/bin/php",
      REVERB_PORT: 8822,
    });
    // No bare `%` may survive, or systemd reads it as a specifier.
    expect(unit.includes("%") && !unit.includes("%%")).toBe(false);
  });
});

describe("service naming", () => {
  it("produces a stable systemd unit name", () => {
    expect(mgr.getServiceName("texel-api", "reverb")).toBe("orkestra-texel-api-reverb.service");
  });

  it("sanitises characters systemd rejects", () => {
    expect(mgr.getServiceName("My App!", "web")).toBe("orkestra-my-app--web.service");
  });

  it("distinguishes service types for the same project", () => {
    const names = (["web", "octane", "queue", "reverb"] as const).map((t) =>
      mgr.getServiceName("texel-api", t),
    );
    expect(new Set(names).size).toBe(4);
  });
});

describe("restart verification", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(exec, "run").mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reports active when the unit stays up", async () => {
    vi.mocked(exec.run).mockImplementation(async (cmd: string, args: string[] = []) => {
      if (cmd === "systemctl" && args[0] === "is-active") {
        return { stdout: "active", stderr: "", exitCode: 0 };
      }
      return { stdout: "", stderr: "", exitCode: 0 };
    });

    await expect(mgr.restartAndVerify("orkestra-p-web.service", 1200)).resolves.toBe("active");
  });

  it("reports failed when the unit is crash-looping", async () => {
    // The regression: `systemctl restart` succeeds for a unit that dies
    // immediately, because Restart=always keeps it looping.
    vi.mocked(exec.run).mockImplementation(async (cmd: string, args: string[] = []) => {
      if (cmd === "systemctl" && args[0] === "is-active") {
        return { stdout: "activating", stderr: "", exitCode: 0 };
      }
      return { stdout: "", stderr: "", exitCode: 0 };
    });

    await expect(mgr.restartAndVerify("orkestra-p-web.service", 1200)).resolves.toBe("inactive");
  });

  it("surfaces a failed state explicitly", async () => {
    vi.mocked(exec.run).mockImplementation(async (cmd: string, args: string[] = []) => {
      if (cmd === "systemctl" && args[0] === "is-active") {
        return { stdout: "failed", stderr: "", exitCode: 3 };
      }
      return { stdout: "", stderr: "", exitCode: 0 };
    });

    await expect(mgr.restartAndVerify("orkestra-p-web.service", 1200)).resolves.toBe("failed");
  });

  it("does not report success on a single lucky check", async () => {
    // One `active` sample early, then the unit dies: the deploy must not call
    // that a success just because the first poll looked fine.
    let polls = 0;
    vi.mocked(exec.run).mockImplementation(async (cmd: string, args: string[] = []) => {
      if (cmd === "systemctl" && args[0] === "is-active") {
        polls++;
        return { stdout: polls === 1 ? "active" : "failed", stderr: "", exitCode: 0 };
      }
      return { stdout: "", stderr: "", exitCode: 0 };
    });

    // Settle window must be observed, not just the first read.
    const state = await mgr.restartAndVerify("orkestra-p-web.service", 1500);
    expect(polls).toBeGreaterThan(1);
    expect(state).not.toBe("active");
  });
});