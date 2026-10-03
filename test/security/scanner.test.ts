import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanSecrets } from "../../src/security/secrets.js";
import { scanInjection } from "../../src/security/injection.js";

/**
 * The security bundle is a headline feature. These tests pin the detection
 * behaviour that matters most: real secrets must be caught, and the common
 * placeholders that flood a report with false positives must not be.
 */

let root: string;

async function project(files: Record<string, string>) {
  await mkdir(root, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    const full = join(root, name);
    await mkdir(join(full, ".."), { recursive: true });
    await writeFile(full, content, "utf-8");
  }
  return root;
}

function types(findings: Array<{ type: string }>) {
  return findings.map((f) => f.type);
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "ork-sec-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("secret detection", () => {
  it("flags an AWS access key", async () => {
    await project({ "config.ts": '// example fixture\nconst key = "AKIAZZ7QTPLMN4VWERTY9";' });
    const findings = await scanSecrets(root);
    expect(types(findings)).toContain("AWS Access Key");
  });

  it("flags a private key block", async () => {
    await project({
      "deploy.sh": "#!/bin/sh\n# example fixture, not a real key\necho ok\n-----BEGIN RSA PRIVATE KEY-----\nabc\n",
    });
    expect(types(await scanSecrets(root))).toContain("Private Key");
  });

  it("flags a GitHub token", async () => {
    await project({ "ci.ts": '// dummy example token for tests\nconst t = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";' });
    expect(types(await scanSecrets(root))).toContain("GitHub Token");
  });

  it("flags a hardcoded password assignment", async () => {
    await project({ "db.php": '<?php // example fixture\n$password = "n0t-a-real-one";' });
    expect(types(await scanSecrets(root))).toContain("Password Assignment");
  });

  it("flags a Stripe live key", async () => {
    await project({ "pay.ts": '// example key, fake for tests\nconst k = "sk_live_abcdefghij1234567890";' });
    expect(types(await scanSecrets(root))).toContain("Stripe Key");
  });

  it("flags a weak secret in .env", async () => {
    await project({ ".env": "APP_ENV=production\nDB_PASSWORD=password\n" });
    expect(types(await scanSecrets(root))).toContain("Weak Secret in .env");
  });

  it("does not flag a placeholder password in .env", async () => {
    await project({ ".env": "DB_PASSWORD=changeme\nAPP_KEY=\nSESSION_SECRET=null\n" });
    expect(types(await scanSecrets(root))).not.toContain("Weak Secret in .env");
  });

  it("does not flag .env.example files", async () => {
    await project({ ".env.example": "DB_PASSWORD=password\nAPI_KEY=your_api_key_here\n" });
    expect(types(await scanSecrets(root))).not.toContain("Weak Secret in .env");
  });

  it("skips node_modules", async () => {
    await project({
      "node_modules/pkg/index.js": '// example fixture\nconst k = "AKIAZZ7QTPLMN4VWERTY9";',
      "src/app.ts": "export const x = 1;",
    });
    expect(await scanSecrets(root)).toHaveLength(0);
  });

  it("skips lockfiles", async () => {
    await project({
      "bun.lock": '// example fixture\naws_secret_access_key="AKIAZZ7QTPLMN4VWERTY9"',
      "src/app.ts": "export const x = 1;",
    });
    expect(await scanSecrets(root)).toHaveLength(0);
  });

  it("ignores comments in .env", async () => {
    await project({ ".env": "# DB_PASSWORD=password\nAPP_ENV=local\n" });
    expect(types(await scanSecrets(root))).not.toContain("Weak Secret in .env");
  });

  it("reports file and line so findings are actionable", async () => {
    await project({ "src/creds.ts": "line one\n// example fixture\nexport const k = 'AKIAZZ7QTPLMN4VWERTY9';\n" });
    const findings = await scanSecrets(root);
    const aws = findings.find((f) => f.type === "AWS Access Key");
    expect(aws).toBeDefined();
    expect(aws!.file).toBe("src/creds.ts");
    expect(aws!.line).toBe(3);
  });

  it("returns an empty list for a clean project", async () => {
    await project({ "src/index.ts": "export function add(a: number, b: number) { return a + b; }\n" });
    expect(await scanSecrets(root)).toHaveLength(0);
  });
});

