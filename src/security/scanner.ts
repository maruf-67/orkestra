import { scanSecrets } from "./secrets.js";
import { scanInjection } from "./injection.js";
import { scanCve } from "./cve.js";
import { appendAudit } from "./audit.js";

export interface SecurityReport {
  dir: string;
  generatedAt: string;
  summary: { critical: number; high: number; medium: number; cve: number };
  secrets: Awaited<ReturnType<typeof scanSecrets>>;
  injection: Awaited<ReturnType<typeof scanInjection>>;
  cve: Awaited<ReturnType<typeof scanCve>>;
}

export async function runSecurityScan(dir: string, opts: { onlineCve?: boolean } = {}): Promise<SecurityReport> {
  const [secrets, injection, cve] = await Promise.all([
    scanSecrets(dir),
    scanInjection(dir),
    scanCve(dir, { online: opts.onlineCve !== false }),
  ]);
  const critical = secrets.filter(s => s.severity === "critical").length + injection.filter(s => s.severity === "critical").length;
  const high = secrets.filter(s => s.severity === "high").length + injection.filter(s => s.severity === "high").length;
  const medium = secrets.filter(s => s.severity === "medium").length + injection.filter(s => s.severity === "medium").length;
  const cveCount = cve.reduce((a, r) => a + r.findings.length, 0);
  const report: SecurityReport = {
    dir,
    generatedAt: new Date().toISOString(),
    summary: { critical, high, medium, cve: cveCount },
    secrets,
    injection,
    cve,
  };
  await appendAudit({ action: "security:scan", dir, result: "success", meta: { summary: report.summary } });
  return report;
}
