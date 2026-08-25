import { describe, it, expect } from "vitest";
import { detectCapabilities } from "../../src/deployment/detector.js";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("Deployment capability detector", () => {
  it("detects Laravel with Octane and Reverb", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "ork-test-laravel-"));
    const composer = {
      name: "test/laravel-app",
      require: {
        "php": "^8.2",
        "laravel/framework": "^11.0",
        "laravel/octane": "^2.0",
        "laravel/reverb": "^1.0",
      },
    };
    await writeFile(join(tmp, "composer.json"), JSON.stringify(composer, null, 2));
    await writeFile(join(tmp, "artisan"), "#!/usr/bin/env php");
    await writeFile(join(tmp, ".env"), "QUEUE_CONNECTION=redis\nOCTANE_SERVER=roadrunner\n");

    const caps = await detectCapabilities(tmp);

    expect(caps.isLaravel).toBe(true);
    expect(caps.laravelVersion).toBe("^11.0");
    expect(caps.hasOctane).toBe(true);
    expect(caps.octaneServer).toBe("roadrunner");
    expect(caps.hasReverb).toBe(true);
    expect(caps.hasQueue).toBe(true);
    expect(caps.queueConnection).toBe("redis");
  });

  it("detects basic Laravel without Octane/Reverb", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "ork-test-laravel-basic-"));
    const composer = {
      name: "test/basic-laravel",
      require: {
        "laravel/framework": "^10.0",
      },
    };
    await writeFile(join(tmp, "composer.json"), JSON.stringify(composer, null, 2));

    const caps = await detectCapabilities(tmp);

    expect(caps.isLaravel).toBe(true);
    expect(caps.hasOctane).toBe(false);
    expect(caps.hasReverb).toBe(false);
    expect(caps.octaneServer).toBe("none");
  });
});
