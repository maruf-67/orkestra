import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CaddyProxy } from "../../src/providers/proxy/caddy.js";
import * as exec from "../../src/utils/exec.js";

/**
 * The Caddyfile is edited with regular expressions against a root-owned file,
 * so a mistake silently rewrites unrelated domains or leaves duplicates behind.
 * These tests pin the exact matching behaviour.
 *
 * `sudoWriteFile` is redirected to a plain write so the logic under test is
 * exercised without requiring root.
 */

const caddy = new CaddyProxy() as any;

beforeEach(() => {
  vi.spyOn(exec, "sudoWriteFile").mockImplementation(async (filePath: string, content: string) => {
    await writeFile(filePath, content, "utf-8");
  });
  vi.spyOn(exec, "run").mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });
  vi.spyOn(exec, "isCommandAvailable").mockResolvedValue(true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function withCaddyfile(initial: string) {
  const dir = await mkdtemp(join(tmpdir(), "ork-caddy-"));
  const caddyDir = join(dir, "Caddy");
  await mkdir(caddyDir, { recursive: true });
  const caddyfile = join(caddyDir, "Caddyfile");
  await writeFile(caddyfile, initial, "utf-8");

  caddy.getConfigPath = () => caddyfile;
  caddy.reload = async () => {};

  return { caddyfile, dir };
}

async function written(caddyfile: string) {
  return readFile(caddyfile, "utf-8");
}

describe("Caddy domain matching", () => {
  it("matches a bare domain block", () => {
    expect(caddy.hasDomain("api.texelbd.com {\n  reverse_proxy localhost:8022\n}\n", "api.texelbd.com")).toBe(true);
  });

  it("matches an http:// prefixed block", () => {
    expect(caddy.hasDomain("http://api.texelbd.com {\n  reverse_proxy localhost:8022\n}\n", "api.texelbd.com")).toBe(true);
  });

  it("matches an https:// prefixed block", () => {
    expect(caddy.hasDomain("https://api.texelbd.com {\n  reverse_proxy localhost:8022\n}\n", "api.texelbd.com")).toBe(true);
  });

  it("matches with leading whitespace", () => {
    expect(caddy.hasDomain("   api.texelbd.com {\n  reverse_proxy localhost:8022\n}\n", "api.texelbd.com")).toBe(true);
  });

  it("does not match a different domain", () => {
    const config = "api.texelbd.com {\n  reverse_proxy localhost:8022\n}\n";
    expect(caddy.hasDomain(config, "reverb.texelbd.com")).toBe(false);
  });

  it("does not treat a domain as a prefix match of a longer domain", () => {
    // Regression: naive substring matching would rewrite `texelbd.com` when
    // registering `texelbd.com` while `api.texelbd.com` exists, and vice versa.
    const config = "api.texelbd.com {\n  reverse_proxy localhost:8022\n}\n";
    expect(caddy.hasDomain(config, "texelbd.com")).toBe(false);
  });

  it("escapes regex metacharacters in the domain", () => {
    // A domain containing a dot must not act as a wildcard.
    const config = "my.app.example.com {\n  reverse_proxy localhost:3000\n}\n";
    expect(caddy.hasDomain(config, "myXapp.example.com")).toBe(false);
  });
});

describe("Caddy block generation", () => {
  it("uses tls internal for .test domains", () => {
    const block = caddy.generateBlock({ domain: "app.test", port: 3000, ssl: true });
    expect(block).toContain("tls internal");
    expect(block).toContain("reverse_proxy localhost:3000");
  });

  it("uses automatic TLS for public domains", () => {
    const block = caddy.generateBlock({ domain: "api.texelbd.com", port: 8022, ssl: true });
    expect(block).toContain("api.texelbd.com {");
    expect(block).toContain("reverse_proxy localhost:8022");
    // Caddy issues a real certificate for public domains, so no `tls internal`.
    expect(block).not.toContain("tls internal");
  });

  it("emits an explicit http:// site block when ssl is disabled", () => {
    const block = caddy.generateBlock({ domain: "app.test", port: 3000, ssl: false });
    expect(block).toContain("http://app.test {");
  });
});

describe("Caddy register idempotency", () => {
  it("updates the port in place without duplicating the block", async () => {
    const { caddyfile } = await withCaddyfile(
      "api.texelbd.com {\n  reverse_proxy localhost:8022\n}\n"
    );

    await caddy.register({ domain: "api.texelbd.com", port: 9000, ssl: true });

    const result = await written(caddyfile);
    expect(result).toContain("reverse_proxy localhost:9000");
    expect(result).not.toContain("8022");
    // Exactly one occurrence of the site header.
    expect(result.match(/api\.texelbd\.com \{/g)).toHaveLength(1);
  });

  it("appends a new domain when absent", async () => {
    const { caddyfile } = await withCaddyfile(
      "api.texelbd.com {\n  reverse_proxy localhost:8022\n}\n"
    );

    await caddy.register({ domain: "reverb.texelbd.com", port: 8822, ssl: true });

    const result = await written(caddyfile);
    expect(result).toContain("api.texelbd.com {");
    expect(result).toContain("reverb.texelbd.com {");
    expect(result).toContain("reverse_proxy localhost:8822");
  });

  it("leaves sibling domains untouched", async () => {
    const { caddyfile } = await withCaddyfile(
      [
        "texelbd.com {",
        "  reverse_proxy localhost:3022",
        "}",
        "",
        "api.texelbd.com {",
        "  reverse_proxy localhost:8022",
        "}",
        "",
        "admin.texelbd.com {",
        "  reverse_proxy localhost:3023",
        "}",
        "",
      ].join("\n")
    );

    await caddy.register({ domain: "api.texelbd.com", port: 9100, ssl: true });

    const result = await written(caddyfile);
    expect(result).toContain("reverse_proxy localhost:3022"); // texelbd.com
    expect(result).toContain("reverse_proxy localhost:3023"); // admin
    expect(result).toContain("reverse_proxy localhost:9100"); // api updated
    expect(result).not.toContain("localhost:8022");
  });

  it("registers multiple domains in one pass", async () => {
    const { caddyfile } = await withCaddyfile("");

    await caddy.registerMultiple([
      { domain: "api.texelbd.com", port: 8022, ssl: true },
      { domain: "reverb.texelbd.com", port: 8822, ssl: true },
      { domain: "texelbd.com", port: 3022, ssl: true },
    ]);

    const result = await written(caddyfile);
    expect(result).toContain("api.texelbd.com {");
    expect(result).toContain("reverb.texelbd.com {");
    expect(result).toContain("texelbd.com {");
    expect(result).toContain("reverse_proxy localhost:8822");
  });

  it("is idempotent across repeated deploys", async () => {
    const { caddyfile } = await withCaddyfile("");

    for (let i = 0; i < 3; i++) {
      await caddy.registerMultiple([
        { domain: "api.texelbd.com", port: 8022, ssl: true },
        { domain: "reverb.texelbd.com", port: 8822, ssl: true },
      ]);
    }

    const result = await written(caddyfile);
    expect(result.match(/api\.texelbd\.com \{/g)).toHaveLength(1);
    expect(result.match(/reverb\.texelbd\.com \{/g)).toHaveLength(1);
  });
});

describe("Caddy unregister", () => {
  it("removes only the requested domain", async () => {
    const { caddyfile } = await withCaddyfile(
      [
        "api.texelbd.com {",
        "  reverse_proxy localhost:8022",
        "}",
        "",
        "texelbd.com {",
        "  reverse_proxy localhost:3022",
        "}",
        "",
      ].join("\n")
    );

    await caddy.unregister("api.texelbd.com");

    const result = await written(caddyfile);
    expect(result).not.toContain("api.texelbd.com");
    expect(result).toContain("texelbd.com {");
    expect(result).toContain("localhost:3022");
  });

  it("leaves the file untouched when the domain is absent", async () => {
    const original = "texelbd.com {\n  reverse_proxy localhost:3022\n}\n";
    const { caddyfile } = await withCaddyfile(original);

    await caddy.unregister("not-present.example.com");

    expect(await written(caddyfile)).toBe(original);
  });

  it("empties the file when the last domain is removed", async () => {
    const { caddyfile } = await withCaddyfile("texelbd.com {\n  reverse_proxy localhost:3022\n}\n");

    await caddy.unregister("texelbd.com");

    expect((await written(caddyfile)).trim()).toBe("");
  });
});