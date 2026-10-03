import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectPortFromProject } from "../../src/utils/registration.js";
import * as logger from "../../src/utils/logger.js";

/**
 * Swallowed errors are only acceptable when the failure genuinely does not
 * matter. Two cases where it did:
 *
 *  - A JSON file that exists but cannot be parsed made `detectPortFromProject`
 *    return null, so the caller fell back to a default port. That is silent port
 *    drift, the same failure class as every other port bug fixed so far.
 *  - Failing to gitignore `.orkestra/` means the host-specific port config gets
 *    committed and pushed to every other machine and CI checkout.
 *
 * A file that is simply absent is normal and must stay silent.
 */

let dir: string;
let warn: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ork-catch-"));
  warn = vi.spyOn(logger.log, "warn").mockImplementation(() => {});
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true }).catch(() => {});
});

describe("detectPortFromProject distinguishes absent from corrupt", () => {
  it("stays silent when composer.json simply does not exist", async () => {
    expect(await detectPortFromProject(dir, "laravel")).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it("warns when composer.json exists but is not valid JSON", async () => {
    await writeFile(join(dir, "composer.json"), '{ "require": ', "utf-8");

    expect(await detectPortFromProject(dir, "laravel")).toBeNull();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/Could not parse/);
    expect(warn.mock.calls[0][0]).toMatch(/composer\.json/);
    // The warning must say why it matters, not just that it happened.
    expect(warn.mock.calls[0][0]).toMatch(/fall back to a default/);
  });

  it("warns when package.json is corrupt for a node framework", async () => {
    await writeFile(join(dir, "package.json"), "not json at all", "utf-8");

    expect(await detectPortFromProject(dir, "nuxt")).toBeNull();
    expect(warn).toHaveBeenCalled();
    expect(warn.mock.calls[0][0]).toMatch(/package\.json/);
  });

  it("still reads the port from a valid composer.json", async () => {
    await writeFile(
      join(dir, "composer.json"),
      JSON.stringify({
        scripts: { dev: ["@php artisan serve --port=8022"] },
      }),
      "utf-8",
    );

    expect(await detectPortFromProject(dir, "laravel")).toBe(8022);
    expect(warn).not.toHaveBeenCalled();
  });

  it("still reads the port from a valid package.json dev script", async () => {
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({ scripts: { dev: "next dev --port 3007" } }),
      "utf-8",
    );

    expect(await detectPortFromProject(dir, "next.js")).toBe(3007);
    expect(warn).not.toHaveBeenCalled();
  });

  it("does not warn for a malformed .env, since regex parsing cannot fail", async () => {
    // .env and .rr.yaml are matched with regexes, so the only failure mode is
    // absence — which must stay silent.
    await writeFile(join(dir, "composer.json"), JSON.stringify({ scripts: {} }), "utf-8");
    await writeFile(join(dir, ".env"), "this is not valid env at all\n???\n", "utf-8");

    await detectPortFromProject(dir, "laravel");

    expect(warn).not.toHaveBeenCalled();
  });

  it("prefers the octane port over a reverb port in composer scripts", async () => {
    await writeFile(
      join(dir, "composer.json"),
      JSON.stringify({
        scripts: {
          dev: [
            "php artisan reverb:start --port=8822",
            "php artisan octane:start --server=roadrunner --port=8022",
          ],
        },
      }),
      "utf-8",
    );

    expect(await detectPortFromProject(dir, "laravel")).toBe(8022);
  });

  it("handles an empty scripts object without warning", async () => {
    await writeFile(join(dir, "composer.json"), JSON.stringify({}), "utf-8");

    expect(await detectPortFromProject(dir, "laravel")).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it("handles a null scripts value without warning", async () => {
    await writeFile(join(dir, "composer.json"), JSON.stringify({ scripts: null }), "utf-8");

    expect(await detectPortFromProject(dir, "laravel")).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it("tolerates a non-string dev script without warning", async () => {
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({ scripts: { dev: 12345 } }),
      "utf-8",
    );

    expect(await detectPortFromProject(dir, "nuxt")).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });
});