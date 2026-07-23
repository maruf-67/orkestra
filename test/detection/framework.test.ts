import { describe, it, expect } from "vitest";
import { detectFramework, listFrameworks, listLanguages } from "../../src/detection/framework.js";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("framework detection", () => {
  it("lists supported frameworks", () => {
    const frameworks = listFrameworks();
    expect(frameworks).toContain("laravel");
    expect(frameworks).toContain("next.js");
    expect(frameworks).toContain("nuxt");
    expect(frameworks).toContain("vite");
    expect(frameworks).toContain("express");
    expect(frameworks).toContain("fastapi");
    expect(frameworks).toContain("flask");
    expect(frameworks).toContain("django");
    expect(frameworks).toContain("go");
    expect(frameworks).toContain("rust");
    expect(frameworks).toContain("node.js");
  });

  it("lists supported languages", () => {
    const languages = listLanguages();
    expect(languages).toContain("php");
    expect(languages).toContain("javascript");
    expect(languages).toContain("python");
    expect(languages).toContain("go");
    expect(languages).toContain("rust");
  });

  it("detects Laravel project", async () => {
    const dir = await mkdtemp(join(tmpdir(), "orkestra-test-"));
    await writeFile(
      join(dir, "composer.json"),
      JSON.stringify({ require: { "laravel/framework": "^11.0" } })
    );
    await writeFile(join(dir, "artisan"), "<?php");

    const result = await detectFramework(dir);
    expect(result).not.toBeNull();
    expect(result!.name).toBe("laravel");
    expect(result!.language).toBe("php");

    await rm(dir, { recursive: true });
  });

  it("detects Next.js project", async () => {
    const dir = await mkdtemp(join(tmpdir(), "orkestra-test-"));
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({ dependencies: { next: "^14.0.0" } })
    );

    const result = await detectFramework(dir);
    expect(result).not.toBeNull();
    expect(result!.name).toBe("next.js");

    await rm(dir, { recursive: true });
  });

  it("detects Go project", async () => {
    const dir = await mkdtemp(join(tmpdir(), "orkestra-test-"));
    await writeFile(
      join(dir, "go.mod"),
      "module example.com/myapp\n\ngo 1.22\n"
    );
    await writeFile(join(dir, "main.go"), 'package main\n\nfunc main() {}');

    const result = await detectFramework(dir);
    expect(result).not.toBeNull();
    expect(result!.name).toBe("go");
    expect(result!.language).toBe("go");
    expect(result!.version).toBe("1.22");
    expect(result!.port).toBe(8080);

    await rm(dir, { recursive: true });
  });

  it("detects Rust project", async () => {
    const dir = await mkdtemp(join(tmpdir(), "orkestra-test-"));
    await writeFile(
      join(dir, "Cargo.toml"),
      '[package]\nname = "myapp"\nversion = "0.1.0"\nedition = "21"\n'
    );

    const result = await detectFramework(dir);
    expect(result).not.toBeNull();
    expect(result!.name).toBe("rust");
    expect(result!.language).toBe("rust");

    await rm(dir, { recursive: true });
  });

  it("detects Django project", async () => {
    const dir = await mkdtemp(join(tmpdir(), "orkestra-test-"));
    await writeFile(
      join(dir, "manage.py"),
      '#!/usr/bin/env python\nimport django\nif __name__ == "__main__": pass'
    );

    const result = await detectFramework(dir);
    expect(result).not.toBeNull();
    expect(result!.name).toBe("django");
    expect(result!.language).toBe("python");

    await rm(dir, { recursive: true });
  });

  it("detects generic Python project", async () => {
    const dir = await mkdtemp(join(tmpdir(), "orkestra-test-"));
    await writeFile(join(dir, "requirements.txt"), "requests==2.31.0\n");

    const result = await detectFramework(dir);
    expect(result).not.toBeNull();
    expect(result!.name).toBe("python");
    expect(result!.language).toBe("python");

    await rm(dir, { recursive: true });
  });

  it("detects generic Node.js project", async () => {
    const dir = await mkdtemp(join(tmpdir(), "orkestra-test-"));
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({ name: "my-app", version: "1.0.0" })
    );

    const result = await detectFramework(dir);
    expect(result).not.toBeNull();
    expect(result!.name).toBe("node.js");

    await rm(dir, { recursive: true });
  });

  it("returns null for unknown project", async () => {
    const dir = await mkdtemp(join(tmpdir(), "orkestra-test-"));
    const result = await detectFramework(dir);
    expect(result).toBeNull();
    await rm(dir, { recursive: true });
  });
});
