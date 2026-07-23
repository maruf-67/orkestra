import { readFile, mkdir, copyFile, chmod } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { ProxyProvider, ProxyConfig } from "../types.js";
import { run, isCommandAvailable, sudoWriteFile } from "../../utils/exec.js";
import { getPlatform } from "../../platform/index.js";

// mkcert generates certs here
const MKCERT_CERT_DIR = join(homedir(), ".orkestra", "certs");
// Caddy (running as caddy user) reads from here
const CADDY_CERT_DIR = "/etc/caddy/certs";

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
    if (!await isCommandAvailable("mkcert")) {
      const platform = getPlatform();
      if (platform.serviceManager === "systemctl") {
        await run("sh", ["-c", "curl -fsSL https://mkcert.dev/install.sh | sudo sh"]);
      } else if (platform.serviceManager === "launchctl") {
        await run("brew", ["install", "mkcert"]);
      }
    }
    // Install the local CA into system trust store (idempotent)
    await run("mkcert", ["-install"]);
  }

  /**
   * Generate a certificate for the domain using mkcert,
   * then copy to /etc/caddy/certs/ so the caddy user can read them.
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

    // Copy to /etc/caddy/certs/ (needs sudo) so caddy user can read them
    if (!existsSync(CADDY_CERT_DIR)) {
      await run("sudo", ["mkdir", "-p", CADDY_CERT_DIR]);
    }

    const caddyCert = join(CADDY_CERT_DIR, `${domain}.pem`);
    const caddyKey = join(CADDY_CERT_DIR, `${domain}-key.pem`);

    await run("sudo", ["cp", localCert, caddyCert]);
    await run("sudo", ["cp", localKey, caddyKey]);
    await run("sudo", ["chmod", "644", caddyCert, caddyKey]);

    return { cert: caddyCert, key: caddyKey };
  }

  private async generateBlock(config: ProxyConfig): Promise<string> {
    if (config.ssl) {
      const { cert, key } = await this.generateCert(config.domain);
      return `${config.domain} {
  tls ${cert} ${key}
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
    await run(cmd, args, { sudo: true });
  }
}
