import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * An MCP client is a language model. Every argument in these calls is text a
 * model produced, which means text that may have been steered by whatever the
 * model was reading — a README, a log file, an issue.
 *
 * The `inputSchema` on each tool was advisory only: it is sent to the client so a
 * model can produce reasonable arguments, but the server took
 * `Record<string, any>` and never checked them. Bad values therefore reached git,
 * systemd and the filesystem, and reported success.
 */

const h = vi.hoisted(() => ({
  systemd: {
    start: vi.fn(),
    stop: vi.fn(),
    restart: vi.fn(),
    reload: vi.fn(),
    getStatus: vi.fn(),
  },
  pipelineExecute: vi.fn(),
  checkoutCommit: vi.fn(),
  installComposerDependencies: vi.fn(),
  optimizeLaravel: vi.fn(),
  detectCapabilities: vi.fn(),
  restartProjectServices: vi.fn(),
  performDeploymentHealthChecks: vi.fn(),
  runSecurityScan: vi.fn(),
  readAudit: vi.fn(),
  auditSummary: vi.fn(),
  readLogs: vi.fn(),
  collectMonitoringSnapshot: vi.fn(),
  listProjects: vi.fn(),
  loadConfig: vi.fn(),
  getProject: vi.fn(),
  resolveBinaries: vi.fn(),
  detectDatabases: vi.fn(),
  getLastSuccessfulDeployment: vi.fn(),
  providerResolve: vi.fn(),
}));

vi.mock("../../src/services/systemd.js", () => ({ systemd: h.systemd }));
vi.mock("../../src/deployment/pipeline.js", () => ({
  deploymentPipeline: { execute: h.pipelineExecute },
}));
vi.mock("../../src/deployment/git.js", () => ({ checkoutCommit: h.checkoutCommit }));
vi.mock("../../src/deployment/composer.js", () => ({
  installComposerDependencies: h.installComposerDependencies,
}));
vi.mock("../../src/deployment/laravel.js", () => ({ optimizeLaravel: h.optimizeLaravel }));
vi.mock("../../src/deployment/detector.js", () => ({ detectCapabilities: h.detectCapabilities }));
vi.mock("../../src/deployment/providers/registry.js", () => ({
  providerRegistry: { resolve: h.providerResolve },
}));
vi.mock("../../src/deployment/health.js", () => ({
  performDeploymentHealthChecks: h.performDeploymentHealthChecks,
}));
vi.mock("../../src/deployment/history.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/deployment/history.js")>();
  return { ...actual, getLastSuccessfulDeployment: h.getLastSuccessfulDeployment };
});
vi.mock("../../src/security/scanner.js", () => ({ runSecurityScan: h.runSecurityScan }));
vi.mock("../../src/security/audit.js", () => ({
  readAudit: h.readAudit,
  auditSummary: h.auditSummary,
}));
vi.mock("../../src/utils/logger-file.js", () => ({ readLogs: h.readLogs }));
vi.mock("../../src/monitoring/collector.js", () => ({
  collectMonitoringSnapshot: h.collectMonitoringSnapshot,
}));
vi.mock("../../src/state/store.js", () => ({
  listProjects: h.listProjects,
  getProject: h.getProject,
}));
vi.mock("../../src/config/loader.js", () => ({ loadConfig: h.loadConfig }));
vi.mock("../../src/services/mise-resolver.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/services/mise-resolver.js")>();
  return { ...actual, resolveBinaries: h.resolveBinaries };
});
vi.mock("../../src/detection/database.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/detection/database.js")>();
  return { ...actual, detectDatabases: h.detectDatabases };
});
vi.mock("../../src/services/manager.js", () => ({
  servicesManager: {
    getProjectServicesStatus: vi.fn(),
    restartProjectServices: h.restartProjectServices,
  },
}));

const { handleMcpToolCall } = await import("../../src/mcp/tools.js");

