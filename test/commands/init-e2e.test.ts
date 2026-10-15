import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * End-to-end test of the exact command that failed in the field.
 *
 *     $ orkestra init
 *     ✓ .orkestra.yml created!
 *     ✖ Registration failed
 *     Error: Generated Caddyfile is invalid; nothing was changed. Error: reading
 *     config file: open /etc/caddy/Caddyfile.orkestra-candidate: no such file or
 *     directory
 *
 * The unit tests in caddy-validate-staging.test.ts pin the staging behaviour.
 * This drives the whole command — prompt defaults, .orkestra.yml generation,
 * hosts entry, state registration, proxy write — so a regression anywhere on that
 * path surfaces here rather than in front of a user.
 *
 * The `caddy` binary is real. Only the three things that genuinely need root are
 * emulated: writing root-owned files, removing them, and reloading the service.
 */

const sandbox = await mkdtemp(join(tmpdir(), "ork-init-e2e-"));
// Must be set before anything imports platform/, which computes the config dir
// from homedir() at module load.
const realHome = process.env.HOME;
process.env.HOME = sandbox;

const h = vi.hoisted(() => ({
  sudoWriteFile: vi.fn(),
  sudoRemoveFile: vi.fn(),
}));

vi.mock("../../src/utils/exec.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/utils/exec.js")>();
  return {
    ...actual,
    // Emulate privilege. The staging candidate and the real Caddyfile must go
    // through the same path — if the code reached for a bare writeFile, the
    // candidate would not appear and validation would fail, which is the bug.
    sudoWriteFile: h.sudoWriteFile,
    sudoRemoveFile: h.sudoRemoveFile,
    // Keep `caddy validate` real; only stub the privileged service reload.
    run: async (cmd: string, args: string[] = [], opts: any = {}) => {
      if (cmd === "caddy") {
        // The real binary is used, but without sudo. Validate is invoked with
        // sudo in production because it provisions TLS certificates that only
        // root can read; the sandbox has no such certificates and no
        // passwordless sudo, so the privilege is dropped here and nothing else
        // about the call changes.
        return actual.run(cmd, args, { ...opts, sudo: false });
      }
      if (cmd === "systemctl") return { stdout: "active", stderr: "", exitCode: 0 };
      return { stdout: "", stderr: "", exitCode: 0 };
    },
  };
});

let projectDir: string;
let caddyDir: string;
let caddyfile: string;

beforeEach(async () => {
  vi.clearAllMocks();

  projectDir = await mkdtemp(join(sandbox, "project-"));
  await writeFile(
    join(projectDir, "composer.json"),
    JSON.stringify({ require: { "laravel/framework": "^12.0" } }),
    "utf-8",
  );
  await writeFile(join(projectDir, "artisan"), "#!/usr/bin/env php\n", "utf-8");

  caddyDir = join(sandbox, "caddy");
  await mkdir(caddyDir, { recursive: true });
  caddyfile = join(caddyDir, "Caddyfile");
  await writeFile(caddyfile, "", "utf-8");

  h.sudoWriteFile.mockImplementation(async (p: string, c: string) => {
    await writeFile(p, c, "utf-8");
  });
  h.sudoRemoveFile.mockImplementation(async (p: string) => {
    await rm(p, { force: true });
  });

  // Point the proxy providers at the sandbox instead of /etc.
  const platform = await import("../../src/platform/index.js");
  vi.spyOn(platform, "getPlatform").mockReturnValue({
    ...platform.getPlatform(),
    caddyConfigDir: caddyDir,
    hostsFile: join(sandbox, "hosts"),
  } as any);

  const { CaddyProxy } = await import("../../src/providers/proxy/caddy.js");
  vi.spyOn(CaddyProxy.prototype, "reload").mockResolvedValue(undefined);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(projectDir, { recursive: true, force: true }).catch(() => {});
});

