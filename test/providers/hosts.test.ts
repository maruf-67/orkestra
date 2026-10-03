import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostsFileProvider, hostnamesInLine, lineMapsDomain } from "../../src/providers/hosts/hosts.js";
import * as exec from "../../src/utils/exec.js";
import { getPlatform } from "../../src/platform/index.js";

/**
 * The hosts file is a root-owned system file. A substring match against the
 * domain would make `texelbd.com` also match `api.texelbd.com`, so registering
 * or removing the apex domain would destroy every subdomain entry. These tests
 * pin exact-name matching.
 */

const provider = new HostsFileProvider();
let hostsFile: string;
let original: string;

beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), "ork-hosts-"));
  hostsFile = join(dir, "hosts");
  original =
    [
      "127.0.0.1   localhost",
      "::1         localhost ip6-localhost ip6-loopback",
      "",
      "127.0.0.1   api.texelbd.com",
      "127.0.0.1   reverb.texelbd.com",
      "",
      "# a comment mentioning texelbd.com",
      "192.168.1.5 workstation.local",
      "",
    ].join("\n");
  await writeFile(hostsFile, original, "utf-8");

  vi.spyOn(exec, "sudoWriteFile").mockImplementation(async (path: string, content: string) => {
    await writeFile(path, content, "utf-8");
  });
  vi.spyOn(getPlatform(), "hostsFile" as never, "get").mockReturnValue(hostsFile as never);
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function current() {
  return readFile(hostsFile, "utf-8");
}

describe("hosts line parsing", () => {
  it("extracts the mapped hostname", () => {
    expect(hostnamesInLine("127.0.0.1   api.texelbd.com")).toEqual(["api.texelbd.com"]);
  });

  it("extracts every alias on the line", () => {
    expect(hostnamesInLine("127.0.0.1 example.com www.example.com")).toEqual([
      "example.com",
      "www.example.com",
    ]);
  });

  it("ignores trailing comments", () => {
    expect(hostnamesInLine("127.0.0.1 app.test # app test")).toEqual(["app.test"]);
  });

  it("treats a comment-only line as mapping nothing", () => {
    expect(hostnamesInLine("# mentions texelbd.com")).toEqual([]);
  });

  it("normalises a trailing dot and case", () => {
    expect(lineMapsDomain("127.0.0.1  API.TexelBD.com.", "api.texelbd.com")).toBe(true);
  });
});

describe("exact subdomain matching", () => {
  it("does not match the apex domain from a subdomain entry", () => {
    expect(lineMapsDomain("127.0.0.1  api.texelbd.com", "texelbd.com")).toBe(false);
  });

  it("does not match a sibling subdomain", () => {
    expect(lineMapsDomain("127.0.0.1  reverb.texelbd.com", "api.texelbd.com")).toBe(false);
  });

  it("does not match a comment that mentions the domain", () => {
    expect(lineMapsDomain("# a comment mentioning texelbd.com", "texelbd.com")).toBe(false);
  });

  it("matches an alias listed on the line", () => {
    expect(lineMapsDomain("127.0.0.1 example.com www.example.com", "www.example.com")).toBe(true);
  });
});

describe("has()", () => {
  it("finds an exact entry", async () => {
    expect(await provider.has("api.texelbd.com")).toBe(true);
  });

  it("does not report the apex as present when only a subdomain is mapped", async () => {
    expect(await provider.has("texelbd.com")).toBe(false);
  });

  it("finds localhost", async () => {
    expect(await provider.has("localhost")).toBe(true);
  });

  it("returns false for an unmapped domain", async () => {
    expect(await provider.has("nope.example.com")).toBe(false);
  });
});

describe("add()", () => {
  it("appends a new mapping", async () => {
    await provider.add("texelbd.com");
    const result = await current();
    expect(result).toContain("127.0.0.1  texelbd.com");
  });

  it("preserves subdomain entries when adding the apex domain", async () => {
    // Regression: substring matching wiped api./reverb. when the apex was added.
    await provider.add("texelbd.com");
    const result = await current();
    expect(result).toContain("127.0.0.1   api.texelbd.com");
    expect(result).toContain("127.0.0.1   reverb.texelbd.com");
  });

  it("is a no-op when the identical mapping already exists", async () => {
    const before = await current();
    await provider.add("api.texelbd.com");
    expect(await current()).toBe(before);
  });

  it("replaces the address when the domain is remapped", async () => {
    await provider.add("api.texelbd.com", "0.0.0.0");
    const result = await current();
    expect(result).toContain("0.0.0.0  api.texelbd.com");
    expect(result).not.toContain("127.0.0.1   api.texelbd.com");
    expect(result).toContain("127.0.0.1   reverb.texelbd.com");
  });

  it("never duplicates the domain", async () => {
    for (let i = 0; i < 5; i++) await provider.add("texelbd.com");
    const lines = (await current()).split("\n").filter((l) => lineMapsDomain(l, "texelbd.com"));
    expect(lines).toHaveLength(1);
  });

  it("keeps unrelated entries such as localhost", async () => {
    await provider.add("texelbd.com");
    const result = await current();
    expect(result).toContain("127.0.0.1   localhost");
    expect(result).toContain("192.168.1.5 workstation.local");
  });
});

describe("remove()", () => {
  it("removes only the requested domain", async () => {
    await provider.remove("api.texelbd.com");
    const result = await current();
    expect(result).not.toContain("api.texelbd.com");
    expect(result).toContain("reverb.texelbd.com");
  });

  it("preserves subdomains when removing the apex domain", async () => {
    // Regression: `remove("texelbd.com")` previously deleted every subdomain.
    await provider.remove("texelbd.com");
    const result = await current();
    expect(result).toContain("api.texelbd.com");
    expect(result).toContain("reverb.texelbd.com");
  });

  it("leaves the file byte-identical when the domain is absent", async () => {
    const before = await current();
    await provider.remove("texelbd.com");
    // remove() always rewrites, but content must be semantically unchanged.
    const after = await current();
    expect(after.replace(/\n+$/, "")).toBe(before.replace(/\n+$/, ""));
    expect(after).toContain("api.texelbd.com");
  });

  it("does not match a domain inside a comment", async () => {
    await provider.remove("texelbd.com");
    expect(await current()).toContain("# a comment mentioning texelbd.com");
  });
});