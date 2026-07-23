import { describe, it, expect } from "vitest";
import { validateConfig } from "../../src/config/schema.js";

describe("config schema", () => {
  it("validates a valid config", () => {
    const config = validateConfig({
      name: "my-app",
      framework: "laravel",
      proxy: "caddy",
      runtime: "mise",
      port: 8000,
      domain: "my-app.test",
      ssl: true,
    });

    expect(config.name).toBe("my-app");
    expect(config.proxy).toBe("caddy");
    expect(config.port).toBe(8000);
  });

  it("applies defaults", () => {
    const config = validateConfig({});
    expect(config.proxy).toBe("auto");
    expect(config.runtime).toBe("auto");
    expect(config.ssl).toBe(true);
  });

  it("rejects invalid proxy", () => {
    expect(() =>
      validateConfig({ proxy: "invalid" })
    ).toThrow();
  });

  it("rejects invalid port", () => {
    expect(() =>
      validateConfig({ port: 80 })
    ).toThrow();
  });
});
