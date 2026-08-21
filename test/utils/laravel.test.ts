import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, readFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { syncLaravelProject } from "../../src/utils/laravel.js";

describe("Laravel project synchronizer", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "orkestra-test-laravel-"));
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("updates octane:start and reverb:start ports in composer.json", async () => {
    const initialComposer = {
      scripts: {
        dev: [
          'Composer\\Config::disableProcessTimeout',
          'npx concurrently "php artisan octane:start --host=0.0.0.0 --port=8000" "php artisan reverb:start --host=0.0.0.0 --port=8080" "pnpm run dev"',
        ],
        "dev:serve": "php artisan octane:start --host=0.0.0.0 --port=8000",
        "dev:reverb": "php artisan reverb:start --host=0.0.0.0 --port=8080",
        serve: "php artisan serve --port=8000",
      },
    };

    await writeFile(
      join(testDir, "composer.json"),
      JSON.stringify(initialComposer, null, 2)
    );

    const result = await syncLaravelProject(testDir, {
      port: 8005,
      reverbPort: 8805,
    });

    expect(result.composerUpdated).toBe(true);

    const updatedRaw = await readFile(join(testDir, "composer.json"), "utf-8");
    const updatedComposer = JSON.parse(updatedRaw);

    expect(updatedComposer.scripts.dev[1]).toContain(
      "php artisan octane:start --host=0.0.0.0 --port=8005"
    );
    expect(updatedComposer.scripts.dev[1]).toContain(
      "php artisan reverb:start --host=0.0.0.0 --port=8805"
    );
    expect(updatedComposer.scripts["dev:serve"]).toBe(
      "php artisan octane:start --host=0.0.0.0 --port=8005"
    );
    expect(updatedComposer.scripts["dev:reverb"]).toBe(
      "php artisan reverb:start --host=0.0.0.0 --port=8805"
    );
    expect(updatedComposer.scripts.serve).toBe(
      "php artisan serve --port=8005"
    );
  });

  it("updates RoadRunner http.address in .rr.yaml", async () => {
    const initialRr = `version: "3"\n\nhttp:\n  address: 127.0.0.1:8000\n  middleware:\n    - sendfile\n`;
    await writeFile(join(testDir, ".rr.yaml"), initialRr);

    const result = await syncLaravelProject(testDir, { port: 8005 });
    expect(result.rrUpdated).toBe(true);

    const updatedRr = await readFile(join(testDir, ".rr.yaml"), "utf-8");
    expect(updatedRr).toContain("address: 127.0.0.1:8005");
  });

  it("updates APP_URL and ports in .env", async () => {
    const initialEnv = `APP_NAME=Laravel\nAPP_URL=http://localhost\nAPP_PORT=8000\nSERVER_PORT=8000\nOCTANE_PORT=8000\n`;
    await writeFile(join(testDir, ".env"), initialEnv);

    const result = await syncLaravelProject(testDir, {
      port: 8005,
      domain: "book.dev.com",
    });

    expect(result.envUpdated).toBe(true);

    const updatedEnv = await readFile(join(testDir, ".env"), "utf-8");
    expect(updatedEnv).toContain("APP_URL=https://book.dev.com");
    expect(updatedEnv).toContain("APP_PORT=8005");
    expect(updatedEnv).toContain("SERVER_PORT=8005");
    expect(updatedEnv).toContain("OCTANE_PORT=8005");
  });

  it("creates or configures pnpm-workspace.yaml when pnpm is used", async () => {
    await writeFile(
      join(testDir, "package.json"),
      JSON.stringify({ packageManager: "pnpm@11.0.0" })
    );
    await writeFile(join(testDir, "pnpm-lock.yaml"), "lockfileVersion: '9.0'");

    const result = await syncLaravelProject(testDir, { port: 8005 });
    expect(result.pnpmWorkspaceUpdated).toBe(true);

    const pnpmWorkspace = await readFile(
      join(testDir, "pnpm-workspace.yaml"),
      "utf-8"
    );
    expect(pnpmWorkspace).toContain("allowBuilds:");
    expect(pnpmWorkspace).toContain("esbuild: true");
    expect(pnpmWorkspace).toContain("onlyBuiltDependencies:");
    expect(pnpmWorkspace).toContain("- esbuild");
  });
});
