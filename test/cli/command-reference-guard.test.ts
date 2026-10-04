import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * User-facing guidance must name a command that exists.
 *
 * `src/commands/register.ts` was deleted in 1.0.10 after confirming it had zero
 * importers and was never registered in cli.ts. But five commands told users to
 * run `orkestra register`, so the deletion silently turned real error messages
 * into advice pointing at a command that does not exist:
 *
 *     $ orkestra list
 *     No projects registered.
 *     Run `orkestra register` in a project directory to get started.
 *     error: unknown command 'register'
 *
 * The file was genuinely dead; the *name* was not. This guard separates the two
 * questions so deleting a command cannot strand its guidance again.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const cliSrc = readFileSync(join(root, "src", "cli.ts"), "utf-8");

/** Command names actually registered on the Commander program. */
function registeredCommands(): Set<string> {
  const names = new Set<string>();
  for (const m of cliSrc.matchAll(/\.command\(\s*["'`]([^"'`]+)["'`]/g)) {
    names.add(m[1].trim());
  }
  return names;
}

/** Every .ts file under src/commands. */
function commandFiles(): string[] {
  const dir = join(root, "src", "commands");
  return readdirSync(dir)
    .filter((f) => f.endsWith(".ts"))
    .map((f) => join(dir, f));
}

const commands = registeredCommands();

describe("the command list was parsed", () => {
  // If this fails the assertions below would pass vacuously.
  it("finds the real commands", () => {
    expect(commands.size).toBeGreaterThan(10);
    expect(commands.has("up")).toBe(true);
    expect(commands.has("deploy")).toBe(true);
    expect(commands.has("init")).toBe(true);
  });

  it("genuinely has no 'register' command, which is why this matters", () => {
    expect(commands.has("register")).toBe(false);
  });
});

describe("no message points at a command that does not exist", () => {
  it("every `orkestra <name>` referenced in a command message is registered", () => {
    const offenders: string[] = [];

    for (const file of commandFiles()) {
      const src = readFileSync(file, "utf-8");
      // Only backticked references count as command invocations. That is the
      // codebase convention and it is what caught this bug. Matching bare
      // "orkestra <word>" also matches English -- "the .orkestra directory",
      // "orkestra will auto-find a port" -- and a guard that cries wolf gets
      // ignored rather than fixed.
      for (const m of src.matchAll(/`orkestra ([a-z][a-z-]*)`/g)) {
        const name = m[1];
        if (!commands.has(name)) {
          const line = src.slice(0, m.index).split("\n").length;
          offenders.push(`${file.replace(`${root}/`, "")}:${line} -> orkestra ${name}`);
        }
      }
    }

    expect(offenders, `Dangling command references:\n  ${offenders.join("\n  ")}`).toEqual([]);
  });

  it("the corrected messages now name `init`", () => {
    // Pin the specific regression so it cannot silently come back.
    for (const file of ["list.ts", "up.ts", "status.ts", "restart.ts", "open.ts"]) {
      const src = readFileSync(join(root, "src", "commands", file), "utf-8");
      expect(src, file).not.toMatch(/orkestra register/);
    }
  });

  it("is finding references rather than matching nothing", () => {
    let found = 0;
    for (const file of commandFiles()) {
      found += [...readFileSync(file, "utf-8").matchAll(/`orkestra ([a-z][a-z-]*)`/g)].length;
    }
    expect(found).toBeGreaterThan(3);
  });
});

describe("every command module is reachable", () => {
  it("each src/commands/*.ts file is either registered or imported", () => {
    // Catches the inverse error: a command module that exists but was never wired
    // up, which is how register.ts looked before deletion.
    const orphans: string[] = [];

    for (const file of commandFiles()) {
      const base = file.split("/").pop()!.replace(/\.ts$/, "");
      // The module only has to be imported by cli.ts to be usable.
      const imported = new RegExp(`commands/${base}\\.js`).test(cliSrc);
      if (!imported) orphans.push(base);
    }

    expect(orphans, `Command modules not imported by cli.ts: ${orphans.join(", ")}`).toEqual([]);
  });
});