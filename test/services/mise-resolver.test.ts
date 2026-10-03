import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { resolveBinaries, BinaryResolutionError } from "../../src/services/mise-resolver.js";
import * as exec from "../../src/utils/exec.js";

/**
 * `php` and `composer` paths are baked into systemd units as `ExecStart`. When
 * resolution silently degraded to a bare command name, systemd ran the service
 * with a minimal PATH and either failed to start or picked up a different
 * system PHP than the project targets — with the deploy still reporting
 * success. These tests pin the fail-loud behaviour.
 */

interface RunCall {
  cmd: string;
  args: string[];
}

/** Records every `run` invocation and answers mise/system lookups from a table. */
function harness(opts: {
  miseAvailable: boolean;
  miseWhich?: Record<string, { ok: boolean; out?: string; err?: string }>;
  systemPath?: Record<string, string>;
}) {
  const calls: RunCall[] = [];

  vi.spyOn(exec, "isCommandAvailable").mockImplementation(
    async (cmd: string) => (cmd === "mise" ? opts.miseAvailable : true),
  );

  vi.spyOn(exec, "run").mockImplementation(async (cmd: string, args: string[] = []) => {
    calls.push({ cmd, args });

    if (cmd === "mise" && args[0] === "trust") {
      return { stdout: "", stderr: "", exitCode: 0 };
    }

    if (cmd === "mise" && args[0] === "which") {
      const tool = args[1];
      const r = opts.miseWhich?.[tool];
      if (!r || !r.ok) {
        return {
          stdout: "",
          stderr: r?.err ?? `${tool} is a mise bin however it is not currently active`,
          exitCode: 1,
        };
      }
      return { stdout: `${r.out ?? `/mise/installs/${tool}/8.4/bin/${tool}`}\n`, stderr: "", exitCode: 0 };
    }

    return { stdout: "", stderr: "", exitCode: 0 };
  });

  vi.spyOn(exec, "which").mockImplementation(
    async (cmd: string) => opts.systemPath?.[cmd] ?? "",
  );

  return calls;
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const ALL_OK: Record<string, { ok: boolean; out?: string }> = {
  php: { ok: true },
  composer: { ok: true },
  node: { ok: true },
  bun: { ok: true },
  pnpm: { ok: true },
  yarn: { ok: true },
  npm: { ok: true },
};

describe("binary resolution", () => {
  it("returns mise paths for every tool when mise resolves them", async () => {
    harness({ miseAvailable: true, miseWhich: ALL_OK });

    const result = await resolveBinaries("/srv/app");

    expect(result.isMise).toBe(true);
    expect(result.php).toBe("/mise/installs/php/8.4/bin/php");
    expect(result.composer).toBe("/mise/installs/composer/8.4/bin/composer");
  });

  it("trusts the project directory so a project mise.toml is honoured", async () => {
    const calls = harness({ miseAvailable: true, miseWhich: ALL_OK });

    await resolveBinaries("/srv/app");

    // Without this, `mise which` reports project tools as inactive.
    expect(calls.some((c) => c.cmd === "mise" && c.args[0] === "trust" && c.args[1] === "/srv/app")).toBe(true);
  });

  it("can be told not to trust the project directory", async () => {
    const calls = harness({ miseAvailable: true, miseWhich: ALL_OK });

    await resolveBinaries("/srv/app", { trustProject: false });

    expect(calls.some((c) => c.cmd === "mise" && c.args[0] === "trust")).toBe(false);
  });

  it("throws instead of degrading to a bare php when mise cannot resolve it", async () => {
    harness({
      miseAvailable: true,
      miseWhich: { ...ALL_OK, php: { ok: false } },
      systemPath: { php: "/usr/bin/php" },
    });

    await expect(resolveBinaries("/srv/app")).rejects.toThrow(BinaryResolutionError);
  });

  it("names the tool and the mismatch in the error", async () => {
    harness({
      miseAvailable: true,
      miseWhich: { ...ALL_OK, php: { ok: false } },
      systemPath: { php: "/usr/bin/php" },
    });

    await expect(resolveBinaries("/srv/app")).rejects.toThrow(
      /php.*mise which php.*\/usr\/bin\/php/s,
    );
  });

  it("throws when neither mise nor the system can supply php", async () => {
    harness({ miseAvailable: true, miseWhich: { ...ALL_OK, php: { ok: false } }, systemPath: {} });

    await expect(resolveBinaries("/srv/app")).rejects.toThrow(/no php was found on the system PATH/);
  });

  it("throws when mise is absent and php is not installed", async () => {
    harness({ miseAvailable: false, systemPath: { node: "/usr/bin/node" } });

    await expect(resolveBinaries("/srv/app")).rejects.toThrow(BinaryResolutionError);
  });

  it("throws for composer too, since its path is baked into build steps", async () => {
    harness({
      miseAvailable: true,
      miseWhich: { ...ALL_OK, composer: { ok: false } },
      systemPath: {},
    });

    await expect(resolveBinaries("/srv/app")).rejects.toThrow(/composer/);
  });

  it("falls back to the system path for optional tools without throwing", async () => {
    // node/bun/pnpm/yarn/npm are not ExecStart paths, so a missing one is not
    // fatal, but an available one should still be used.
    harness({
      miseAvailable: true,
      miseWhich: { ...ALL_OK, pnpm: { ok: false }, yarn: { ok: false }, npm: { ok: false } },
      systemPath: { pnpm: "/usr/bin/pnpm" },
    });

    const result = await resolveBinaries("/srv/app");
    expect(result.pnpm).toBe("/usr/bin/pnpm");
    expect(result.yarn).toBe("yarn");
    expect(result.npm).toBe("npm");
  });

  it("never returns a bare name for a required tool", async () => {
    harness({ miseAvailable: true, miseWhich: ALL_OK });
    const result = await resolveBinaries("/srv/app");

    expect(result.php).not.toBe("php");
    expect(result.composer).not.toBe("composer");
    expect(result.php.startsWith("/")).toBe(true);
  });

  it("uses the first line only when mise prints several candidates", async () => {
    harness({
      miseAvailable: true,
      miseWhich: { ...ALL_OK, php: { ok: true, out: "/mise/php/8.4/bin/php\n/mise/php/8.3/bin/php" } },
    });

    const result = await resolveBinaries("/srv/app");
    expect(result.php).toBe("/mise/php/8.4/bin/php");
  });

  it("does not leave a partially-resolved toolchain usable", async () => {
    // Guards the original failure mode end to end: a deploy must not proceed
    // with a bare `php` baked into a systemd unit.
    harness({
      miseAvailable: true,
      miseWhich: { ...ALL_OK, php: { ok: false } },
      systemPath: { php: "/usr/bin/php" },
    });

    const outcome = await resolveBinaries("/srv/app").then(
      (r) => ({ ok: true, php: r.php }),
      (e) => ({ ok: false, message: e.message }),
    );

    expect(outcome.ok).toBe(false);
  });
});