import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * The deployment pipeline is the one file where a silent regression breaks a
 * live server, and until now it had almost no coverage. Every step is exercised
 * here through its real control flow; only the side-effecting edges (systemd,
 * Caddy, the provider, git) are mocked.
 *
 * The deploy lock is deliberately NOT mocked — it is a real file under the
 * project directory, so the stale-lock case is tested for real rather than
 * against a stub.
 */

const h = vi.hoisted(() => ({
  syncGitBranch: vi.fn(),
  getCurrentGitInfo: vi.fn(),
  resolveBinaries: vi.fn(),
  loadConfig: vi.fn(),
  getProject: vi.fn(),
  registerProject: vi.fn(),
  saveDeploymentReport: vi.fn(),
  performDeploymentHealthChecks: vi.fn(),
  installService: vi.fn(),
  getServiceName: vi.fn(),
  restartManyAndVerify: vi.fn(),
  journal: vi.fn(),
  caddyDetect: vi.fn(),
  caddyRegisterMultiple: vi.fn(),
  providerResolve: vi.fn(),
  provider: {
    installDependencies: vi.fn(),
    prepare: vi.fn(),
    build: vi.fn(),
    services: vi.fn(),
    proxy: vi.fn(),
    healthChecks: vi.fn(),
  },
}));

vi.mock("../../src/deployment/git.js", () => ({
  syncGitBranch: h.syncGitBranch,
  getCurrentGitInfo: h.getCurrentGitInfo,
}));

vi.mock("../../src/services/mise-resolver.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/services/mise-resolver.js")>();
  return { ...actual, resolveBinaries: h.resolveBinaries };
});

vi.mock("../../src/config/loader.js", () => ({ loadConfig: h.loadConfig }));

vi.mock("../../src/state/store.js", () => ({
  getProject: h.getProject,
  registerProject: h.registerProject,
}));

vi.mock("../../src/deployment/history.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/deployment/history.js")>();
  return { ...actual, saveDeploymentReport: h.saveDeploymentReport };
});

vi.mock("../../src/deployment/health.js", () => ({
  performDeploymentHealthChecks: h.performDeploymentHealthChecks,
}));

vi.mock("../../src/services/systemd.js", () => ({
  systemd: {
    installService: h.installService,
    getServiceName: h.getServiceName,
    restartManyAndVerify: h.restartManyAndVerify,
    journal: h.journal,
  },
}));

vi.mock("../../src/providers/proxy/caddy.js", () => ({
  CaddyProxy: class {
    detect = h.caddyDetect;
    registerMultiple = h.caddyRegisterMultiple;
  },
}));

vi.mock("../../src/deployment/providers/registry.js", () => ({
  providerRegistry: { resolve: h.providerResolve },
}));

const { deploymentPipeline } = await import("../../src/deployment/pipeline.js");

let projectDir: string;

const SERVICES = [
  { type: "octane" as const, port: 8022, command: "php artisan octane:start", octaneServer: "roadrunner", maxRequests: 500 },
  { type: "queue" as const, port: 8022, command: "php artisan queue:work", queueConnection: "redis", queues: "default", queueSleep: 3, queueTries: 3, queueTimeout: 90, queueMaxJobs: 500, queueMaxTime: 3600 },
  { type: "reverb" as const, port: 8822, command: "php artisan reverb:start" },
];

const PROXY = [
  { domain: "api.texelbd.com", port: 8022, ssl: true },
  { domain: "reverb.texelbd.com", port: 8822, ssl: true, websocket: true },
];