describe("injection detection", () => {
  it("flags PHP raw SQL with interpolation", async () => {
    await project({ "User.php": "<?php\n// example: vulnerable for the fixture\nDB::select(\"SELECT * FROM users WHERE id = $id\");\n" });
    expect(types(await scanInjection(root))).toContain("SQL Injection (PHP raw)");
  });

  it("flags whereRaw concatenation", async () => {
    await project({ "q.php": "<?php\n// example fixture\n$rows = DB::whereRaw(\"name = '\" . $name . \"'\");\n" });
    expect(types(await scanInjection(root))).toContain("SQL Injection (PHP concat)");
  });

  it("flags every reachable form of raw-clause concatenation", async () => {
    // The previous rule could never match: PHP always closes the literal with
    // its own quote before the concatenation dot, so `[^"']*\.` was unreachable
    // and the rule was dead code. Pin all the forms that must be caught.
    await project({
      "plain.php": "<?php\n// example fixture\nDB::whereRaw(\"name = \" . $name);\n",
      "nested.php": "<?php\n// example fixture\nDB::whereRaw(\"name = '{$name}' AND x = \" . $x);\n",
      "noSpace.php": "<?php\n// example fixture\nDB::orderByRaw(\"col = \".$dir);\n",
      "varStart.php": "<?php\n// example fixture\n$q->whereRaw($col . \" = \" . $val);\n",
    });
    const found = await scanInjection(root);
    expect(found.filter((f) => f.type === "SQL Injection (PHP concat)").length).toBe(4);
  });

  it("does not attribute a later dynamic expression to a static raw clause", async () => {
    await project({
      "safe2.php": "<?php\nDB::whereRaw(\"a = 1\");\n$total = $a + $b;\n",
    });
    expect(types(await scanInjection(root))).not.toContain("SQL Injection (PHP concat)");
  });

  it("flags command injection via exec with request data", async () => {
    await project({ "run.ts": "// example fixture\nexec('ls ' + req.query.dir);\n" });
    expect(types(await scanInjection(root))).toContain("Command Injection (exec)");
  });

  it("flags shell:true usage", async () => {
    await project({ "sh.ts": "// example fixture\nawait execa('ls', args, { shell: true });\n" });
    expect(types(await scanInjection(root))).toContain("Command Injection (shell:true)");
  });

  it("flags unescaped PHP echo of request data", async () => {
    await project({ "echo.php": "<?php\n// example fixture\necho $_GET['name'];\n" });
    expect(types(await scanInjection(root))).toContain("XSS (PHP echo unescaped)");
  });

  it("flags dangerouslySetInnerHTML", async () => {
    await project({ "View.tsx": "// example fixture\nreturn <div dangerouslySetInnerHTML={{ __html: html }} />;\n" });
    expect(types(await scanInjection(root))).toContain("XSS (dangerouslySetInnerHTML)");
  });

  it("does not flag parameterised queries", async () => {
    await project({
      "safe.php": "<?php\nDB::select('SELECT * FROM users WHERE id = ?', [$id]);\n",
      "safe.ts": "db.query('SELECT * FROM users WHERE id = $1', [id]);\n",
    });
    const findings = await scanInjection(root);
    expect(types(findings).filter((t) => t.includes("SQL Injection"))).toHaveLength(0);
  });

  it("does not flag execa without shell", async () => {
    await project({ "safe.ts": "await execa('git', ['status']);\n" });
    expect(types(await scanInjection(root))).not.toContain("Command Injection (shell:true)");
  });

  it("returns an empty list for a clean project", async () => {
    await project({ "src/util.ts": "export const sum = (a: number, b: number) => a + b;\n" });
    expect(await scanInjection(root)).toHaveLength(0);
  });

  it("attaches a remediation hint to each finding", async () => {
    await project({ "bad.php": "<?php\nDB::select(\"SELECT * FROM users WHERE id = $id\");\n" });
    const findings = await scanInjection(root);
    for (const f of findings) {
      expect(f.fix).toBeTruthy();
      expect(f.severity).toMatch(/critical|high|medium/);
    }
  });
});

describe("scanner behaves on real projects", () => {
  it("reports nothing on this repository", async () => {
    // Regression guard. The scanners used to flag their own test fixtures and
    // their own assertion strings, producing 7 critical findings against a
    // clean tree. A security report that cries wolf on a clean repo is worse
    // than no report, so this must stay at zero.
    const secrets = await scanSecrets(process.cwd());
    const injection = await scanInjection(process.cwd());

    expect(secrets.map((s) => `${s.type} ${s.file}:${s.line}`)).toEqual([]);
    expect(injection.map((i) => `${i.type} ${i.file}:${i.line}`)).toEqual([]);
  });

  it("still reports a genuine leak committed under a test directory", async () => {
    // The fixture suppression must not become a blanket test/ exemption.
    const dir = await mkdtemp(join(tmpdir(), "ork-sec-leak-"));
    await mkdir(join(dir, "test"), { recursive: true });
    // Assembled from parts so this test's own source does not contain a literal
    // credential for the scanner to flag, while the written fixture file does.
    const key = ["AKIA", "ZZ7QTPLMN4VWERTY9"].join("");
    await writeFile(join(dir, "test", "leak.ts"), `const real = "${key}";\n`, "utf-8");

    const findings = await scanSecrets(dir);
    expect(types(findings)).toContain("AWS Access Key");

    await rm(dir, { recursive: true, force: true });
  });

  it("still reports a genuine vulnerability under a test directory", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ork-sec-vuln-"));
    await mkdir(join(dir, "test"), { recursive: true });
    await writeFile(join(dir, "test", "bad.php"), '<?php\nDB::whereRaw("a = " . $x);\n', "utf-8");

    const findings = await scanInjection(dir);
    expect(types(findings)).toContain("SQL Injection (PHP concat)");

    await rm(dir, { recursive: true, force: true });
  });

  it("never throws on any repository layout", async () => {
    await expect(scanSecrets(process.cwd())).resolves.toBeInstanceOf(Array);
    await expect(scanInjection(process.cwd())).resolves.toBeInstanceOf(Array);
  });
});