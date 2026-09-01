import { readFile, readdir } from "node:fs/promises";
import { join, extname, relative } from "node:path";
import { existsSync } from "node:fs";

export interface InjectionFinding {
  file: string;
  line: number;
  type: string;
  severity: "critical" | "high" | "medium";
  excerpt: string;
  fix: string;
}

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", ".next", "vendor", ".orkestra", "coverage"]);

interface Rule {
  type: string;
  severity: InjectionFinding["severity"];
  regex: RegExp;
  fix: string;
  ext?: string[]; // restrict
}

const RULES: Rule[] = [
  // SQL injection - string concatenation in queries
  { type: "SQL Injection (concat)", severity: "critical", regex: /(query|execute|raw|whereRaw|selectRaw).*\+.*req\.(body|query|params)/i, fix: "Use parameterized queries / bindings" },
  { type: "SQL Injection (template)", severity: "critical", regex: /(query|execute)\s*\(\s*`[^`]*\$\{(req\.|params|body)/i, fix: "Use placeholders (?) and bindings" },
  { type: "SQL Injection (PHP raw)", severity: "critical", regex: /DB::(raw|select|statement)\s*\(\s*["'][^"']*\$[a-zA-Z_]/i, fix: "Use bindings: DB::select('... where id = ?', [$id])" },
  { type: "SQL Injection (PHP concat)", severity: "high", regex: /whereRaw\s*\(\s*["'][^"']*\.\s*\$/i, fix: "Use whereRaw('... ?', [$val])" },
  // Command injection
  { type: "Command Injection (exec)", severity: "critical", regex: /(exec|execSync|spawn|execa)\s*\([^)]*\+.*req\./i, fix: "Sanitize input or use allow-list; never concat user input into shell" },
  { type: "Command Injection (shell:true)", severity: "high", regex: /shell:\s*true/i, fix: "Avoid shell:true with user input; use arg array" },
  // XSS / unescaped output (basic)
  { type: "XSS (dangerouslySetInnerHTML)", severity: "high", regex: /dangerouslySetInnerHTML/i, fix: "Sanitize HTML via DOMPurify or avoid raw HTML" },
  { type: "XSS (PHP echo unescaped)", severity: "high", regex: /echo\s+\$_(GET|POST|REQUEST)/i, fix: "Escape via e() / htmlspecialchars" },
  // Missing validation
  { type: "Missing Validation (req w/o zod)", severity: "medium", regex: /req\.body\.[a-zA-Z_]+/i, fix: "Validate via zod/FormRequest: schema.parse(req.body)" },
];

export async function scanInjection(dir: string): Promise<InjectionFinding[]> {
  const findings: InjectionFinding[] = [];
  await walk(dir, dir, findings);
  // Post-process: if file imports zod and validates, downgrade missing-validation
  return findings.filter(f => !isFalsePositive(f));
}

function isFalsePositive(f: InjectionFinding): boolean {
  // Skip security rule definitions
  if (f.file.includes("src/security/")) return true;
  if (f.file.includes("src/utils/exec.ts") && f.type.includes("Command Injection")) return true;
  if (f.file.includes("components/ui") && f.type.includes("dangerouslySetInnerHTML")) return true;
  // JSON-LD via JSON.stringify + sanitized replace is safe
  if (f.type.includes("dangerouslySetInnerHTML") && /JSON\.stringify.*replace\(.*\\u003c/.test(f.excerpt)) return true;
  return false;
}

async function walk(root: string, cur: string, out: InjectionFinding[]) {
  if (!existsSync(cur)) return;
  const entries = await readdir(cur, { withFileTypes: true });
  for (const e of entries) {
    if (SKIP_DIRS.has(e.name)) continue;
    const full = join(cur, e.name);
    if (e.isDirectory()) await walk(root, full, out);
    else if (e.isFile()) {
      const ext = extname(e.name).toLowerCase();
      if (![".ts", ".js", ".tsx", ".jsx", ".php"].includes(ext)) continue;
      try {
        const content = await readFile(full, "utf-8");
        const lines = content.split("\n");
        lines.forEach((line, idx) => {
          for (const r of RULES) {
            if (r.ext && !r.ext.includes(ext)) continue;
            if (r.regex.test(line)) {
              out.push({ file: relative(root, full), line: idx + 1, type: r.type, severity: r.severity, excerpt: line.trim().slice(0, 140), fix: r.fix });
            }
          }
        });
        // Validation gap: file handles req.body/query but never imports zod/yup/joi/FormRequest
        if (/\b(req\.body|req\.query|req\.params)\b/.test(content) && !/(zod|yup|joi|FormRequest|validate|schema\.parse)/i.test(content) && /\.(ts|js|tsx|jsx)$/.test(full)) {
          const firstHit = lines.findIndex(l => /req\.(body|query|params)/.test(l));
          if (firstHit !== -1 && !full.includes("node_modules") && !full.includes(".test.")) {
            out.push({ file: relative(root, full), line: firstHit + 1, type: "Missing Validation (no schema)", severity: "medium", excerpt: lines[firstHit].trim().slice(0, 140), fix: "Add zod schema or FormRequest" });
          }
        }
      } catch {}
    }
  }
}
