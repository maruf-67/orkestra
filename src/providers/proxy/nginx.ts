import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ProxyProvider, ProxyConfig } from "../types.js";
import { run, isCommandAvailable, sudoWriteFile } from "../../utils/exec.js";
import { getPlatform } from "../../platform/index.js";

export class NginxProxy implements ProxyProvider {
  readonly name = "nginx";
  readonly priority = 80;

  async detect(): Promise<boolean> {
    return isCommandAvailable("nginx");
  }

  private getConfigPath(domain: string): string {
    const platform = getPlatform();
    if (platform.serviceManager === "launchctl") {
      return join("/opt/homebrew/etc/nginx/servers", `${domain}.conf`);
    }
    return join("/etc/nginx/sites-available", `${domain}.conf`);
  }

  private generateConfig(config: ProxyConfig): string {
    if (config.ssl) {
      return `server {
    listen 80;
    server_name ${config.domain};
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name ${config.domain};

    ssl_certificate /etc/ssl/certs/ssl-cert-snakeoil.pem;
    ssl_certificate_key /etc/ssl/private/ssl-cert-snakeoil.key;

    location / {
        proxy_pass http://localhost:${config.port};
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
`;
    }

    return `server {
    listen 80;
    server_name ${config.domain};

    location / {
        proxy_pass http://localhost:${config.port};
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
`;
  }

  async register(config: ProxyConfig): Promise<void> {
    const configPath = this.getConfigPath(config.domain);
    const configContent = this.generateConfig(config);

    await sudoWriteFile(configPath, configContent);

    // Create symlink in sites-enabled
    const platform = getPlatform();
    if (platform.serviceManager !== "launchctl") {
      const enabledPath = join("/etc/nginx/sites-enabled", `${config.domain}.conf`);
      if (!existsSync(enabledPath)) {
        await run("sudo", ["ln", "-s", configPath, enabledPath]);
      }
    }

    await this.reload();
  }

  async unregister(domain: string): Promise<void> {
    const configPath = this.getConfigPath(domain);
    const platform = getPlatform();

    // Remove symlink from sites-enabled
    if (platform.serviceManager !== "launchctl") {
      const enabledPath = join("/etc/nginx/sites-enabled", `${domain}.conf`);
      if (existsSync(enabledPath)) {
        await run("sudo", ["rm", "-f", enabledPath]);
      }
    }

    // Remove config file
    if (existsSync(configPath)) {
      await run("sudo", ["rm", "-f", configPath]);
    }

    await this.reload();
  }

  async reload(): Promise<void> {
    await run("sudo", ["nginx", "-s", "reload"]);
  }
}
