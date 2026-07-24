import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ProxyProvider, ProxyConfig } from "../types.js";
import { run, isCommandAvailable, sudoWriteFile } from "../../utils/exec.js";
import { getPlatform } from "../../platform/index.js";

export class ApacheProxy implements ProxyProvider {
  readonly name = "apache";
  readonly priority = 60;

  async detect(): Promise<boolean> {
    return isCommandAvailable("apache2") || isCommandAvailable("httpd");
  }

  private getConfigDir(): string {
    const platform = getPlatform();
    if (platform.serviceManager === "launchctl") {
      return "/opt/homebrew/etc/httpd";
    }
    return "/etc/apache2/sites-available";
  }

  private getConfigPath(domain: string): string {
    return join(this.getConfigDir(), `${domain}.conf`);
  }

  private generateConfig(config: ProxyConfig): string {
    const sslBlock = config.ssl
      ? `<VirtualHost *:443>
    ServerName ${config.domain}
    SSLEngine on
    SSLCertificateFile /etc/ssl/certs/ssl-cert-snakeoil.pem
    SSLCertificateKeyFile /etc/ssl/private/ssl-cert-snakeoil.key
    ProxyPreserveHost On
    ProxyPass / http://localhost:${config.port}/
    ProxyPassReverse / http://localhost:${config.port}/
</VirtualHost>

<VirtualHost *:80>
    ServerName ${config.domain}
    Redirect permanent / https://${config.domain}/
</VirtualHost>`
      : `<VirtualHost *:80>
    ServerName ${config.domain}
    ProxyPreserveHost On
    ProxyPass / http://localhost:${config.port}/
    ProxyPassReverse / http://localhost:${config.port}/
</VirtualHost>`;

    return `${sslBlock}\n`;
  }

  async register(config: ProxyConfig): Promise<void> {
    const configPath = this.getConfigPath(config.domain);
    const configContent = this.generateConfig(config);

    await sudoWriteFile(configPath, configContent);

    // Enable the site
    const siteName = `${config.domain}.conf`;
    await run("sudo", ["a2ensite", siteName]);
    await this.reload();
  }

  async unregister(domain: string): Promise<void> {
    const configPath = this.getConfigPath(domain);
    const siteName = `${domain}.conf`;

    // Disable the site
    await run("sudo", ["a2dissite", siteName]);

    // Remove config file
    if (existsSync(configPath)) {
      await run("sudo", ["rm", "-f", configPath]);
    }

    await this.reload();
  }

  async reload(): Promise<void> {
    await run("sudo", ["systemctl", "reload", "apache2"]);
  }
}
