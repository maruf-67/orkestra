import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * No interpolated `execSync`.
 *
 * 1.0.10 removed the shell from `run()` after finding that
 * `git log -1 --format=%an|||%s` died on `Syntax error: "|" unexpected` — so
 * every deployment had recorded author "unknown" — and that arguments built from
 * project-controlled values (domains, names, paths) were being interpreted by
 * /bin/sh.
 *
 * Five sites had kept the pattern alive by using `execSync` with a template
 * literal instead:
 *
 *   start.ts    execSync(buildCmd + " " + buildArgs.join(" "))
 *   down.ts     execSync(`ps ... --ppid ${pid}`)
 *   down.ts     execSync(`lsof -ti :${project.port}`)
 *   laravel.ts  execSync(`readlink -f /proc/${pid}/cwd 2>/dev/null || true`)
 *   laravel.ts  execSync(`lsof -ti :${port} 2>/dev/null || true`)
 *
 * All five now use `execFileSync` with an argv array, plus integer validation so
 * a malformed pid or port cannot be read as an option by `ps` or `lsof`.
 *
 * `execSync` with a *fixed* string is still fine, and some sites genuinely need
 * a shell for `|| true`. Those are allowed; interpolating a value into one is not.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirWithTypes(d)) {
      const full = join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith(".ts")) out.push(full);
    }
  };
  walk(dir);
  return out;
}

function readdirWithTypes(dir: string) {
  return readdirSync(dir, { withFileTypes: true });
}

const files = [
  ...sourceFiles(join(root, "src")),
  ...sourceFiles(join(root, "test")),
].filter((f) => !f.includes(`${join("test", "fixtures")}`));

/** execSync calls whose argument is a plain string literal, with no interpolation. */
function fixedStringExecSyncCalls(src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(/execSync\(\s*(`[^`]*`|"[^"]*")/g)) {
    out.push(m[1]);
  }
  return out;
}

/**
 * Strip comments before matching.
 *
 * This file quotes every pattern it forbids in order to document them, so a
 * scanner that reads raw text flags its own documentation. A guard has to look
 * at code.
 */
function stripComments(src: string): string {
  return src
    .split("\n")
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .map((l) => {
      const i = l.indexOf("//");
      if (i === -1) return l;
      const quotes = (l.slice(0, i).match(/["'`]/) ?? []).length;
      return quotes % 2 === 0 ? l.slice(0, i) : l;
    })
    .join("\n");
}

/** execSync calls whose argument interpolates something. */
function interpolatedExecSyncCalls(src: string): string[] {
  src = stripComments(src);
  const offenders: string[] = [];
  const lines = src.split("\n");

  lines.forEach((line, i) => {
    if (!/execSync\(/.test(line)) return;
    if (/execFileSync\(/.test(line)) return; // safe: argv, no shell

    // Anything with ${...} or string concatenation is an interpolation.
    const isInterpolated = /execSync\(\s*`[^`]*\$\{/.test(line) || /execSync\([^)]*\+/.test(line);
    if (isInterpolated) {
      offenders.push(`${line.trim()}   (line ${i + 1})`);
    }
  });

  return offenders;
}

describe("no interpolated execSync anywhere", () => {
  it("the file scan found the source tree", () => {
    // Guard against a vacuous pass if the walk breaks.
    expect(files.length).toBeGreaterThan(50);
  });

  it("no execSync call interpolates a value into a shell command", () => {
    const offenders: string[] = [];
    for (const f of files) {
      const rel = f.replace(`${root}/`, "");
      for (const bad of interpolatedExecSyncCalls(readFileSync(f, "utf-8"))) {
        offenders.push(`${rel}: ${bad}`);
      }
    }

    expect(
      offenders,
      `Interpolated execSync calls reintroduce the shell:\n  ${offenders.join("\n  ")}`,
    ).toEqual([]);
  });

  it("the specific sites that were fixed no longer interpolate", () => {
    const cases: Array<[string, RegExp]> = [
      ["src/commands/start.ts", /execFileSync\(\s*buildCmd/],
      ["src/commands/down.ts", /execFileSync\(\s*"ps"/],
      ["src/commands/down.ts", /execFileSync\(\s*"lsof"/],
      ["src/utils/laravel.ts", /execFileSync\(\s*"readlink"/],
      ["src/utils/laravel.ts", /execFileSync\(\s*"lsof"/],
    ];
    for (const [file, pattern] of cases) {
      expect(readFileSync(join(root, file), "utf-8"), file).toMatch(pattern);
    }
  });

  it("the interpolated forms really are gone", () => {
    const cases: Array<[string, RegExp]> = [
      ["src/commands/start.ts", /execSync\(\s*buildCmd\s*\+/],
      ["src/commands/down.ts", /execSync\(\s*`ps[^\n]*\$\{/],
      ["src/commands/down.ts", /execSync\(\s*`lsof[^\n]*\$\{/],
      ["src/utils/laravel.ts", /execSync\(\s*`readlink[^\n]*\$\{/],
      ["src/utils/laravel.ts", /execSync\(\s*`lsof[^\n]*\$\{/],
    ];
    for (const [file, pattern] of cases) {
      expect(readFileSync(join(root, file), "utf-8"), `${file} still matches ${pattern}`).not.toMatch(pattern);
    }
  });

  it("the helpers that replaced `2>/dev/null || true` validate their inputs", () => {
    const src = readFileSync(join(root, "src/utils/laravel.ts"), "utf-8");
    // readlink takes a pid, lsof a port; both must be rejected when malformed so
    // the value can never be read as a flag.
    expect(src).toMatch(/function readlinkOrEmpty[\s\S]*?Number\.isInteger\(pid\)/);
    expect(src).toMatch(/function lsofPidsOrEmpty[\s\S]*?Number\.isInteger\(port\)/);
  });

  it("getDescendants rejects a non-integer pid before calling ps", () => {
    const src = readFileSync(join(root, "src/commands/down.ts"), "utf-8");
    expect(src).toMatch(/Number\.isInteger\(pid\)[\s\S]*?return \[\]/);
  });
});

describe("fixed-string execSync is still allowed", () => {
  it("some sites legitimately need a shell for `|| true`", () => {
    // If this ever becomes empty the guard above is probably too strict.
    const fixed = files.flatMap((f) =>
      fixedStringExecSyncCalls(readFileSync(f, "utf-8")).map((c) => `${f.replace(`${root}/`, "")}: ${c}`),
    );
    expect(fixed.length).toBeGreaterThan(0);
  });
});