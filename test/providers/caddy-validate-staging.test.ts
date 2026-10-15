import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, chmod, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CaddyProxy } from "../../src/providers/proxy/caddy.js";
import * as exec from "../../src/utils/exec.js";

/**
 * Regression: `orkestra init` could not register any project.
 *
 *     $ orkestra init
 *     ✓ .orkestra.yml created!
 *     ✖ Registration failed
 *     Error: Generated Caddyfile is invalid; nothing was changed. Error: reading
 *     config file: open /etc/caddy/Caddyfile.orkestra-candidate: no such file
 *     or directory
 *
 * Three bugs compounded. The candidate config was staged with a plain
 * `writeFile` while the real config is written through `sudoWriteFile`;
 * `/etc/caddy` is root-owned, so staging failed with EACCES. That failure was
 * swallowed by `.catch(() => {})`, so `caddy validate` then ran against a file
 * that had never been created, and `writeAndReload` reported the result as an
 * invalid Caddyfile.
 *
 * The existing caddy tests missed all of it because they pointed the config
 * directory at a writable temp dir and stubbed `run` to always succeed — so the
 * permission that makes this fail in production was never simulated. This suite
 * uses a genuinely read-only directory and a faithful `caddy validate` stub that
 * fails when the file it is pointed at does not exist, exactly as caddy does.
 */

const caddy = new CaddyProxy() as any;

/** True when chmod-based permission tests are meaningful (not running as root). */
const canTestPermissions = process.getuid?.() !== 0;

let root: string;
let caddyDir: string;
let caddyfile: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "ork-caddy-stage-"));
  caddyDir = join(root, "Caddy");
  await mkdir(caddyDir, { recursive: true });
  caddyfile = join(caddyDir, "Caddyfile");
  await writeFile(caddyfile, "{\n}\n", "utf-8");

  vi.spyOn(exec, "sudoWriteFile").mockImplementation(async (filePath: string, content: string) => {
    // Deliberately a plain write. In production this is `sudo cp`, and the point
    // is that the candidate must go through the same privileged path as the real
    // config — so the test fails if the code uses bare writeFile instead.
    await writeFile(filePath, content, "utf-8");
  });
  vi.spyOn(exec, "sudoRemoveFile").mockImplementation(async (filePath: string) => {
    await rm(filePath, { force: true });
  });
  vi.spyOn(exec, "isCommandAvailable").mockResolvedValue(true);

  // A faithful `caddy validate`: it reads the file it is given, and fails when
  // that file is absent. This is the behaviour the bug was really up against.
  vi.spyOn(exec, "run").mockImplementation(async (_cmd: string, args: string[] = []) => {
    if (args[0] === "validate") {
      const target = args[args.indexOf("--config") + 1];
      if (!target || !existsSync(target)) {
        return {
          stdout: "",
          stderr: `Error: reading config file: open ${target}: no such file or directory`,
          exitCode: 1,
        };
      }
      return { stdout: "Valid configuration", stderr: "", exitCode: 0 };
    }
    if (args[0] === "is-active") return { stdout: "active", stderr: "", exitCode: 0 };
    return { stdout: "", stderr: "", exitCode: 0 };
  });

  // Point the provider at the temp directory.
  vi.spyOn(caddy, "getConfigPath").mockReturnValue(caddyfile);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await chmod(caddyDir, 0o700).catch(() => {});
  await rm(root, { recursive: true, force: true }).catch(() => {});
});