beforeEach(async () => {
  vi.clearAllMocks();

  projectDir = await mkdtemp(join(tmpdir(), "ork-pipe-"));
  await writeFile(join(projectDir, "composer.json"), '{"require":{"laravel/framework":"^11.0"}}', "utf-8");

  h.getCurrentGitInfo.mockResolvedValue({ commit: "aaaaaaa1111", branch: "main" });
  h.syncGitBranch.mockResolvedValue({ currentCommit: "bbbbbbb2222", previousCommit: "aaaaaaa1111" });
  h.resolveBinaries.mockResolvedValue({
    php: "/mise/php/8.4/bin/php",
    composer: "/mise/composer/bin/composer",
    node: "node", bun: "bun", pnpm: "pnpm", yarn: "yarn", npm: "npm",
    isMise: true,
  });
  h.loadConfig.mockResolvedValue({ name: "texel-api", port: 8022, reverbPort: 8822 });
  h.getProject.mockResolvedValue(null);
  h.registerProject.mockResolvedValue(undefined);
  h.saveDeploymentReport.mockResolvedValue("/tmp/report.json");

  h.providerResolve.mockResolvedValue({
    provider: h.provider,
    detection: {
      framework: "laravel", version: "11", packageManager: "bun", runtime: "php",
      buildCommand: "composer install", startCommand: "php artisan serve",
      capabilities: { hasOctane: true, hasReverb: true, hasQueue: true, octaneServer: "roadrunner" },
    },
  });

  h.provider.installDependencies.mockResolvedValue({ durationMs: 1200 });
  h.provider.prepare.mockResolvedValue(undefined);
  h.provider.build.mockResolvedValue({ durationMs: 3400 });
  h.provider.services.mockResolvedValue(SERVICES);
  h.provider.proxy.mockResolvedValue(PROXY);
  h.provider.healthChecks.mockResolvedValue([
    { apiUrl: "http://127.0.0.1:8022/up" },
    { domain: "reverb.texelbd.com", port: 8822 },
  ]);

  h.installService.mockResolvedValue("orkestra-texel-api-octane.service");
  h.getServiceName.mockImplementation((name: string, type: string) => `orkestra-${name}-${type}.service`);
  h.restartManyAndVerify.mockResolvedValue(["active", "active", "active"]);
  h.journal.mockResolvedValue("");

  h.caddyDetect.mockResolvedValue(true);
  h.caddyRegisterMultiple.mockResolvedValue(undefined);

  h.performDeploymentHealthChecks
    .mockResolvedValueOnce({ overallHealthy: true })
    .mockResolvedValueOnce({ overallHealthy: true });
});

afterEach(async () => {
  await rm(projectDir, { recursive: true, force: true }).catch(() => {});
});

const run = (overrides: Record<string, unknown> = {}) =>
  deploymentPipeline.execute({ dir: projectDir, branch: "main", ...overrides } as any);

const lockPath = () => join(projectDir, ".orkestra", "deploy.lock");

describe("happy path", () => {
  it("runs all eight steps and reports success", async () => {
    const report = await run();

    expect(report.status).toBe("success");
    expect(h.provider.installDependencies).toHaveBeenCalled();
    expect(h.provider.prepare).toHaveBeenCalled();
    expect(h.provider.build).toHaveBeenCalled();
    expect(h.provider.services).toHaveBeenCalled();
    expect(h.caddyRegisterMultiple).toHaveBeenCalled();
    expect(h.performDeploymentHealthChecks).toHaveBeenCalledTimes(2);
  });

  it("records every step with a success status", async () => {
    const report = await run();
    const names = report.steps.map((s) => s.name);

    expect(names).toContain("lock");
    expect(names).toContain("git");
    expect(names).toContain("dependencies");
    expect(names).toContain("prepare");
    expect(names).toContain("build");
    expect(names).toContain("services");
    expect(names).toContain("proxy");
    expect(names).toContain("health");

    expect(report.steps.every((s) => s.status === "success")).toBe(true);
  });

  it("forwards the resolved binaries to the units", async () => {
    await run();
    const opts = h.installService.mock.calls[0][2];
    expect(opts.phpBinary).toBe("/mise/php/8.4/bin/php");
    expect(opts.projectPath).toBe(projectDir);
  });

  it("passes the Reverb port through instead of letting it default to 8080", async () => {
    // Regression guard for the original bug: the reverb unit rendered
    // {{REVERB_PORT}} while nothing supplied it, so it fell back to 8080.
    await run();
    const reverbCall = h.installService.mock.calls.find((c) => c[0] === "reverb");
    expect(reverbCall).toBeDefined();
    expect(reverbCall![2].reverbPort).toBe(8822);
  });

  it("passes the Octane port only to the octane unit", async () => {
    await run();
    for (const call of h.installService.mock.calls) {
      const [type, , opts] = call;
      if (type === "octane") expect(opts.octanePort).toBe(8022);
      else expect(opts.octanePort).toBeUndefined();
    }
  });

  it("registers the project with the websocket endpoint", async () => {
    await run();
    const arg = h.registerProject.mock.calls[0][0];
    expect(arg.domain).toBe("api.texelbd.com");
    expect(arg.port).toBe(8022);
    expect(arg.reverbPort).toBe(8822);
    expect(arg.reverbDomain).toBe("reverb.texelbd.com");
    expect(arg.proxy).toBe("caddy");
  });

  it("releases the lock on success", async () => {
    await run();
    expect(existsSync(lockPath())).toBe(false);
  });

  it("writes a deployment report", async () => {
    await run();
    expect(h.saveDeploymentReport).toHaveBeenCalledTimes(1);
    expect(h.saveDeploymentReport.mock.calls[0][0].status).toBe("success");
  });
});

