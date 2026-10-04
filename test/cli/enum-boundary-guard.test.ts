import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  GIT_STRATEGIES,
  PROXY_PROVIDERS,
  LOG_STREAMS,
  SHELLS,
  SHARE_PROVIDERS,
} from "../../src/config/enums.js";

/**
 * Structural guard, in the same spirit as test/state/port-affinity.test.ts.
 *
 * Commander only validates a value when the option is built with
 * `new Option(...).choices(...)`. `.option()` returns the Command, not the
 * Option, so there is no `.choices()` to chain onto — which is exactly why every
 * enum here was unconstrained for so long: nothing failed, the values simply
 * selected different behaviour at the far end.
 *
 * This test reads the CLI source and fails if an option that takes one of the
 * controlled vocabularies is ever declared without a constraint again, so the
 * next `--thing <a|b>` cannot quietly reintroduce the bug.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const cliSrc = readFileSync(join(root, "src", "cli.ts"), "utf-8");

/** Every `.option("--name <value>"...)` or `.addOption(new Option("--name <value>"...)...)`. */
function optionDeclarations(): Array<{ flag: string; statement: string }> {
  const out: Array<{ flag: string; statement: string }> = [];

  // Collapse the file into logical statements ending in `.option(...)` or
  // `.addOption(...)`, so a constraint on the following chain is visible.
  const statements = cliSrc
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith(".") || l.startsWith("program") || l === "");

  const joined: string[] = [];
  for (const line of statements) {
    if (line === "") continue;
    joined.push(line);
  }

  // Rebuild each declaration together with everything chained after it until the
  // next declaration, so we can see `.choices(...)` on the same chain.
  const chunks: string[] = [];
  let current = "";
  for (const line of joined) {
    if (/^\.(option|addOption)\(/.test(line) || line.startsWith("program")) {
      if (current) chunks.push(current);
      current = line;
    } else {
      current += " " + line;
    }
  }
  if (current) chunks.push(current);

  for (const chunk of chunks) {
    const m = chunk.match(/--([a-z-]+)\s+<[^>]+>/);
    if (m) out.push({ flag: `--${m[1]}`, statement: chunk });
  }
  return out;
}

const declarations = optionDeclarations();

describe("the CLI source declares options", () => {
  // If this fails the parser broke and every guard below would pass vacuously.
  it("finds the enum-bearing options", () => {
    expect(declarations.length).toBeGreaterThan(5);
  });
});

describe("controlled vocabularies are enforced at the CLI boundary", () => {
  it.each([
    ["--strategy", GIT_STRATEGIES],
    ["--proxy", PROXY_PROVIDERS],
    ["--stream", LOG_STREAMS],
    ["--shell", SHELLS],
    ["--provider", SHARE_PROVIDERS],
  ])("%s is constrained with choices()", (flag) => {
    const decl = declarations.find((d) => d.flag === flag);
    expect(decl, `${flag} was not found in src/cli.ts`).toBeDefined();
    expect(decl!.statement).toMatch(/\.choices\(/);
  });

  it("constrains every occurrence of --strategy", () => {
    // Declared on both `deploy` and `redeploy`; constraining one is not enough.
    const found = declarations.filter((d) => d.flag === "--strategy");
    expect(found.length).toBe(2);
    for (const decl of found) {
      expect(decl.statement).toMatch(/\.choices\(/);
    }
  });

  it("uses addOption(new Option(...)) rather than a chained .choices()", () => {
    // `.option()` returns the Command, so `.option(...).choices(...)` does not
    // exist and would not compile — this asserts the working shape is what is
    // committed, in case someone "simplifies" it back.
    for (const decl of declarations) {
      if (decl.statement.includes(".choices(")) {
        expect(decl.statement).toMatch(/\.addOption\(new Option\(/);
      }
    }
  });
});

describe("no option advertises alternatives it does not enforce", () => {
  it("every option whose description offers a choice is constrained", () => {
    // Catches the general form of the bug, including vocabularies not yet
    // declared in enums.ts: a description saying "x or y" is a promise to the
    // user that must be backed by validation.
    const offenders: string[] = [];

    for (const decl of declarations) {
      const desc = decl.statement.match(/"([^"]*)"/)?.[1] ?? "";
      const offersChoice =
        /\b(reset|pull|caddy|apache|nginx|stdout|stderr|zsh|bash|fish|localtunnel)\b/i.test(desc) ||
        /\(.*\bor\b.*\)/i.test(desc);
      if (offersChoice && !decl.statement.includes(".choices(")) {
        offenders.push(`${decl.flag} — "${desc}"`);
      }
    }

    expect(offenders, `Unconstrained options: ${offenders.join("; ")}`).toEqual([]);
  });
});

describe("the vocabularies agree with the Zod schema", () => {
  it("PROXY_PROVIDERS matches the proxy enum in schema.ts", async () => {
    const schema = readFileSync(join(root, "src", "config", "schema.ts"), "utf-8");
    const enums = [...schema.matchAll(/z\.enum\(\[([^\]]*)\]\)/g)].map((m) =>
      m[1]
        .split(",")
        .map((s) => s.trim().replace(/^["']|["']$/g, ""))
        .filter(Boolean),
    );
    const proxyEnum = enums.find((e) => e.includes("caddy"));

    expect(proxyEnum).toBeDefined();
    // Order-independent: the two lists must contain the same members.
    expect([...(proxyEnum ?? [])].sort()).toEqual([...PROXY_PROVIDERS].sort());
  });

  it("GIT_STRATEGIES matches the strategy enum in schema.ts", () => {
    const schema = readFileSync(join(root, "src", "config", "schema.ts"), "utf-8");
    const strategy = schema.match(/strategy:\s*z\.enum\(\[([^\]]*)\]\)/)?.[1];
    expect(strategy).toBeDefined();

    const fromSchema = strategy!
      .split(",")
      .map((s) => s.trim().replace(/^["']|["']$/g, ""));
    expect(fromSchema.sort()).toEqual([...GIT_STRATEGIES].sort());
  });
});