describe("candidate staging uses the same privileged write as the real config", () => {
  it("stages the candidate with sudoWriteFile, never a bare writeFile", async () => {
    // The root cause. `/etc/caddy` is root-owned; a plain write cannot create
    // anything there.
    const staged = `${caddyfile}.orkestra-candidate`;
    const calls: string[] = [];
    vi.mocked(exec.sudoWriteFile).mockImplementation(async (filePath: string) => {
      calls.push(filePath);
      await writeFile(filePath, "{}\n", "utf-8");
    });

    await caddy.register({ domain: "pet.dev.com", port: 8008, ssl: false });

    expect(calls.some((c) => c.includes("orkestra-candidate"))).toBe(true);
  });

  it("cleans the candidate up with a privileged remove", async () => {
    const removes: string[] = [];
    vi.mocked(exec.sudoRemoveFile).mockImplementation(async (filePath: string) => {
      removes.push(filePath);
    });

    await caddy.register({ domain: "pet.dev.com", port: 8008, ssl: false });

    // A plain unlink cannot remove a file created by `sudo cp`.
    expect(removes.some((r) => r.includes("orkestra-candidate"))).toBe(true);
  });

  it("leaves no candidate file behind on success", async () => {
    await caddy.register({ domain: "pet.dev.com", port: 8008, ssl: false });

    expect(existsSync(`${caddyfile}.orkestra-candidate`)).toBe(false);
  });

  it("leaves no candidate file behind when validation fails", async () => {
    vi.mocked(exec.run).mockImplementation(async (_c: string, args: string[] = []) => {
      if (args[0] === "validate") {
        return { stdout: "", stderr: "Error: parsing caddyfile tokens: unexpected token", exitCode: 1 };
      }
      return { stdout: "active", stderr: "", exitCode: 0 };
    });

    await expect(
      caddy.register({ domain: "pet.dev.com", port: 8008, ssl: false }),
    ).rejects.toThrow();

    expect(existsSync(`${caddyfile}.orkestra-candidate`)).toBe(false);
  });
});

describe.runIf(canTestPermissions)("an unwritable config directory", () => {
  // Reproduces the reported failure exactly: /etc/caddy is root-owned.
  beforeEach(async () => {
    await chmod(caddyDir, 0o500); // r-x: readable, not writable
  });

  it("reports a staging failure, not an invalid Caddyfile", async () => {
    let thrown: Error | undefined;
    try {
      await caddy.register({ domain: "pet.dev.com", port: 8008, ssl: false });
    } catch (err) {
      thrown = err as Error;
    }

    expect(thrown).toBeDefined();

    // The misleading part of the original report.
    expect(thrown!.message).not.toMatch(/Generated Caddyfile is invalid/);
    // It must say what actually went wrong.
    expect(thrown!.message).toMatch(/Could not stage a candidate config/);
    expect(thrown!.message).toMatch(/has not been checked/);
  });

  it("does not blame the config for a permission problem", async () => {
    await expect(
      caddy.register({ domain: "pet.dev.com", port: 8008, ssl: false }),
    ).rejects.toThrow(/not been checked/);
  });

  it("does not modify the live config", async () => {
    const before = await readFile(caddyfile, "utf-8");

    await caddy
      .register({ domain: "pet.dev.com", port: 8008, ssl: false })
      .catch(() => {});

    expect(await readFile(caddyfile, "utf-8")).toBe(before);
  });

  it("never asks caddy to validate a file that does not exist", async () => {
    // With the old code this was the tell: caddy was pointed at a path that was
    // never created, and reported "no such file or directory".
    const validated: string[] = [];
    vi.mocked(exec.run).mockImplementation(async (_c: string, args: string[] = []) => {
      if (args[0] === "validate") {
        const target = args[args.indexOf("--config") + 1];
        validated.push(target ?? "");
        return existsSync(target ?? "")
          ? { stdout: "Valid configuration", stderr: "", exitCode: 0 }
          : { stdout: "", stderr: `open ${target}: no such file or directory`, exitCode: 1 };
      }
      return { stdout: "active", stderr: "", exitCode: 0 };
    });

    await caddy.register({ domain: "pet.dev.com", port: 8008, ssl: false }).catch(() => {});

    // caddy must only ever be pointed at a file that exists.
    expect(validated.length).toBe(0);
  });
});

describe("a writable directory still works", () => {
  it("validates and writes the new block", async () => {
    await caddy.register({ domain: "pet.dev.com", port: 8008, ssl: false });

    const written = await readFile(caddyfile, "utf-8");
    expect(written).toMatch(/pet\.dev\.com/);
    expect(written).toMatch(/8008/);
  });

  it("preserves an unrelated block", async () => {
    await writeFile(caddyfile, "existing.example.com {\n  reverse_proxy localhost:9999\n}\n", "utf-8");

    await caddy.register({ domain: "pet.dev.com", port: 8008, ssl: false });

    const written = await readFile(caddyfile, "utf-8");
    expect(written).toMatch(/existing\.example\.com/);
    expect(written).toMatch(/pet\.dev\.com/);
  });
});