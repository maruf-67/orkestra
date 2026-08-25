import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ProxyProvider, ProxyConfig } from "../types.js";
import { run, isCommandAvailable, sudoWriteFile } from "../../utils/exec.js";
import { getPlatform, isWindows } from "../../platform/index.js";

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

  private generateBlock(config: ProxyConfig): string {
    if (config.ssl) {
      if (isLocalDomain(config.domain)) {
        // Caddy built-in internal CA for local development (zero external dependencies, never hangs)
        return `${config.domain} {
  tls internal
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

    return `http://${config.domain} {
  reverse_proxy localhost:${config.port}
}
`;
  }

  async register(config: ProxyConfig): Promise<void> {
    const existing = await this.readConfig();
    const block = this.generateBlock(config);

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
      const block = this.generateBlock(config);
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
    if (!isWindows() && await isCommandAvailable("systemctl")) {
      const checkActive = await run("systemctl", ["is-active", "caddy"]);
      if (checkActive.stdout.trim() === "active") {
        await run("systemctl", ["reload", "caddy"], { sudo: true });
        return;
      }
    }

    const [cmd, ...args] = platform.caddyReloadCmd;
    await run(cmd, args, { sudo: !isWindows() });
  }
}
