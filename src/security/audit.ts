import { appendFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { homedir } from "node:os";

export interface AuditEvent {
  ts: string;
  action: string;
  project?: string;
  dir?: string;
  actor?: string;
  meta?: Record<string, any>;
  result?: "success" | "failure" | "dry-run";
}

const AUDIT_DIR = join(homedir(), ".orkestra");
const AUDIT_FILE = join(AUDIT_DIR, "audit.log.jsonl");

export async function appendAudit(event: Omit<AuditEvent, "ts">) {
  const rec: AuditEvent = { ts: new Date().toISOString(), ...event };
  try {
    if (!existsSync(AUDIT_DIR)) await mkdir(AUDIT_DIR, { recursive: true });
    await appendFile(AUDIT_FILE, JSON.stringify(rec) + "\n", "utf-8");
  } catch {}
}

export async function readAudit(limit = 100): Promise<AuditEvent[]> {
  if (!existsSync(AUDIT_FILE)) return [];
  const text = await readFile(AUDIT_FILE, "utf-8");
  const lines = text.trim().split("\n").filter(Boolean);
  const last = lines.slice(-limit);
  return last.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) as AuditEvent[];
}

export async function auditSummary(): Promise<{ total: number; byAction: Record<string, number>; recent: AuditEvent[] }> {
  const all = await readAudit(1000);
  const byAction: Record<string, number> = {};
  for (const e of all) byAction[e.action] = (byAction[e.action] || 0) + 1;
  return { total: all.length, byAction, recent: all.slice(-20).reverse() };
}
