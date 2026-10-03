import { describe, it, expect, beforeEach, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Two regressions pinned here.
 *
 * 1. `deploy --dry-run` must always render. Toolchain resolution is strict for a
 *    real deploy, but an unresolvable `php` is exactly what a preview exists to
 *    report, so the preview must not abort on it.
 *
 * 2. A project must keep the port recorded for it. `findAvailablePort` skips
 *    every port in `state.allocatedPorts` unless it is told which project is
 *    asking; three call sites previously omitted that, so a restart could move
 *    an app off its registered port.
 */

const resolveBinaries = vi.hoisted(() => vi.fn());
const providerResolve = vi.hoisted(() => vi.fn());
const getCurrentGitInfo = vi.hoisted(() => vi.fn());

vi.mock("../../src/services/mise-resolver.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/services/mise-resolver.js")>();
  return { ...actual, resolveBinaries };
});
vi.mock("../../src/deployment/providers/registry.js", () => ({
  providerRegistry: { resolve: providerResolve },
}));
vi.mock("../../src/deployment/git.js", () => ({
  syncGitBranch: vi.fn(),
  getCurrentGitInfo,
}));

const { deploymentPipeline } = await import("../../src/deployment/pipeline.js");
const { BinaryResolutionError } = await import("../../src/services/mise-resolver.js");

const PROJECT = "/srv/apps/texel-api";

let projectDir: string;

beforeEach(async () => {
  vi.clearAllMocks();
  projectDir = await mkdtemp(join(tmpdir(), "ork-deploy-"));
  await writeFile(join(projectDir, "composer.json"), JSON.stringify({ require: { "laravel/framework": "^11.0" } }), "utf-8");

  getCurrentGitInfo.mockResolvedValue({ commit: "abc1234", branch: "main" });
  providerResolve.mockResolvedValue({
    provider: {},
    detection: {
      framework: "laravel",
      version: "11",
      packageManager: "bun",
      runtime: "php",
      buildCommand: "composer install",
      startCommand: "php artisan serve",
      capabilities: { hasOctane: true, hasReverb: true, hasQueue: true, octaneServer: "roadrunner" },
    },
  });
  resolveBinaries.mockResolvedValue({
    php: "/mise/php/8.4/bin/php",
    composer: "/mise/composer/bin/composer",
    node: "node",
    bun: "bun",
    pnpm: "pnpm",
    yarn: "yarn",
    npm: "npm",
    isMise: true,
  });
});

describe("deploy --dry-run", () => {
  it("renders a preview even when the toolchain cannot be resolved", async () => {
    resolveBinaries.mockRejectedValue(
      new BinaryResolutionError("php", "mise which php failed", "Run mise install php@8.4"),
    );

    const report = await deploymentPipeline.execute({
      dir: projectDir,
      dryRun: true,
    } as any);

    // The whole point of the fix: a preview is read-only and must not abort.
    expect(report).toBeDefined();
    expect(report.projectPath).toBe(projectDir);
    expect(report.status).toBe("success");
  });

  it("does not touch git when the toolchain is broken", async () => {
    const { syncGitBranch } = await import("../../src/deployment/git.js");
    resolveBinaries.mockRejectedValue(new Error("nope"));

    await deploymentPipeline.execute({ dir: projectDir, dryRun: true } as any);

    expect(syncGitBranch).not.toHaveBeenCalled();
  });

  it("still fails a REAL deploy when the toolchain is unresolvable", async () => {
    resolveBinaries.mockRejectedValue(
      new BinaryResolutionError("php", "mise which php failed", "Run mise install php@8.4"),
    );

    // Strictness must be preserved off the preview path: a bare `php` baked into
    // systemd ExecStart is worse than a refusal.
    //
    // It throws rather than returning a failed report, matching the existing
    // behaviour of other pre-lock failures such as "Could not determine
    // application framework provider". The consequence is that neither is
    // recorded in deploy history — tracked as a follow-up.
    await expect(
      deploymentPipeline.execute({
        dir: projectDir,
        branch: "main",
      } as any),
    ).rejects.toThrow(/php/);
  });

  it("does not run systemd or Caddy during a preview", async () => {
    const systemd = await import("../../src/services/systemd.js");
    const installSpy = vi.spyOn(systemd.systemd, "installService");
    const { CaddyProxy } = await import("../../src/providers/proxy/caddy.js");
    const caddySpy = vi.spyOn(CaddyProxy.prototype, "register");

    await deploymentPipeline.execute({ dir: projectDir, dryRun: true } as any);

    expect(installSpy).not.toHaveBeenCalled();
    expect(caddySpy).not.toHaveBeenCalled();
    installSpy.mockRestore();
    caddySpy.mockRestore();
  });
});

describe("port affinity across call sites", () => {
  it("every findAvailablePort caller supplies the project path", async () => {
    // A structural guard: the drift came from one caller omitting the argument,
    // which no behavioural test would catch if a fourth site were added later.
    const { readFile } = await import("node:fs/promises");
    const files = [
      "src/commands/up.ts",
      "src/commands/start.ts",
      "src/utils/health.ts",
      "src/utils/registration.ts",
    ];
    const root = join(import.meta.dirname, "../..");

    for (const rel of files) {
      const src = await readFile(join(root, rel), "utf-8");
      const calls = [...src.matchAll(/findAvailablePort\(([^)]*)\)/g)];
      for (const call of calls) {
        const args = call[1];
        expect(`${rel}: findAvailablePort(${args})`).toMatch(/,\s*\w/);
      }
    }
  });
});