beforeEach(() => {
  vi.clearAllMocks();
  h.systemd.getStatus.mockResolvedValue("running");
  h.pipelineExecute.mockResolvedValue({ status: "success" });
  h.getLastSuccessfulDeployment.mockResolvedValue({ previousCommit: "abc1234" });
  h.detectCapabilities.mockResolvedValue({
    composerBinary: "composer",
    phpBinary: "php",
    isLaravel: false,
    hasOctane: false,
    hasQueue: false,
    hasReverb: false,
  });
  h.restartProjectServices.mockResolvedValue(undefined);
  h.readLogs.mockReturnValue([]);
  h.runSecurityScan.mockResolvedValue({ ok: true });
  h.readAudit.mockReturnValue([]);
  h.auditSummary.mockResolvedValue({});
  h.collectMonitoringSnapshot.mockResolvedValue({ applications: [] });
  h.listProjects.mockResolvedValue([]);
  h.loadConfig.mockResolvedValue(null);
  h.getProject.mockResolvedValue(null);
  h.resolveBinaries.mockResolvedValue({ php: "php", composer: "composer" });
  h.detectDatabases.mockResolvedValue([]);
  h.providerResolve.mockResolvedValue({
    detection: {
      framework: "nuxt", version: "3", language: "javascript",
      packageManager: "bun", runtime: "node", capabilities: {},
    },
  });
});

describe("orkestra_services_action: the silent no-op", () => {
  // The specific regression: the if/else chain had no `else`, so an
  // unrecognised action performed nothing and still returned a normal-looking
  // payload. A caller asking to "enable" a unit was told it had.
  it("rejects an unrecognised action instead of doing nothing", async () => {
    await expect(
      handleMcpToolCall("orkestra_services_action", {
        serviceName: "orkestra-texel-api-octane.service",
        action: "enable",
      }),
    ).rejects.toThrow(/Invalid action/);
  });

  it("does not touch systemd at all when the action is invalid", async () => {
    await expect(
      handleMcpToolCall("orkestra_services_action", {
        serviceName: "orkestra-texel-api-octane.service",
        action: "delete",
      }),
    ).rejects.toThrow();

    expect(h.systemd.start).not.toHaveBeenCalled();
    expect(h.systemd.stop).not.toHaveBeenCalled();
    expect(h.systemd.restart).not.toHaveBeenCalled();
    expect(h.systemd.reload).not.toHaveBeenCalled();
    expect(h.systemd.getStatus).not.toHaveBeenCalled();
  });

  it("rejects a missing action", async () => {
    await expect(
      handleMcpToolCall("orkestra_services_action", {
        serviceName: "orkestra-texel-api-octane.service",
      }),
    ).rejects.toThrow(/Invalid action/);
  });

  it.each([
    ["start", "start"],
    ["stop", "stop"],
    ["restart", "restart"],
    ["reload", "reload"],
  ])("dispatches %s correctly", async (action, method) => {
    const result = await handleMcpToolCall("orkestra_services_action", {
      serviceName: "orkestra-texel-api-octane.service",
      action,
    });

    expect(h.systemd[method as "start"]).toHaveBeenCalledWith("orkestra-texel-api-octane.service");
    expect(result).toMatchObject({
      serviceName: "orkestra-texel-api-octane.service",
      action,
      currentStatus: "running",
    });
  });

  it("rejects a serviceName that is not a systemd unit name", async () => {
    // This value goes to `sudo systemctl`, so it is constrained at the boundary.
    await expect(
      handleMcpToolCall("orkestra_services_action", {
        serviceName: "caddy; rm -rf /var",
        action: "start",
      }),
    ).rejects.toThrow(/Invalid serviceName/);

    expect(h.systemd.start).not.toHaveBeenCalled();
  });

  it("rejects a bare service name with no .service suffix", async () => {
    await expect(
      handleMcpToolCall("orkestra_services_action", { serviceName: "caddy", action: "start" }),
    ).rejects.toThrow(/Invalid serviceName/);

    expect(h.systemd.start).not.toHaveBeenCalled();
  });
});

describe("orkestra_deploy strategy", () => {
  it("rejects a mistyped strategy rather than silently pulling", async () => {
    // git.ts: anything that is not exactly "reset" took the `git pull` branch.
    await expect(
      handleMcpToolCall("orkestra_deploy", { dir: "/srv/a", strategy: "resset" }),
    ).rejects.toThrow(/Invalid strategy/);

    expect(h.pipelineExecute).not.toHaveBeenCalled();
  });

  it("passes a valid strategy through", async () => {
    await handleMcpToolCall("orkestra_deploy", { dir: "/srv/a", strategy: "pull" });
    expect(h.pipelineExecute.mock.calls[0][0].strategy).toBe("pull");
  });

  it("leaves an omitted strategy undefined rather than guessing", async () => {
    await handleMcpToolCall("orkestra_deploy", { dir: "/srv/a" });
    expect(h.pipelineExecute.mock.calls[0][0].strategy).toBeUndefined();
  });

  it("rejects a relative dir", async () => {
    await expect(
      handleMcpToolCall("orkestra_deploy", { dir: "../../etc" }),
    ).rejects.toThrow(/Invalid dir/);

    expect(h.pipelineExecute).not.toHaveBeenCalled();
  });
});

