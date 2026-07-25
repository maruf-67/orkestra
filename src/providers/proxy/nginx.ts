import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ProxyProvider, ProxyConfig } from "../types.js";
import { run, isCommandAvailable, sudoWriteFile } from "../../utils/exec.js";
import { getPlatform, isWindows } from "../../platform/index.js";

export class NginxProxy implements ProxyProvider {
  readonly name = "nginx";
  readonly priority = 80;

  async detect(): Promise<boolean> {
    return isCommandAvailable("nginx");
  }

  private getConfigPath(domain: string): string {
    if (isWindows()) {
      // Windows: C:\nginx\conf\conf.d\
      return join("C:\\nginx\\conf\\conf.d", `${domain}.conf`);
    }

    const platform = getPlatform();
    if (platform.serviceManager === "launchctl") {
      return join("/opt/homebrew/etc/nginx/servers", `${domain}.conf`);
    }
    return join("/etc/nginx/sites-available", `${domain}.conf`);
  }

  private getEnabledPath(domain: string): string | null {
    if (isWindows()) {
      return null; // Windows doesn't use sites-enabled
    }
    const platform = getPlatform();
    if (platform.serviceManager === "launchctl") {
      return null; // macOS Homebrew doesn't use sites-enabled
    }
    return join("/etc/nginx/sites-enabled", `${domain}.conf`);
  }

  private generateConfig(config: ProxyConfig): string {
    if (config.ssl) {
      // Windows uses mkcert certs in user dir
      const certPath = isWindows()
        ? join(process.env.USERPROFILE || "", ".orkestra", "certs", `${config.domain}.pem`)
        : "/etc/ssl/certs/ssl-cert-snakeoil.pem";
      const keyPath = isWindows()
        ? join(process.env.USERPROFILE || "", ".orkestra", "certs", `${config.domain}-key.pem`)
        : "/etc/ssl/private/ssl-cert-snakeoil.key";

      return `server {
    listen 80;
    server_name ${config.domain};
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name ${config.domain};

    ssl_certificate ${certPath};
    ssl_certificate_key ${keyPath};

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

    if (isWindows()) {
      // Windows: No sudo needed if running as admin
      const { writeFile, mkdir } = await import("node:fs/promises");
      const dir = join("C:\\nginx\\conf\\conf.d");
      if (!existsSync(dir)) {
        await mkdir(dir, { recursive: true });
      }
      await writeFile(configPath, configContent, "utf-8");
    } else {
      await sudoWriteFile(configPath, configContent);

      // Create symlink in sites-enabled (Linux only)
      const enabledPath = this.getEnabledPath(config.domain);
      if (enabledPath && !existsSync(enabledPath)) {
        await run("sudo", ["ln", "-s", configPath, enabledPath]);
      }
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
      // Remove symlink from sites-enabled
      const enabledPath = this.getEnabledPath(domain);
      if (enabledPath && existsSync(enabledPath)) {
        await run("sudo", ["rm", "-f", enabledPath]);
      }

      // Remove config file
      if (existsSync(configPath)) {
        await run("sudo", ["rm", "-f", configPath]);
      }
    }

    await this.reload();
  }

  async reload(): Promise<void> {
    if (isWindows()) {
      // Windows: nginx -s reload (no sudo if running as admin)
      await run("nginx", ["-s", "reload"]);
    } else {
      await run("sudo", ["nginx", "-s", "reload"]);
    }
  }
}
