import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../../src/config/loader.js";
import { detectFramework } from "../../src/detection/framework.js";
import * as logger from "../../src/utils/logger.js";

/**
 * `loadConfig` is the root of the silent port-drift chain.
 *
 * It used to wrap everything in one `catch` and return null, so a config that
 * existed but failed validation was indistinguishable from a config that was not
 * there. `commands/up.ts` then did `port = config?.port || framework.port`, so a
 * single bad field sent the project to the framework default with nothing printed.
 *
 * Reproduced with a quoted port, which is an entirely ordinary YAML slip:
 *
 *     port: "8022"  ->  Zod rejects  ->  loadConfig returns null, silently
 *                    ->  up() binds 3000 instead of 8022
 */

let dir: string;
let warn: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ork-cfg-"));
  warn = vi.spyOn(logger.log, "warn").mockImplementation(() => {});
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true }).catch(() => {});
});

const write = (body: string) => writeFile(join(dir, ".orkestra.yml"), body, "utf-8");

const warnings = () => warn.mock.calls.map((c) => String(c[0])).join("\n");

describe("absent config", () => {
  it("returns null and says nothing when there is no file", async () => {
    expect(await loadConfig(dir)).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("invalid config is reported, not swallowed", () => {
  it("rejects a quoted port and names the field", async () => {
    await write('name: texel-api\nport: "8022"\n');

    expect(await loadConfig(dir)).toBeNull();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warnings()).toMatch(/port/);
    // The message must say what is being lost, not merely that parsing failed.
    expect(warnings()).toMatch(/ignored/i);
    expect(warnings()).toMatch(/falling back/i);
  });

  it("reports unparseable YAML separately from a schema violation", async () => {
    await write("name: texel-api\n  bad indent: [\n");

    expect(await loadConfig(dir)).toBeNull();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warnings()).toMatch(/could not parse/i);
    expect(warnings()).toMatch(/ignored/i);
  });

  it("names every offending field, not just the first", async () => {
    await write('name: a\nport: "8022"\nreverbPort: "8822"\n');

    await loadConfig(dir);

    expect(warnings()).toMatch(/port/);
    expect(warnings()).toMatch(/reverbPort/);
  });

  it("rejects an out-of-range application port", async () => {
    await write("name: a\nport: 70000\n");

    expect(await loadConfig(dir)).toBeNull();
    expect(warn).toHaveBeenCalled();
  });

  it("rejects a negative application port", async () => {
    await write("name: a\nport: -1\n");

    expect(await loadConfig(dir)).toBeNull();
    expect(warn).toHaveBeenCalled();
  });

  it("rejects a non-integer application port", async () => {
    await write("name: a\nport: 80.5\n");

    expect(await loadConfig(dir)).toBeNull();
    expect(warn).toHaveBeenCalled();
  });

  it("rejects an out-of-range SSH port", async () => {
    // Regression: remote.port had no bounds at all, so 99999 was accepted and
    // only failed later at the SSH layer.
    await write('name: a\ndeployment:\n  remote:\n    host: example.com\n    path: /srv/a\n    port: 99999\n');

    expect(await loadConfig(dir)).toBeNull();
    expect(warn).toHaveBeenCalled();
  });

  it("still accepts port 22 for SSH, which is privileged but legitimate", async () => {
    // We connect *to* this port, so the privileged range is valid here even
    // though it is rejected for application ports we have to bind.
    await write('name: a\ndeployment:\n  remote:\n    host: example.com\n    path: /srv/a\n    port: 22\n');

    const cfg: any = await loadConfig(dir);

    expect(cfg).not.toBeNull();
    expect(cfg.deployment.remote.port).toBe(22);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("valid config is loaded quietly", () => {
  it("accepts the deployed port and does not warn", async () => {
    await write("name: texel-api\nport: 8022\ndomain: api.texelbd.com\n");

    const cfg: any = await loadConfig(dir);

    expect(cfg.port).toBe(8022);
    expect(cfg.domain).toBe("api.texelbd.com");
    expect(warn).not.toHaveBeenCalled();
  });

  it("accepts a numeric port unquoted, which is the documented form", async () => {
    await write("name: texel-api\nport: 8022\n");

    const cfg: any = await loadConfig(dir);

    expect(cfg.port).toBe(8022);
    expect(warn).not.toHaveBeenCalled();
  });

  it("accepts services and proxy blocks", async () => {
    await write(
      [
        "name: texel-api",
        "port: 8022",
        "services:",
        "  reverb:",
        "    port: 8822",
        "proxy:",
        "  provider: caddy",
        "  api:",
        "    domain: api.texelbd.com",
        "    port: 8022",
      ].join("\n"),
    );

    const cfg: any = await loadConfig(dir);

    expect(cfg.services.reverb.port).toBe(8822);
    expect(cfg.proxy.api.port).toBe(8022);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("the drift this prevents, end to end", () => {
  it("a quoted port no longer silently sends the project to the framework default", async () => {
    // Same fixture as the bug report: a Next.js project whose .orkestra.yml asks
    // for 8022 but quotes it.
    await write('name: texel-api\nport: "8022"\ndomain: api.texelbd.com\n');
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({ name: "texel-api", scripts: { dev: "next dev --port 3000" } }),
      "utf-8",
    );

    const cfg: any = await loadConfig(dir);
    const fw: any = await detectFramework(dir);
    // Exactly the expression from commands/up.ts.
    const boundPort = cfg?.port || fw?.port;

    expect(cfg).toBeNull();
    expect(boundPort).toBe(3000);

    // The behaviour is unchanged — callers still degrade — but it is no longer
    // silent, which is the whole point: the operator is told their config was
    // dropped instead of wondering why the port moved.
    expect(warn).toHaveBeenCalled();
    expect(warnings()).toMatch(/port/);
  });
});