describe("deploy lock", () => {
  it("aborts when a lock already exists, without touching anything", async () => {
    // A real stale lock file, not a stub: the lock is the one piece of pipeline
    // state worth exercising for real.
    await mkdir(join(projectDir, ".orkestra"), { recursive: true });
    await writeFile(lockPath(), '{"pid":999,"startedAt":"2026-01-01T00:00:00Z"}', "utf-8");

    const report = await run();

    expect(report.status).toBe("aborted");
    expect(report.error).toMatch(/locked/i);
    expect(h.syncGitBranch).not.toHaveBeenCalled();
    expect(h.provider.build).not.toHaveBeenCalled();
  });

  it("leaves the pre-existing lock file intact", async () => {
    await mkdir(join(projectDir, ".orkestra"), { recursive: true });
    await writeFile(lockPath(), "STALE", "utf-8");

    await run();

    // Aborting must not delete a lock owned by a possibly-live process.
    expect(await readFile(lockPath(), "utf-8")).toBe("STALE");
  });

  it("releases the lock even when a mid-pipeline step fails", async () => {
    h.provider.build.mockRejectedValue(new Error("build exploded"));

    const report = await run();

    expect(report.status).toBe("failed");
    expect(existsSync(lockPath())).toBe(false);
  });

  it("refuses a second concurrent deploy", async () => {
    await mkdir(join(projectDir, ".orkestra"), { recursive: true });
    await writeFile(lockPath(), "{}", "utf-8");

    const first = await run();
    const second = await run();

    expect(first.status).toBe("aborted");
    expect(second.status).toBe("aborted");
  });
});

describe("step failures abort the deploy", () => {
  it("fails when git sync fails", async () => {
    h.syncGitBranch.mockRejectedValue(new Error("non-fast-forward"));
    const report = await run();

    expect(report.status).toBe("failed");
    expect(report.error).toMatch(/non-fast-forward/);
    expect(report.steps.find((s) => s.name === "git")?.status).toBe("failed");
  });

  it("fails when dependency installation fails", async () => {
    h.provider.installDependencies.mockRejectedValue(new Error("lockfile mismatch"));
    const report = await run();

    expect(report.status).toBe("failed");
    expect(h.provider.build).not.toHaveBeenCalled();
  });

  it("fails when preparation fails", async () => {
    h.provider.prepare.mockRejectedValue(new Error("migration failed"));
    const report = await run();

    expect(report.status).toBe("failed");
    expect(report.steps.find((s) => s.name === "prepare")?.status).toBe("failed");
    expect(h.provider.build).not.toHaveBeenCalled();
  });

  it("fails when the build fails", async () => {
    h.provider.build.mockRejectedValue(new Error("tsc error"));
    const report = await run();

    expect(report.status).toBe("failed");
    expect(h.caddyRegisterMultiple).not.toHaveBeenCalled();
  });

  it("fails when a unit cannot be written", async () => {
    h.installService.mockRejectedValue(new Error("systemd write denied"));
    const report = await run();

    expect(report.status).toBe("failed");
    expect(h.caddyRegisterMultiple).not.toHaveBeenCalled();
  });

  it("fails and explains when a unit does not stay up", async () => {
    // The Restart=always crash-loop: systemctl restart succeeds, the unit dies
    // immediately, and the deploy must not claim success.
    h.restartManyAndVerify.mockResolvedValue(["active", "failed", "active"]);
    h.journal.mockResolvedValue("orkestra-texel-api-queue.service: Failed with result 'exit-code'.");

    const report = await run();

    expect(report.status).toBe("failed");
    expect(report.error).toMatch(/did not stay up/i);
    expect(report.error).toMatch(/queue/);
    // The journal excerpt is what makes the failure actionable.
    expect(report.error).toMatch(/exit-code/);
  });

  it("lists every broken unit, not just the first", async () => {
    h.restartManyAndVerify.mockResolvedValue(["failed", "inactive", "active"]);

    const report = await run();

    expect(report.error).toMatch(/2 systemd unit/);
    expect(report.error).toMatch(/octane/);
    expect(report.error).toMatch(/queue/);
  });

  it("fails the deploy when the proxy cannot be written", async () => {
    // Services already restarted against a proxy that was never configured is a
    // broken deploy; it must not be reported as a success.
    h.caddyRegisterMultiple.mockRejectedValue(new Error("caddy validate failed"));
    const report = await run();

    expect(report.status).toBe("failed");
    expect(report.proxy.status).toBe("failed");
  });

  it("fails the deploy when health checks fail", async () => {
    h.performDeploymentHealthChecks.mockReset();
    h.performDeploymentHealthChecks.mockResolvedValue({ overallHealthy: false });

    const report = await run();

    expect(report.status).toBe("failed");
    expect(report.error).toMatch(/health/i);
  });

  it("names which endpoint is unhealthy", async () => {
    // Reset first: beforeEach queues two healthy responses, and mockResolvedValueOnce
    // appends rather than replaces, so without a reset the healthy pair is consumed.
    h.performDeploymentHealthChecks.mockReset();
    h.performDeploymentHealthChecks
      .mockResolvedValueOnce({ overallHealthy: false, apiUrl: "http://127.0.0.1:8022/up" })
      .mockResolvedValueOnce({ overallHealthy: true });

    const report = await run();

    expect(report.error).toMatch(/api http:\/\/127\.0\.0\.1:8022\/up/);
  });

  it("still releases the lock when health checks fail", async () => {
    h.performDeploymentHealthChecks.mockReset();
    h.performDeploymentHealthChecks.mockResolvedValue({ overallHealthy: false });

    await run();

    expect(existsSync(lockPath())).toBe(false);
  });
});