describe("orkestra_rollback", () => {
  it("rejects a branch name where a commit was expected", async () => {
    await expect(
      handleMcpToolCall("orkestra_rollback", { dir: "/srv/a", toCommit: "main" }),
    ).rejects.toThrow(/Invalid toCommit/);

    // Must never reach `git checkout`.
    expect(h.checkoutCommit).not.toHaveBeenCalled();
  });

  it("rejects a leading dash, which git would read as an option", async () => {
    await expect(
      handleMcpToolCall("orkestra_rollback", { dir: "/srv/a", toCommit: "--orphan" }),
    ).rejects.toThrow(/Invalid toCommit/);

    expect(h.checkoutCommit).not.toHaveBeenCalled();
  });

  it("accepts a real sha and checks it out", async () => {
    const result = await handleMcpToolCall("orkestra_rollback", {
      dir: "/srv/a",
      toCommit: "abc1234",
    });

    expect(h.checkoutCommit).toHaveBeenCalledWith("/srv/a", "abc1234");
    expect(result).toMatchObject({ success: true, rolledBackToCommit: "abc1234" });
  });

  it("still falls back to the last successful deployment", async () => {
    await handleMcpToolCall("orkestra_rollback", { dir: "/srv/a" });
    expect(h.checkoutCommit).toHaveBeenCalledWith("/srv/a", "abc1234");
  });

  it("rejects a relative dir before doing anything", async () => {
    await expect(handleMcpToolCall("orkestra_rollback", { dir: "../.." })).rejects.toThrow(/Invalid dir/);
    expect(h.checkoutCommit).not.toHaveBeenCalled();
    expect(h.installComposerDependencies).not.toHaveBeenCalled();
  });
});

describe("other tools validate their input too", () => {
  it("orkestra_logs rejects a non-positive limit", async () => {
    await expect(handleMcpToolCall("orkestra_logs", { dir: "/srv/a", limit: 0 })).rejects.toThrow(
      /Invalid limit/,
    );
    expect(h.readLogs).not.toHaveBeenCalled();
  });

  it("orkestra_logs defaults to 50 when no limit is given", async () => {
    await handleMcpToolCall("orkestra_logs", { dir: "/srv/a" });
    expect(h.readLogs.mock.calls[0][2]).toMatchObject({ limit: 50 });
  });

  it("orkestra_health_check rejects an out-of-range reverb port", async () => {
    await expect(
      handleMcpToolCall("orkestra_health_check", { reverbPort: 70000 }),
    ).rejects.toThrow(/reverbPort/);

    expect(h.performDeploymentHealthChecks).not.toHaveBeenCalled();
  });

  it("orkestra_health_check accepts a privileged reverb port", async () => {
    await handleMcpToolCall("orkestra_health_check", { reverbPort: 443 });
    expect(h.performDeploymentHealthChecks).toHaveBeenCalled();
  });

  it("orkestra_inspect rejects a relative dir", async () => {
    await expect(handleMcpToolCall("orkestra_inspect", { dir: "app" })).rejects.toThrow(/Invalid dir/);
    expect(h.loadConfig).not.toHaveBeenCalled();
  });

  it("orkestra_security_scan rejects a relative dir", async () => {
    await expect(handleMcpToolCall("orkestra_security_scan", { dir: ".." })).rejects.toThrow(
      /Invalid dir/,
    );
    expect(h.runSecurityScan).not.toHaveBeenCalled();
  });

  it("orkestra_audit_history rejects an unbounded limit", async () => {
    await expect(handleMcpToolCall("orkestra_audit_history", { limit: 100000 })).rejects.toThrow(
      /exceeds the maximum/,
    );
    expect(h.readAudit).not.toHaveBeenCalled();
  });

  it("still rejects an unknown tool name", async () => {
    await expect(handleMcpToolCall("nope", {})).rejects.toThrow(/Unknown MCP tool/);
  });
});