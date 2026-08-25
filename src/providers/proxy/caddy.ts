import { readFile, mkdir, copyFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { ProxyProvider, ProxyConfig } from "../types.js";
import { run, isCommandAvailable, sudoWriteFile } from "../../utils/exec.js";
import { getPlatform, isWindows } from "../../platform/index.js";
import { installMkcert } from "../../utils/installer.js";

// mkcert generates certs here
const MKCERT_CERT_DIR = join(homedir(), ".orkestra", "certs");

// Platform-aware cert directory for Caddy
function getCaddyCertDir(): string {
  if (isWindows()) {
    return join(homedir(), "AppData", "Roaming", "Caddy", "certs");
  }
  // Linux/macOS: Caddy runs as caddy user, needs certs in /etc/caddy/certs
  return "/etc/caddy/certs";
}

function isLocalDomain(domain: string): boolean {
  const d = domain.toLowerCase();
  return (
    d.endsWith(".test") ||
    d.endsWith(".local") ||
    d.endsWith(".localhost") ||
    d === "localhost" ||
    d.endsWith(".internal")
  );
}

export class CaddyProxy implements ProxyProvider {
  readonly name = "caddy";
  readonly priority = 100;

  async detect(): Promise<boolean> {
    return isCommandAvailable("caddy");
  }

  private getConfigPath(): string {
    const platform = getPlatform();
    return join(platform.caddyConfigDir, "Caddyfile");
  }

  private async readConfig(): Promise<string> {
    const configPath = this.getConfigPath();
    if (existsSync(configPath)) {
      return readFile(configPath, "utf-8");
    }
    return "";
  }

  private async writeConfig(config: string): Promise<void> {
    await sudoWriteFile(this.getConfigPath(), config);
  }

  /**
   * Ensure mkcert is installed and its CA is trusted by the system.
   */
  private async ensureMkcert(): Promise<void> {
    const result = await installMkcert();
    if (!result.installed && !result.skipped) {
      throw new Error(
        "mkcert is required for local SSL certificates.\n" +
        "Install manually: https://github.com/FiloSottile/mkcert#installation\n" +
        "Or disable SSL in .orkestra.yml: ssl: false"
      );
    }
    if (result.skipped) {
      throw new Error(
        "SSL requires mkcert. Disabled for this session.\n" +
        "To enable later: mkcert -install"
      );
    }
  }

  /**
   * Generate a certificate for the domain using mkcert,
   * then copy to Caddy cert directory.
   */
  private async generateCert(domain: string): Promise<{ cert: string; key: string }> {
    await this.ensureMkcert();

    // Generate in user dir
    if (!existsSync(MKCERT_CERT_DIR)) {
      await mkdir(MKCERT_CERT_DIR, { recursive: true });
    }

    const localCert = join(MKCERT_CERT_DIR, `${domain}.pem`);
    const localKey = join(MKCERT_CERT_DIR, `${domain}-key.pem`);

    if (!existsSync(localCert)) {
      await run("mkcert", ["-cert-file", localCert, "-key-file", localKey, domain]);
    }

    const caddyCertDir = getCaddyCertDir();

    if (isWindows()) {
      // Windows: Copy to user's Caddy cert dir (no sudo needed)
      if (!existsSync(caddyCertDir)) {
        await mkdir(caddyCertDir, { recursive: true });
      }
      const caddyCert = join(caddyCertDir, `${domain}.pem`);
      const caddyKey = join(caddyCertDir, `${domain}-key.pem`);
      await copyFile(localCert, caddyCert);
      await copyFile(localKey, caddyKey);
      return { cert: caddyCert, key: caddyKey };
    }

    // Linux/macOS: Copy to /etc/caddy/certs/ (needs sudo)
    if (!existsSync(caddyCertDir)) {
      await run("sudo", ["mkdir", "-p", caddyCertDir]);
    }

    const caddyCert = join(caddyCertDir, `${domain}.pem`);
    const caddyKey = join(caddyCertDir, `${domain}-key.pem`);

    await run("sudo", ["cp", localCert, caddyCert]);
    await run("sudo", ["cp", localKey, caddyKey]);
    await run("sudo", ["chmod", "644", caddyCert, caddyKey]);

    return { cert: caddyCert, key: caddyKey };
  }

  private async generateBlock(config: ProxyConfig): Promise<string> {
    if (config.ssl) {
      if (isLocalDomain(config.domain)) {
        const { cert, key } = await this.generateCert(config.domain);
        return `${config.domain} {
  tls ${cert} ${key}
  reverse_proxy localhost:${config.port}
}
`;
      }
      // Public domain in production: Caddy manages automatic TLS with Let's Encrypt / ZeroSSL
      return `${config.domain} {
  reverse_proxy localhost:${config.port}
}
`;
    }

    return `${config.domain} {
  reverse_proxy localhost:${config.port}
}
`;
  }

  async register(config: ProxyConfig): Promise<void> {
    const existing = await this.readConfig();
    const block = await this.generateBlock(config);

    if (existing.includes(config.domain)) {
      const blockRegex = new RegExp(
        `${config.domain.replace(/\./g, "\\.")}\\s*\\{[^}]*\\}`,
        "g"
      );
      const newConfig = existing.replace(blockRegex, block.trim());
      await this.writeConfig(newConfig);
    } else {
      const separator = existing.trim() ? "\n\n" : "";
      await this.writeConfig(existing.trim() + separator + block);
    }

    await this.reload();
  }

  async registerMultiple(configs: ProxyConfig[]): Promise<void> {
    let currentConfig = await this.readConfig();

    for (const config of configs) {
      const block = await this.generateBlock(config);
      if (currentConfig.includes(config.domain)) {
        const blockRegex = new RegExp(
          `${config.domain.replace(/\./g, "\\.")}\\s*\\{[^}]*\\}`,
          "g"
        );
        currentConfig = currentConfig.replace(blockRegex, block.trim());
      } else {
        const separator = currentConfig.trim() ? "\n\n" : "";
        currentConfig = currentConfig.trim() + separator + block;
      }
    }

    await this.writeConfig(currentConfig);
    await this.reload();
  }

  async unregister(domain: string): Promise<void> {
    const existing = await this.readConfig();
    if (!existing.includes(domain)) return;

    const blockRegex = new RegExp(
      `${domain.replace(/\./g, "\\.")}\\s*\\{[^}]*\\}\\n?`,
      "g"
    );
    const newConfig = existing.replace(blockRegex, "").trim();
    await this.writeConfig(newConfig + "\n");
    await this.reload();
  }

  async reload(): Promise<void> {
    const platform = getPlatform();
    const [cmd, ...args] = platform.caddyReloadCmd;
    await run(cmd, args, { sudo: !isWindows() });
  }
}