describe("options", () => {
  it("skips service provisioning with --no-restart", async () => {
    const report = await run({ noRestart: true });

    expect(report.status).toBe("success");
    expect(h.installService).not.toHaveBeenCalled();
    expect(report.steps.find((s) => s.name === "services")?.status).toBe("skipped");
  });

  it("skips the proxy when Caddy is not installed", async () => {
    h.caddyDetect.mockResolvedValue(false);
    const report = await run();

    expect(report.status).toBe("success");
    expect(h.caddyRegisterMultiple).not.toHaveBeenCalled();
  });

  it("skips the proxy when the provider declares no proxy endpoints", async () => {
    h.provider.proxy.mockResolvedValue([]);
    const report = await run();

    expect(report.status).toBe("success");
    expect(h.caddyRegisterMultiple).not.toHaveBeenCalled();
  });

  it("does not save a report for a dry run", async () => {
    const report = await run({ dryRun: true });

    expect(report.status).toBe("success");
    expect(h.saveDeploymentReport).not.toHaveBeenCalled();
    expect(h.syncGitBranch).not.toHaveBeenCalled();
  });
});

describe("port preservation across git reset", () => {
  it("keeps the deployed port when the repo default disagrees", async () => {
    // git reset --hard reverts .orkestra.yml to a repo default that may not match
    // what is actually bound on the host. Deployed state must win.
    h.getProject.mockResolvedValue({
      name: "texel-api", domain: "api.texelbd.com", port: 8022,
      reverbPort: 8822, framework: "laravel", proxy: "caddy",
      path: projectDir, registeredAt: "2026-01-01T00:00:00Z",
    });
    h.loadConfig.mockResolvedValue({ name: "texel-api", port: 3000, reverbPort: 3001 });

    const report = await run();

    expect(report.status).toBe("success");
    // The proxy is written with the deployed port, not the reverted repo default.
    const defs = h.caddyRegisterMultiple.mock.calls[0][0];
    expect(defs.find((d: any) => d.domain === "api.texelbd.com").port).toBe(8022);
  });

  it("keeps the deployed reverb port and domain", async () => {
    h.getProject.mockResolvedValue({
      name: "texel-api", domain: "api.texelbd.com", port: 8022,
      reverbPort: 8822, reverbDomain: "reverb.texelbd.com",
      framework: "laravel", proxy: "caddy",
      path: projectDir, registeredAt: "2026-01-01T00:00:00Z",
    });

    await run();

    const arg = h.registerProject.mock.calls[0][0];
    expect(arg.reverbPort).toBe(8822);
    expect(arg.reverbDomain).toBe("reverb.texelbd.com");
  });

  it("falls back to state when the config is missing entirely after reset", async () => {
    h.getProject.mockResolvedValue({
      name: "texel-api", domain: "api.texelbd.com", port: 8022,
      framework: "laravel", proxy: "caddy",
      path: projectDir, registeredAt: "2026-01-01T00:00:00Z",
    });
    h.loadConfig.mockResolvedValue(null);

    const report = await run();

    expect(report.status).toBe("success");
    expect(h.caddyRegisterMultiple).toHaveBeenCalled();
  });

  it("does not consult state for an unregistered project", async () => {
    h.getProject.mockResolvedValue(null);

    const report = await run();

    expect(report.status).toBe("success");
  });
});