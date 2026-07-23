import { readFile, writeFile, mkdir, mkdtemp } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ProxyProvider, ProxyConfig } from "../types.js";
import { run, isCommandAvailable } from "../../utils/exec.js";
import { getPlatform } from "../../platform/index.js";

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

  private async ensureConfigDir(): Promise<void> {
    const platform = getPlatform();
    if (!existsSync(platform.caddyConfigDir)) {
      await run("mkdir", ["-p", platform.caddyConfigDir], { sudo: true });
    }
  }

  private async readConfig(): Promise<string> {
    const configPath = this.getConfigPath();
    if (existsSync(configPath)) {
      return readFile(configPath, "utf-8");
    }
    return "";
  }

  private async writeConfig(config: string): Promise<void> {
    await this.ensureConfigDir();
    // Write to temp file, then copy with sudo
    const tmpDir = await mkdtemp(join(tmpdir(), "orkestra-caddy-"));
    const tmpFile = join(tmpDir, "Caddyfile");
    await writeFile(tmpFile, config, "utf-8");
    await run("cp", [tmpFile, this.getConfigPath()], { sudo: true });
  }

  private generateBlock(config: ProxyConfig): string {
    const tlsLine = config.ssl ? "" : "  tls internal\n";
    return `${config.domain} {
${tlsLine}  reverse_proxy localhost:${config.port}
}
`;
  }

  async register(config: ProxyConfig): Promise<void> {
    const existing = await this.readConfig();

    // Check if domain already configured
    if (existing.includes(config.domain)) {
      // Update existing block
      const blockRegex = new RegExp(
        `${config.domain.replace(/\./g, "\\.")}\\s*\\{[^}]*\\}`,
        "g"
      );
      const newConfig = existing.replace(blockRegex, this.generateBlock(config).trim());
      await this.writeConfig(newConfig);
    } else {
      // Append new block
      const separator = existing.trim() ? "\n\n" : "";
      await this.writeConfig(existing.trim() + separator + this.generateBlock(config));
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
    await run(cmd, args);
  }
}