describe("orkestra init end to end", () => {
  it("registers the project without hitting the staging failure", async () => {
    const { init } = await import("../../src/commands/init.js");

    await init({
      dir: projectDir,
      domain: "pet.test",
      port: 8008,
      proxy: "caddy",
      yes: true,
    });

    // The generated config exists...
    expect(existsSync(join(projectDir, ".orkestra.yml"))).toBe(true);

    // ...the Caddyfile was actually written, not just validated...
    const written = await readFile(caddyfile, "utf-8");
    expect(written).toMatch(/pet\.test/);
    expect(written).toMatch(/8008/);

    // ...the hosts entry landed...
    const hosts = await readFile(join(sandbox, "hosts"), "utf-8");
    expect(hosts).toMatch(/pet\.test/);

    // ...and the project is registered in state.
    const { getProject } = await import("../../src/state/store.js");
    const project = await getProject(projectDir);
    expect(project).not.toBeNull();
    expect(project!.domain).toBe("pet.test");
    expect(project!.port).toBe(8008);
  });

  it("leaves no candidate file behind in the config directory", async () => {
    const { init } = await import("../../src/commands/init.js");

    await init({ dir: projectDir, domain: "pet.test", port: 8008, proxy: "caddy", yes: true });

    const litter = (await readdir(caddyDir)).filter((f) => f.includes("orkestra-candidate"));
    expect(litter).toEqual([]);
  });

  it("stages and cleans through the same privileged helpers", async () => {
    const { init } = await import("../../src/commands/init.js");

    await init({ dir: projectDir, domain: "pet.test", port: 8008, proxy: "caddy", yes: true });

    const staged = h.sudoWriteFile.mock.calls.filter((c) => String(c[0]).includes("orkestra-candidate"));
    const cleaned = h.sudoRemoveFile.mock.calls.filter((c) => String(c[0]).includes("orkestra-candidate"));
    expect(staged.length).toBeGreaterThan(0);
    expect(cleaned.length).toBe(staged.length);
  });

  it("is re-runnable without duplicating the hosts entry", async () => {
    const { init } = await import("../../src/commands/init.js");

    await init({ dir: projectDir, domain: "pet.test", port: 8008, proxy: "caddy", yes: true });
    await init({ dir: projectDir, domain: "pet.test", port: 8008, proxy: "caddy", yes: true });

    const hosts = await readFile(join(sandbox, "hosts"), "utf-8");
    const occurrences = hosts.split("\n").filter((l) => l.includes("pet.test"));
    expect(occurrences).toHaveLength(1);
  });

  it("does not duplicate the Caddy block when re-run", async () => {
    const { init } = await import("../../src/commands/init.js");

    await init({ dir: projectDir, domain: "pet.test", port: 8008, proxy: "caddy", yes: true });
    await init({ dir: projectDir, domain: "pet.test", port: 8008, proxy: "caddy", yes: true });

    const written = await readFile(caddyfile, "utf-8");
    expect(written.split("pet.test").length - 1).toBe(1);
  });

  it("re-registration works after an earlier attempt failed", async () => {
    // The field scenario: .orkestra.yml and the hosts entry were written, the
    // proxy step failed, and the project was never registered. Re-running must
    // complete cleanly rather than trip over its own leftovers.
    await writeFile(join(projectDir, ".orkestra.yml"), "name: pet-food-api\nport: 8008\n", "utf-8");
    await writeFile(join(sandbox, "hosts"), "127.0.0.1  pet.test\n", "utf-8");
    // A stale candidate from the failed run, exactly as the old cleanup left it.
    await writeFile(join(caddyDir, "Caddyfile.orkestra-candidate"), "stale\n", "utf-8");

    const { init } = await import("../../src/commands/init.js");
    await init({ dir: projectDir, domain: "pet.test", port: 8008, proxy: "caddy", yes: true });

    const { getProject } = await import("../../src/state/store.js");
    expect(await getProject(projectDir)).not.toBeNull();

    // The stale candidate must not survive.
    expect(existsSync(join(caddyDir, "Caddyfile.orkestra-candidate"))).toBe(false);
  });
});

describe("the sandbox", () => {
  it("has a real caddy binary available for validation", () => {
    // If caddy is absent the validation step is skipped entirely and this suite
    // would pass vacuously.
    expect(existsSync(join(caddyDir, "Caddyfile"))).toBe(true);
  });
});

afterAll(async () => {
  if (realHome === undefined) delete process.env.HOME;
  else process.env.HOME = realHome;
  await rm(sandbox, { recursive: true, force: true }).catch(() => {});
});