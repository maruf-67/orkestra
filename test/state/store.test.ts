import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { registerProject, unregisterProject, listProjects, loadState } from "../../src/state/store.js";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Mock the platform to use a temp dir
vi.mock("../../src/platform/index.js", () => ({
  getPlatform: () => ({
    hostsFile: "/tmp/hosts",
    shell: "/bin/sh",
    shellArgs: ["-c"],
    configDir: join(tmpdir(), "orkestra-test-state"),
    caddyConfigDir: "/tmp/caddy",
    caddyReloadCmd: ["caddy", "reload"],
    serviceManager: "systemctl",
  }),
  isWindows: () => false,
  isMacOS: () => false,
  isLinux: () => true,
}));

describe("state store", () => {
  beforeEach(async () => {
    const dir = join(tmpdir(), "orkestra-test-state");
    await rm(dir, { recursive: true, force: true });
  });

  afterEach(async () => {
    const dir = join(tmpdir(), "orkestra-test-state");
    await rm(dir, { recursive: true, force: true });
  });

  it("registers and lists a project", async () => {
    await registerProject({
      name: "test-app",
      domain: "test-app.test",
      port: 8000,
      framework: "laravel",
      proxy: "caddy",
      path: "/tmp/test-app",
      registeredAt: new Date().toISOString(),
    });

    const projects = await listProjects();
    expect(projects).toHaveLength(1);
    expect(projects[0].name).toBe("test-app");
    expect(projects[0].domain).toBe("test-app.test");
  });

  it("unregisters a project", async () => {
    await registerProject({
      name: "test-app",
      domain: "test-app.test",
      port: 8000,
      framework: "laravel",
      proxy: "caddy",
      path: "/tmp/test-app",
      registeredAt: new Date().toISOString(),
    });

    await unregisterProject("/tmp/test-app");

    const projects = await listProjects();
    expect(projects).toHaveLength(0);
  });
});
