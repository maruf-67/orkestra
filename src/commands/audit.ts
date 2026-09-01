import { resolve } from "node:path";
import { heading, log, table, spinner } from "../utils/logger.js";
import { runSecurityScan } from "../security/scanner.js";
import { readAudit, auditSummary } from "../security/audit.js";
import { existsSync } from "node:fs";

interface AuditOptions {
  dir?: string;
  json?: boolean;
  online?: boolean;
  history?: boolean;
  limit?: number;
}

export async function audit(options: AuditOptions) {
  const dir = resolve(options.dir || process.cwd());
  if (options.history) {
    heading("Audit Trail");
    const summary = await auditSummary();
    table([["Total events", String(summary.total)]]);
    if (Object.keys(summary.byAction).length) {
      table(Object.entries(summary.byAction).map(([k, v]) => [k, String(v)]));
    }
    const recent = await readAudit(options.limit || 20);
    if (recent.length) {
      log.info("Recent events:");
      for (const e of recent.reverse()) {
        log.plain(`  ${e.ts}  ${e.action}  ${e.dir || ""}  ${e.result || ""}`);
      }
    } else {
      log.dim("No audit events yet.");
    }
    return;
  }

  // Default: security scan + audit trail is the bundle
  heading("Orkestra Security Audit");
  log.info(`Target: ${dir}`);
  if (!existsSync(dir)) { log.error(`Directory not found: ${dir}`); return; }

  const spin = spinner("Running security bundle: secrets/PII · injection/validation · CVE (online) · audit...");
  spin.start();
  const online = options.online !== false; // default online CVE via npm/composer audit (which hits registry)
  const report = await runSecurityScan(dir, { onlineCve: online });
  spin.stop();

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  // Summary
  heading("Summary");
  table([
    ["Critical", String(report.summary.critical)],
    ["High", String(report.summary.high)],
    ["Medium", String(report.summary.medium)],
    ["CVE findings", String(report.summary.cve)],
  ]);

  // Secrets / PII
  heading("1. Secrets & PII / Hardcoded Personal Data");
  if (report.secrets.length === 0) log.success("No secrets/PII found (no IOCs)");
  else {
    for (const f of report.secrets.slice(0, 30)) {
      log.plain(`  [${f.severity}] ${f.type} — ${f.file}:${f.line}  ${f.matched}`);
      log.dim(`    ${f.excerpt}`);
    }
    if (report.secrets.length > 30) log.dim(`  ...and ${report.secrets.length - 30} more (use --json)`);
  }

  // Injection / validation
  heading("2. Validation & Injection (SQLi, Command, XSS)");
  if (report.injection.length === 0) log.success("No injection/validation gaps found");
  else {
    for (const f of report.injection.slice(0, 30)) {
      log.plain(`  [${f.severity}] ${f.type} — ${f.file}:${f.line}`);
      log.dim(`    ${f.excerpt}`);
      log.dim(`    Fix: ${f.fix}`);
    }
    if (report.injection.length > 30) log.dim(`  ...and ${report.injection.length - 30} more`);
  }

  // CVE
  heading("3. CVEs (npm audit + composer audit — online registry)");
  let totalCve = 0;
  for (const r of report.cve) {
    if (r.error && r.findings.length === 0) { log.dim(`  ${r.tool}: ${r.error}`); continue; }
    if (r.findings.length === 0) { log.dim(`  ${r.tool}: no findings`); continue; }
    for (const c of r.findings.slice(0, 20)) {
      totalCve++;
      log.plain(`  [${c.severity}] ${c.package}@${c.installed} — ${c.title}${c.fixedIn ? ` (fix: ${c.fixedIn})` : ""}`);
      if (c.url) log.dim(`    ${c.url}`);
    }
  }
  if (totalCve === 0 && report.cve.every(r => r.findings.length === 0)) log.success("No CVEs reported by package audits");

  // Audit trail note
  heading("4. Audit Trail");
  const recent = await readAudit(3);
  log.dim(`  Audit event appended to ~/.orkestra/audit.log.jsonl (total scans: ${recent.length ? "1+" : "1"})`);
  log.plain("  View history: orkestra audit --history");
  log.plain("  Full report: orkestra audit --json > audit.json  |  orkestra security --json");

  const hasCritical = report.summary.critical > 0;
  if (hasCritical) log.error("Bundle failed: critical findings present");
  else if (report.summary.high > 0 || report.summary.cve > 0) log.warn("Bundle warnings: review high/CVE items");
  else log.success("Bundle passed");
}

// Alias for `orkestra security`
export const security = audit;
