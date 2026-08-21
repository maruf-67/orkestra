import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Mock the platform to use a temp dir
vi.mock("../../src/platform/index.js", () => ({
  getPlatform: () => ({
    hostsFile: "/tmp/hosts",
    shell: "/bin/sh",
    shellArgs: ["-c"],
    configDir: join(tmpdir(), "orkestra-test-registration"),
    caddyConfigDir: "/tmp/caddy",
    caddyReloadCmd: ["caddy", "reload"],
    serviceManager: "systemctl",
  }),
  isWindows: () => false,
  isMacOS: () => false,
  isLinux: () => true,
}));

// Mock external dependencies
vi.mock("../../src/providers/hosts/hosts.js", () => ({
  HostsFileProvider: class {
    async add() {}
    async remove() {}
    async has() { return false; }
  },
}));

vi.mock("../../src/detection/proxy.js", () => ({
  detectProxy: async () => null,
}));

vi.mock("../../src/utils/host-config.js", () => ({
  addAllowedHost: async () => false,
}));

// Import after mocks
import { detectPortFromProject } from "../../src/utils/registration.js";

describe("registration utility", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "orkestra-test-"));
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  describe("detectPortFromProject", () => {
    it("detects port from package.json --port flag", async () => {
      await writeFile(
        join(testDir, "package.json"),
        JSON.stringify({
          scripts: {
            dev: "next dev --port 4000",
          },
        })
      );

      const port = await detectPortFromProject(testDir, "next.js");
      expect(port).toBe(4000);
    });

    it("detects port from package.json -p flag", async () => {
      await writeFile(
        join(testDir, "package.json"),
        JSON.stringify({
          scripts: {
            dev: "vite -p 5173",
          },
        })
      );

      const port = await detectPortFromProject(testDir, "vite");
      expect(port).toBe(5173);
    });

    it("detects port from package.json PORT= env", async () => {
      await writeFile(
        join(testDir, "package.json"),
        JSON.stringify({
          scripts: {
            dev: "PORT=4000 node server.js",
          },
        })
      );

      const port = await detectPortFromProject(testDir, "node.js");
      expect(port).toBe(4000);
    });

    it("detects port from .env file", async () => {
      await writeFile(join(testDir, ".env"), "PORT=3001\nOTHER=foo\n");

      const port = await detectPortFromProject(testDir, "unknown");
      expect(port).toBe(3001);
    });

    it("detects port from composer.json (Laravel)", async () => {
      await writeFile(
        join(testDir, "composer.json"),
        JSON.stringify({
          scripts: {
            serve: "artisan serve --port=8080",
          },
        })
      );

      const port = await detectPortFromProject(testDir, "laravel");
      expect(port).toBe(8080);
    });

    it("detects port from composer.json octane:start script (Laravel)", async () => {
      await writeFile(
        join(testDir, "composer.json"),
        JSON.stringify({
          scripts: {
            dev: [
              "npx concurrently 'php artisan octane:start --host=0.0.0.0 --port=8005'",
            ],
          },
        })
      );

      const port = await detectPortFromProject(testDir, "laravel");
      expect(port).toBe(8005);
    });

    it("detects port from .rr.yaml (RoadRunner)", async () => {
      await writeFile(
        join(testDir, ".rr.yaml"),
        "version: '3'\nhttp:\n  address: 127.0.0.1:8005\n"
      );

      const port = await detectPortFromProject(testDir, "laravel");
      expect(port).toBe(8005);
    });

    it("returns null when no port found", async () => {
      await writeFile(
        join(testDir, "package.json"),
        JSON.stringify({
          scripts: {
            dev: "next dev",
          },
        })
      );

      const port = await detectPortFromProject(testDir, "next.js");
      expect(port).toBeNull();
    });

    it("returns null for unknown framework with no project files", async () => {
      const port = await detectPortFromProject(testDir, "unknown");
      expect(port).toBeNull();
    });
  });
});
