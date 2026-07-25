import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ProxyProvider, ProxyConfig } from "../types.js";
import { run, isCommandAvailable, sudoWriteFile } from "../../utils/exec.js";
import { getPlatform, isWindows } from "../../platform/index.js";

export class ApacheProxy implements ProxyProvider {
  readonly name = "apache";
  readonly priority = 60;

  async detect(): Promise<boolean> {
    return isCommandAvailable("apache2") || isCommandAvailable("httpd");
  }

  private getConfigDir(): string {
    if (isWindows()) {
      // Windows: C:\Apache24\conf\extra\
      return "C:\\Apache24\\conf\\extra";
    }

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
    // Windows uses mkcert certs in user dir
    const certPath = isWindows()
      ? join(process.env.USERPROFILE || "", ".orkestra", "certs", `${config.domain}.pem`)
      : "/etc/ssl/certs/ssl-cert-snakeoil.pem";
    const keyPath = isWindows()
      ? join(process.env.USERPROFILE || "", ".orkestra", "certs", `${config.domain}-key.pem`)
      : "/etc/ssl/private/ssl-cert-snakeoil.key";

    const sslBlock = config.ssl
      ? `<VirtualHost *:443>
    ServerName ${config.domain}
    SSLEngine on
    SSLCertificateFile ${certPath}
    SSLCertificateKeyFile ${keyPath}
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

    if (isWindows()) {
      // Windows: No sudo needed, just write file
      const { writeFile, mkdir } = await import("node:fs/promises");
      const dir = this.getConfigDir();
      if (!existsSync(dir)) {
        await mkdir(dir, { recursive: true });
      }
      await writeFile(configPath, configContent, "utf-8");
    } else {
      await sudoWriteFile(configPath, configContent);

      // Enable the site (Linux only)
      const siteName = `${config.domain}.conf`;
      await run("sudo", ["a2ensite", siteName]);
    }

    await this.reload();
  }

  async unregister(domain: string): Promise<void> {
    const configPath = this.getConfigPath(domain);

    if (isWindows()) {
      // Windows: Just delete the file
      const { unlink } = await import("node:fs/promises");
      if (existsSync(configPath)) {
        await unlink(configPath);
      }
    } else {
      // Disable the site (Linux only)
      const siteName = `${domain}.conf`;
      await run("sudo", ["a2dissite", siteName]);

      // Remove config file
      if (existsSync(configPath)) {
        await run("sudo", ["rm", "-f", configPath]);
      }
    }

    await this.reload();
  }

  async reload(): Promise<void> {
    if (isWindows()) {
      // Windows: httpd -k restart (no sudo if running as admin)
      await run("httpd", ["-k", "restart"]);
    } else {
      await run("sudo", ["systemctl", "reload", "apache2"]);
    }
  }
}
