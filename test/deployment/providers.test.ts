import { describe, it, expect } from "vitest";
import { LaravelProvider } from "../../src/deployment/providers/laravel/provider.js";
import { NextjsProvider } from "../../src/deployment/providers/nextjs/provider.js";
import { NuxtProvider } from "../../src/deployment/providers/nuxt/provider.js";
import { providerRegistry } from "../../src/deployment/providers/registry.js";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("Application Providers Architecture", () => {
  it("detects Next.js application with Bun package manager", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "ork-next-bun-"));
    const pkg = {
      name: "my-next-app",
      dependencies: {
        next: "15.1.0",
        react: "^19.0.0",
      },
    };
    await writeFile(join(tmp, "package.json"), JSON.stringify(pkg, null, 2));
    await writeFile(join(tmp, "bun.lockb"), "");

    const provider = new NextjsProvider();
    const detection = await provider.detect(tmp);

    expect(detection).not.toBeNull();
    expect(detection?.framework).toBe("next.js");
    expect(detection?.packageManager).toBe("bun");
    expect(detection?.runtime).toBe("bun");
    expect(detection?.defaultPort).toBe(3000);
  });

  it("detects Nuxt application with pnpm", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "ork-nuxt-pnpm-"));
    const pkg = {
      name: "my-nuxt-app",
      dependencies: {
        nuxt: "^3.15.0",
      },
    };
    await writeFile(join(tmp, "package.json"), JSON.stringify(pkg, null, 2));
    await writeFile(join(tmp, "pnpm-lock.yaml"), "");

    const provider = new NuxtProvider();
    const detection = await provider.detect(tmp);

    expect(detection).not.toBeNull();
    expect(detection?.framework).toBe("nuxt");
    expect(detection?.packageManager).toBe("pnpm");
  });

  it("dynamically resolves provider from registry", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "ork-reg-lar-"));
    const composer = {
      name: "test/laravel",
      require: {
        "laravel/framework": "^11.0",
      },
    };
    await writeFile(join(tmp, "composer.json"), JSON.stringify(composer, null, 2));

    const resolved = await providerRegistry.resolve(tmp);
    expect(resolved).not.toBeNull();
    expect(resolved?.provider.framework).toBe("laravel");
    expect(resolved?.detection.framework).toBe("laravel");
  });
});
