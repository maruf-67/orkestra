import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { run } from "../utils/exec.js";

export interface CveFinding {
  package: string;
  installed: string;
  fixedIn?: string;
  severity: "critical" | "high" | "moderate" | "low";
  title: string;
  url?: string;
  via: string; // npm audit | composer audit | osv
}

export interface CveReport {
  tool: string;
  findings: CveFinding[];
  rawExitCode?: number;
  error?: string;
}

export async function scanNpmAudit(dir: string): Promise<CveReport> {
  if (!existsSync(join(dir, "package.json"))) return { tool: "npm-audit", findings: [], error: "no package.json" };
  // Prefer bun audit if bun.lock exists, else npm audit
  const hasBunLock = existsSync(join(dir, "bun.lockb")) || existsSync(join(dir, "bun.lock"));
  const cmd = hasBunLock ? "bun" : "npm";
  const args = ["audit", "--json"];
  try {
    const res = await run(cmd, args, { cwd: dir });
    // npm audit exits 1 when vulns found - still parse stdout
    const text = res.stdout || res.stderr;
    if (!text.trim()) return { tool: cmd + " audit", findings: [], rawExitCode: res.exitCode };
    let json: any;
    try { json = JSON.parse(text); } catch { return { tool: cmd + " audit", findings: [], error: "invalid json" }; }
    const findings: CveFinding[] = [];
    // npm v10 format: { vulnerabilities: { pkg: { via: [...] } } }
    const vulns = json.vulnerabilities || json.advisories || {};
    for (const [pkg, data] of Object.entries<any>(vulns)) {
      const via = (data.via || []) as any[];
      for (const v of via) {
        if (typeof v === "string") continue; // string = transitive dep name
        findings.push({
          package: v.name || pkg,
          installed: data.range || v.range || "?",
          fixedIn: v.fixAvailable ? String(v.fixAvailable) : undefined,
          severity: (v.severity || data.severity || "moderate").toLowerCase() as any,
          title: v.title || v.name || pkg,
          url: v.url,
          via: cmd + " audit",
        });
      }
    }
    // Fallback: npm audit --json legacy array format
    if (findings.length === 0 && json.auditReportVersion === undefined && json.metadata) {
      // nothing
    }
    return { tool: cmd + " audit", findings, rawExitCode: res.exitCode };
  } catch (e: any) {
    return { tool: "npm-audit", findings: [], error: e.message };
  }
}

export async function scanComposerAudit(dir: string): Promise<CveReport> {
  if (!existsSync(join(dir, "composer.json"))) return { tool: "composer-audit", findings: [], error: "no composer.json" };
  try {
    const res = await run("composer", ["audit", "--format=json"], { cwd: dir });
    const text = res.stdout || res.stderr;
    if (!text.trim()) return { tool: "composer audit", findings: [], rawExitCode: res.exitCode };
    let json: any;
    try { json = JSON.parse(text); } catch { return { tool: "composer audit", findings: [], error: "invalid json" }; }
    const advisories = json.advisories || json;
    const findings: CveFinding[] = [];
    for (const [pkg, list] of Object.entries<any>(advisories)) {
      if (!Array.isArray(list)) continue;
      for (const adv of list) {
        findings.push({
          package: pkg,
          installed: adv.affectedVersions || "?",
          fixedIn: adv.fixedVersions || undefined,
          severity: (adv.severity || "high").toLowerCase() as any,
          title: adv.title || adv.cve || pkg,
          url: adv.link || adv.url,
          via: "composer audit",
        });
      }
    }
    return { tool: "composer audit", findings, rawExitCode: res.exitCode };
  } catch (e: any) {
    return { tool: "composer-audit", findings: [], error: e.message };
  }
}

// Online CVE enrichment via OSV.dev (no auth, best-effort) — complements npm/composer audit
// Queries https://api.osv.dev/v1/query for each installed package when online
export async function queryOsvForPackages(packages: Array<{ name: string; version: string }>): Promise<CveFinding[]> {
  const findings: CveFinding[] = [];
  for (const pkg of packages.slice(0, 30)) { // cap to avoid rate limit
    try {
      const res = await fetch("https://api.osv.dev/v1/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ package: { name: pkg.name, ecosystem: pkg.name.includes(":") ? undefined : "npm" }, version: pkg.version }),
      });
      if (!res.ok) continue;
      const data: any = await res.json();
      for (const vuln of data.vulns || []) {
        findings.push({
          package: pkg.name,
          installed: pkg.version,
          severity: (vuln.severity?.[0]?.score ? "high" : "moderate") as any,
          title: vuln.summary || vuln.id,
          url: `https://osv.dev/vulnerability/${vuln.id}`,
          via: "osv.dev",
        });
      }
    } catch {}
  }
  return findings;
}

export async function enrichWithOsv(dir: string): Promise<CveReport> {
  try {
    const pkgPath = join(dir, "package.json");
    if (!existsSync(pkgPath)) return { tool: "osv.dev", findings: [], error: "no package.json" };
    const pkg = JSON.parse(await readFile(pkgPath, "utf-8"));
    const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    const list = Object.entries(deps).map(([name, ver]) => ({ name, version: String(ver).replace(/^[\^~>=<\s]+/, "") })).filter(p => /^\d/.test(p.version));
    if (list.length === 0) return { tool: "osv.dev", findings: [] };
    const findings = await queryOsvForPackages(list);
    return { tool: "osv.dev", findings };
  } catch (e: any) {
    return { tool: "osv.dev", findings: [], error: e.message };
  }
}

export async function scanCve(dir: string, opts: { online?: boolean } = {}): Promise<CveReport[]> {
  const results: CveReport[] = [];
  results.push(await scanNpmAudit(dir));
  results.push(await scanComposerAudit(dir));
  if (opts.online !== false) results.push(await enrichWithOsv(dir));
  return results.filter(r => !r.error || r.findings.length > 0);
}
