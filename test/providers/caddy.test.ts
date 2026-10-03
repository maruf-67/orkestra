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
  vi.spyOn(exec, "isCommandAvailable").mockResolvedValue(true);
  // Default: Caddy is running under systemd and every command succeeds, so the
  // real reload path is exercised rather than stubbed out.
  vi.spyOn(exec, "run").mockImplementation(async (_cmd: string, args: string[] = []) => {
    if (args[0] === "is-active") return { stdout: "active", stderr: "", exitCode: 0 };
    return { stdout: "", stderr: "", exitCode: 0 };
  });
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

  return { caddyfile, dir };
}

async function written(caddyfile: string) {
  return readFile(caddyfile, "utf-8");
}

describe("Caddy block matching", () => {
  const range = (config: string, domain: string) => caddy.findBlockRange(config, domain);

  it("matches a bare domain block", () => {
    expect(range("api.texelbd.com {\n  reverse_proxy localhost:8022\n}\n", "api.texelbd.com")).not.toBeNull();
  });

  it("matches an http:// prefixed block", () => {
    expect(range("http://api.texelbd.com {\n  reverse_proxy localhost:8022\n}\n", "api.texelbd.com")).not.toBeNull();
  });

  it("matches an https:// prefixed block", () => {
    expect(range("https://api.texelbd.com {\n  reverse_proxy localhost:8022\n}\n", "api.texelbd.com")).not.toBeNull();
  });

  it("matches with leading whitespace", () => {
    expect(range("   api.texelbd.com {\n  reverse_proxy localhost:8022\n}\n", "api.texelbd.com")).not.toBeNull();
  });

  it("does not match a different domain", () => {
    const config = "api.texelbd.com {\n  reverse_proxy localhost:8022\n}\n";
    expect(range(config, "reverb.texelbd.com")).toBeNull();
  });

  it("does not treat a domain as a prefix match of a longer domain", () => {
    // Regression: naive substring matching would rewrite `texelbd.com` when
    // registering `texelbd.com` while `api.texelbd.com` exists, and vice versa.
    const config = "api.texelbd.com {\n  reverse_proxy localhost:8022\n}\n";
    expect(range(config, "texelbd.com")).toBeNull();
  });

  it("escapes regex metacharacters in the domain", () => {
    const config = "my.app.example.com {\n  reverse_proxy localhost:3000\n}\n";
    expect(range(config, "myXapp.example.com")).toBeNull();
  });

  it("spans a block containing a nested block", () => {
    // The regression that corrupted Caddyfiles: a flat `[^}]*` stopped at the
    // inner `}` and orphaned the remainder of the block.
    const config = [
      "api.texelbd.com {",
      "  tls {",
      "    dns cloudflare",
      "  }",
      "  reverse_proxy localhost:8022",
      "}",
      "",
    ].join("\n");
    const r = range(config, "api.texelbd.com");
    expect(r).not.toBeNull();
    expect(config.slice(r!.start, r!.end)).toBe(
      "api.texelbd.com {\n  tls {\n    dns cloudflare\n  }\n  reverse_proxy localhost:8022\n}\n",
    );
  });

  it("spans several nested blocks", () => {
    const config = [
      "api.texelbd.com {",
      "  encode gzip",
      "  route {",
      "    handle /api/* {",
      "      reverse_proxy localhost:8022",
      "    }",
      "  }",
      "}",
      "",
    ].join("\n");
    const r = range(config, "api.texelbd.com");
    expect(config.slice(r!.start, r!.end).trimEnd().endsWith("}")).toBe(true);
    expect(config.slice(r!.start, r!.end)).toContain("reverse_proxy localhost:8022");
  });

  it("is not confused by a brace inside a quoted matcher", () => {
    const config = [
      'api.texelbd.com {',
      '  @blocked expression {header}Match "*"',
      '  reverse_proxy localhost:8022',
      '}',
      '',
    ].join('\n');
    const r = range(config, "api.texelbd.com");
    expect(config.slice(r!.start, r!.end)).toContain("reverse_proxy localhost:8022");
    expect(config.slice(r!.start, r!.end).trimEnd().endsWith("}")).toBe(true);
  });

  it("stops at the matching close, not the next site block", () => {
    const config = [
      "api.texelbd.com {",
      "  reverse_proxy localhost:8022",
      "}",
      "",
      "reverb.texelbd.com {",
      "  reverse_proxy localhost:8822",
      "}",
      "",
    ].join("\n");
    const r = range(config, "api.texelbd.com");
    const slice = config.slice(r!.start, r!.end);
    expect(slice).not.toContain("reverb");
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

  it("preserves a nested block and produces a balanced Caddyfile", async () => {
    // Regression: rewriting a domain whose block contained a nested `tls { }`
    // matched only up to the inner `}` and left the rest of the block orphaned.
    //
    // The orphan is not merely untidy. Verified against the real caddy binary,
    // the truncated file adapts to a config that listens on the application's
    // own port:
    //
    //   OLD: listen [':443'] hosts ['api.texelbd.com', 'reverse_proxy']
    //        listen [':8022'] hosts ['localhost']      <- steals the app port
    //   NEW: listen [':443'] hosts ['api.texelbd.com']
    //
    // So a single deploy of a domain with a nested block could make Caddy
    // compete with the application for its port.
    const { caddyfile } = await withCaddyfile(
      [
        "api.texelbd.com {",
        "  tls {",
        "    dns cloudflare",
        "  }",
        "  reverse_proxy localhost:8022",
        "}",
        "",
      ].join("\n")
    );

    await caddy.register({ domain: "api.texelbd.com", port: 9000, ssl: true });

    const result = await written(caddyfile);
    // Balanced braces is the property that matters: every { has a }. Counted
    // with a real brace match, not an escaped literal that would always be 0.
    const opens = (result.match(/{/g) ?? []).length;
    const closes = (result.match(/}/g) ?? []).length;
    expect(opens).toBeGreaterThan(0);
    expect(opens).toBe(closes);

    // The nested block was replaced wholesale, not truncated at the inner
    // brace, so nothing from the original block survives. In particular no
    // stray top-level directive remains to be reinterpreted as a site address.
    expect(result).not.toContain("dns cloudflare");
    expect(result).not.toContain("localhost:8022");
    expect(result).toContain("reverse_proxy localhost:9000");
  });

  it("leaves hand-written nested blocks on other domains untouched", async () => {
    const { caddyfile } = await withCaddyfile(
      [
        "texelbd.com {",
        "  encode gzip",
        "  reverse_proxy localhost:3022 {",
        "    header_up X-Real-IP {remote_host}",
        "  }",
        "}",
        "",
        "api.texelbd.com {",
        "  reverse_proxy localhost:8022",
        "}",
        "",
      ].join("\n")
    );

    await caddy.register({ domain: "api.texelbd.com", port: 9100, ssl: true });

    const result = await written(caddyfile);
    expect(result).toContain("header_up X-Real-IP {remote_host}");
    expect(result).toContain("encode gzip");
    expect(result).toContain("reverse_proxy localhost:3022");
    expect(result).toContain("reverse_proxy localhost:9100");
    expect((result.match(/{/g) ?? []).length).toBe((result.match(/}/g) ?? []).length);
  });
});

describe("Caddy reload safety", () => {
  it("throws and leaves the file untouched when validation fails", async () => {
    const original = "api.texelbd.com {\\n  reverse_proxy localhost:8022\\n}\\n";
    const { caddyfile } = await withCaddyfile(original);

    vi.mocked(exec.run).mockResolvedValue({
      stdout: "",
      stderr: "caddy: Error: adapting config: unrecognized directive",
      exitCode: 1,
    });

    await expect(
      caddy.register({ domain: "api.texelbd.com", port: 9000, ssl: true })
    ).rejects.toThrow(/invalid/i);

    // Nothing was written: validation runs before the write.
    expect(await written(caddyfile)).toBe(original);
  });

  it("restores the previous config when reload fails", async () => {
    const original = "api.texelbd.com {\\n  reverse_proxy localhost:8022\\n}\\n";
    const { caddyfile } = await withCaddyfile(original);

    // Fail only the reload, by inspecting the arguments. Keying off call order is
    // brittle because reload() probes `systemctl is-active caddy` first.
    let reloads = 0;
    vi.mocked(exec.run).mockImplementation(async (_cmd: string, args?: string[]) => {
      if (Array.isArray(args) && args.includes("reload")) {
        reloads++;
        // The first reload fails; the rollback reload succeeds.
        if (reloads === 1) return { stdout: "", stderr: "reload exploded", exitCode: 1 };
      }
      return { stdout: "", stderr: "", exitCode: 0 };
    });

    await expect(
      caddy.register({ domain: "api.texelbd.com", port: 9000, ssl: true })
    ).rejects.toThrow(/reload failed/i);

    expect(await written(caddyfile)).toBe(original);
  });

  it("does not leave a staged candidate file behind", async () => {
    const { caddyfile, dir } = await withCaddyfile("");

    await caddy.register({ domain: "api.texelbd.com", port: 8022, ssl: true });

    const { readdir } = await import("node:fs/promises");
    const files = await readdir(dir + "/Caddy");
    expect(files.filter((f) => f.includes("orkestra-candidate"))).toHaveLength(0);
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