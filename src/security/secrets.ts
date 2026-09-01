import { readFile, readdir } from "node:fs/promises";
import { join, extname, relative } from "node:path";
import { existsSync } from "node:fs";

export interface SecretFinding {
  file: string;
  line: number;
  col: number;
  type: string;
  severity: "critical" | "high" | "medium";
  matched: string;
  excerpt: string;
}

const SECRET_PATTERNS: Array<{ type: string; regex: RegExp; severity: SecretFinding["severity"] }> = [
  // API keys / tokens
  { type: "AWS Access Key", regex: /AKIA[0-9A-Z]{16}/g, severity: "critical" },
  { type: "AWS Secret Key", regex: /aws_secret_access_key\s*=\s*["'][A-Za-z0-9/+=]{40}["']/gi, severity: "critical" },
  { type: "GitHub Token", regex: /gh[oprs]_[A-Za-z0-9_]{36,255}/g, severity: "critical" },
  { type: "Stripe Key", regex: /sk_(live|test)_[0-9a-zA-Z]{20,}/g, severity: "critical" },
  { type: "Generic API Key", regex: /(api[_-]?key|apikey)\s*[:=]\s*["'][A-Za-z0-9_\-]{20,}["']/gi, severity: "high" },
  { type: "Private Key", regex: /-----BEGIN (RSA )?PRIVATE KEY-----/g, severity: "critical" },
  { type: "JWT Secret Hardcoded", regex: /(jwt[_-]?secret|JWT_SECRET)\s*[:=]\s*["'][^"']{8,}["']/gi, severity: "high" },
  { type: "Password Assignment", regex: /(password|passwd|pwd)\s*[:=]\s*["'][^"']{3,}["']/gi, severity: "high" },
  // Callbacks with secrets checked separately to avoid double counting on .env.example
  { type: "Hardcoded Bearer Token", regex: /Bearer\s+[A-Za-z0-9\-_\.=]+/g, severity: "high" },
  // PII / personal data
  { type: "Credit Card", regex: /\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13}|6(?:011|5[0-9]{2})[0-9]{12})\b/g, severity: "critical" },
  { type: "Bangladesh NID", regex: /\b[0-9]{10,17}\b/g, severity: "medium" }, // noisy, downgraded; filtered by context below
  { type: "Bangladesh Phone", regex: /(\+8801|01)[3-9][0-9]{8}\b/g, severity: "medium" },
  { type: "Email in Code", regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, severity: "medium" },
];

const ENV_SECRET_KEYS = /^(.*_KEY|.*_SECRET|.*_TOKEN|.*_PASSWORD|AWS_.*|STRIPE_.*|DATABASE_URL|REVERB_.*)$/i;

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", ".next", ".turbo", "vendor", ".orkestra", "coverage", ".ai"]);
const SKIP_FILES = new Set(["pnpm-lock.yaml", "package-lock.json", "yarn.lock", "bun.lockb", "bun.lock"]);
const TEXT_EXTS = new Set([".ts", ".js", ".tsx", ".jsx", ".php", ".py", ".env", ".yml", ".yaml", ".json", ".md", ".sh"]);

function isLikelyFalsePositive(file: string, type: string, matched: string, lineText: string): boolean {
  if (file.includes("src/security/") && /regex:|SECRET_PATTERNS|Hardcoded Bearer Token/.test(lineText)) return true;
  if (type === "Hardcoded Bearer Token" && /^Bearer\s+token$/i.test(matched.trim())) return true;
  if (file.startsWith("docs/") && type === "Hardcoded Bearer Token") return true; // PRP specs describe Bearer token flow
  if (file.includes(".env.example") || file.includes(".env.test") || file.endsWith(".example")) {
    if (/example|placeholder|changeme|your_|dummy/i.test(lineText)) return true;
  }
  // Email in comments/docs is not a leak if it's an example domain
  if (type === "Email in Code" && /example\.com|test\.com|placeholder/i.test(matched)) return true;
  // NID pattern is noisy - only flag if near PII keywords
  if (type === "Bangladesh NID" && !/(nid|national[_-]?id|nid_number)/i.test(lineText)) return true;
  // Ignore generic long hex that is not a key context
  if (type === "Generic API Key" && /test|mock|fake/i.test(lineText)) return true;
  return false;
}

export async function scanSecrets(dir: string): Promise<SecretFinding[]> {
  const findings: SecretFinding[] = [];
  await walk(dir, dir, findings);
  return findings;
}

async function walk(root: string, current: string, findings: SecretFinding[]) {
  if (!existsSync(current)) return;
  const entries = await readdir(current, { withFileTypes: true });
  for (const e of entries) {
    if (SKIP_DIRS.has(e.name)) continue;
    if (SKIP_FILES.has(e.name)) continue;
    const full = join(current, e.name);
    if (e.isDirectory()) {
      await walk(root, full, findings);
    } else if (e.isFile()) {
      const ext = extname(e.name).toLowerCase();
      // Always scan .env* even without ext
      const isEnv = e.name.startsWith(".env");
      if (!isEnv && !TEXT_EXTS.has(ext) && ext !== "") continue;
      // Skip large/binary
      try {
        const content = await readFile(full, "utf-8");
        // .env specific: flag real secrets (not placeholders)
        if (isEnv && !e.name.endsWith(".example")) {
          const lines = content.split("\n");
          lines.forEach((line, idx) => {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith("#")) return;
            const eq = trimmed.indexOf("=");
            if (eq === -1) return;
            const key = trimmed.substring(0, eq).trim();
            const val = trimmed.substring(eq + 1).trim().replace(/^["']|["']$/g, "");
            if (ENV_SECRET_KEYS.test(key) && val && !/^(null|empty|example|changeme|placeholder|\${.*})$/.test(val) && val.length > 4) {
              // Real .env with real value is not a finding itself (it's expected), but flag if committed and weak
              // Instead flag only if file is tracked and value is weak/hardcoded default
              if (/^(password|123456|admin|secret|test123)/i.test(val)) {
                findings.push({
                  file: relative(root, full),
                  line: idx + 1,
                  col: eq + 1,
                  type: "Weak Secret in .env",
                  severity: "high",
                  matched: `${key}=${val.slice(0, 8)}...`,
                  excerpt: line.slice(0, 120),
                });
              }
            }
          });
        }
        // Generic pattern scan
        const lines = content.split("\n");
        lines.forEach((line, idx) => {
          for (const pat of SECRET_PATTERNS) {
            const re = new RegExp(pat.regex.source, pat.regex.flags);
            let m: RegExpExecArray | null;
            while ((m = re.exec(line)) !== null) {
              const matched = m[0];
              if (isLikelyFalsePositive(relative(root, full), pat.type, matched, line)) continue;
              findings.push({
                file: relative(root, full),
                line: idx + 1,
                col: m.index + 1,
                type: pat.type,
                severity: pat.severity,
                matched: matched.length > 80 ? matched.slice(0, 80) + "..." : matched,
                excerpt: line.trim().slice(0, 120),
              });
              // prevent infinite loop on zero-length
              if (m[0].length === 0) re.lastIndex++;
            }
          }
        });
      } catch {
        // binary or unreadable
      }
    }
  }
}
