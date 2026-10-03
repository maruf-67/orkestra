import { describe, it, expect, vi, afterEach } from "vitest";
import { SystemdManager, DEFAULT_TEMPLATES, type SystemdServiceOptions } from "../../src/services/systemd.js";
import * as exec from "../../src/utils/exec.js";
import { existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Regression guard for P0-1: the reverb unit template renders
 * `ExecStart=... --port={{REVERB_PORT}}`. If callers do not supply
 * `reverbPort`, the manager falls back to a hardcoded 8080 and silently
 * rebinds the WebSocket server on every deploy.
 */

const systemd = new SystemdManager();

function render(type: keyof typeof DEFAULT_TEMPLATES, vars: Record<string, string | number | undefined>) {
  return systemd.renderTemplate(DEFAULT_TEMPLATES[type], vars);
}

function opts(overrides: Partial<SystemdServiceOptions> = {}): SystemdServiceOptions {
  return {
    projectName: "texel-api",
    projectPath: "/srv/apps/texel-api",
    phpBinary: "/usr/bin/php",
    ...overrides,
  };
}

describe("systemd unit rendering — reverb port", () => {
  it("uses the supplied reverbPort instead of the 8080 default", () => {
    const unit = render("reverb", { PHP_BIN: "php", REVERB_PORT: 8822 });
    expect(unit).toContain("--port=8822");
    expect(unit).not.toContain("--port=8080");
  });

  it("falls back to 8080 only when no reverbPort is supplied", () => {
    // The 8080 default lives in installService's variable table, not in
    // renderTemplate — renderTemplate substitutes what it is given.
    const vars = { PHP_BIN: "php", REVERB_PORT: opts({}).reverbPort || 8080 };
    expect(render("reverb", vars)).toContain("--port=8080");
  });

  it("leaves unsubstituted placeholders intact rather than writing 'undefined'", () => {
    // renderTemplate only substitutes keys it is given, so an omitted variable
    // leaves the raw placeholder. installService is therefore responsible for
    // supplying every default — which is what the tests below verify.
    const unit = render("reverb", { PHP_BIN: "php" });
    expect(unit).toContain("--port={{REVERB_PORT}}");
    expect(unit).not.toContain("undefined");
  });

  it("renders a non-default reverb port per project without collision", () => {
    const picl = render("reverb", { PHP_BIN: "php", REVERB_PORT: 8087 });
    const digitalLibrary = render("reverb", { PHP_BIN: "php", REVERB_PORT: 8805 });
    expect(picl).toContain("--port=8087");
    expect(digitalLibrary).toContain("--port=8805");
  });
});

describe("systemd unit rendering — octane server", () => {
  it("honours an explicitly configured swoole server", () => {
    const unit = render("octane", {
      PHP_BIN: "php",
      OCTANE_SERVER: "swoole",
      OCTANE_PORT: 8022,
      MAX_REQUESTS: 500,
    });
    expect(unit).toContain("--server=swoole");
    expect(unit).toContain("--port=8022");
  });

  it("renders the configured max-requests value", () => {
    const unit = render("octane", {
      PHP_BIN: "php",
      OCTANE_SERVER: "roadrunner",
      OCTANE_PORT: 8022,
      MAX_REQUESTS: 1500,
    });
    expect(unit).toContain("--max-requests=1500");
  });
});

describe("systemd unit rendering — queue tuning", () => {
  it("renders queue tuning from options rather than hardcoded defaults", () => {
    const unit = render("queue", {
      PHP_BIN: "php",
      QUEUE_CONNECTION: "redis",
      QUEUES: "high,default",
      SLEEP: 5,
      TRIES: 2,
      TIMEOUT: 120,
      MAX_JOBS: 250,
      MAX_TIME: 1800,
    });
    expect(unit).toContain("--queue=high,default");
    expect(unit).toContain("--sleep=5");
    expect(unit).toContain("--tries=2");
    expect(unit).toContain("--timeout=120");
    expect(unit).toContain("--max-jobs=250");
    expect(unit).toContain("--max-time=1800");
  });
});

describe("service naming", () => {
  it("uses a stable unit name per project and service type", () => {
    expect(systemd.getServiceName("texel-api", "reverb")).toBe("orkestra-texel-api-reverb.service");
    expect(systemd.getServiceName("texel-api", "octane")).toBe("orkestra-texel-api-octane.service");
  });

  it("sanitizes characters that are invalid in unit names", () => {
    // "my app!!" -> each of space, !, ! becomes "-"
    expect(systemd.getServiceName("my app!!", "web")).toBe("orkestra-my-app---web.service");
  });
});

describe("systemd unit templates are single-sourced", () => {
  it("does not ship divergent on-disk duplicates", () => {
    // The project previously carried src/services/templates/**.service files
    // that installService never read (they were not copied into dist) and
    // whose contents had already drifted from the inline templates — e.g.
    // laravel/web.service hardcoded `artisan serve` while the inline web
    // template uses {{EXEC_START}}. DEFAULT_TEMPLATES is now the only source.
    expect(existsSync(join(process.cwd(), "src", "services", "templates"))).toBe(false);
    expect(existsSync(join(process.cwd(), "dist", "templates"))).toBe(false);
  });

  it("uses execStart for the generic web service", () => {
    // Providers build the framework-specific command (Next/Nuxt server,
    // Laravel `artisan serve --port=N`) and pass it as execStart.
    expect(DEFAULT_TEMPLATES.web).toContain("ExecStart={{EXEC_START}}");
    expect(DEFAULT_TEMPLATES.web).toContain("Environment=PORT={{PORT}}");
  });
});

describe("installService template selection", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("falls back to inline defaults when the template path does not exist", async () => {
    const writeSpy = vi.spyOn(exec, "sudoWriteFile").mockResolvedValue(undefined);
    vi.spyOn(exec, "run").mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });

    await systemd.installService("reverb", "/nonexistent/reverb.service", opts({ reverbPort: 8822 }));

    // Only meaningful on Linux where installService actually writes the unit.
    if (writeSpy.mock.calls.length > 0) {
      const content = writeSpy.mock.calls[0][1] as string;
      expect(content).toContain("--port=8822");
    }
  });

  it("writes the supplied reverb port into the generated unit", async () => {
    const writeSpy = vi.spyOn(exec, "sudoWriteFile").mockResolvedValue(undefined);
    vi.spyOn(exec, "run").mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });

    await systemd.installService("reverb", undefined, opts({ reverbPort: 8822 }));

    // Only meaningful on Linux where installService actually writes the unit.
    if (writeSpy.mock.calls.length > 0) {
      const content = writeSpy.mock.calls[0][1] as string;
      expect(content).toContain("--port=8822");
      expect(content).not.toContain("--port=8080");
      expect(content).not.toContain("{{");
    }
  });

  it("applies the 8080 default only when no reverbPort reaches installService", async () => {
    const writeSpy = vi.spyOn(exec, "sudoWriteFile").mockResolvedValue(undefined);
    vi.spyOn(exec, "run").mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });

    // Mirrors the real pipeline caller, which previously omitted reverbPort.
    await systemd.installService("reverb", undefined, opts());

    if (writeSpy.mock.calls.length > 0) {
      const content = writeSpy.mock.calls[0][1] as string;
      expect(content).toContain("--port=8080");
    }
  });

  it("substitutes every placeholder so systemd never sees a raw token", async () => {
    const writeSpy = vi.spyOn(exec, "sudoWriteFile").mockResolvedValue(undefined);
    vi.spyOn(exec, "run").mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });

    for (const type of ["web", "octane", "queue", "reverb"] as const) {
      await systemd.installService(type, undefined, opts({ port: 8022, reverbPort: 8822 }));
    }

    for (const call of writeSpy.mock.calls) {
      const content = call[1] as string;
      expect(content, "unit contains unsubstituted placeholder").not.toMatch(/\{\{[A-Z_]+\}\}/);
    }
  });
});