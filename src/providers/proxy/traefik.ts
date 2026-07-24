import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ProxyProvider, ProxyConfig } from "../types.js";
import { run, isCommandAvailable, sudoWriteFile } from "../../utils/exec.js";
import { getPlatform } from "../../platform/index.js";

export class TraefikProxy implements ProxyProvider {
  readonly name = "traefik";
  readonly priority = 90;

  async detect(): Promise<boolean> {
    return isCommandAvailable("traefik");
  }

  private getConfigPath(): string {
    const platform = getPlatform();
    if (platform.serviceManager === "launchctl") {
      return join("/opt/homebrew/etc", "traefik.yml");
    }
    return "/etc/traefik/traefik.yml";
  }

  private generateConfig(config: ProxyConfig): string {
    if (config.ssl) {
      return `http:
  routers:
    ${config.domain.replace(/\./g, "-")}:
      rule: "Host(\`${config.domain}\`)"
      service: ${config.domain.replace(/\./g, "-")}
      entryPoints:
        - websecure
      tls:
        certResolver: local
  services:
    ${config.domain.replace(/\./g, "-")}:
      loadBalancer:
        servers:
          - url: "http://localhost:${config.port}"

entryPoints:
  web:
    address: ":80"
  websecure:
    address: ":443"

certificatesResolvers:
  local:
    acme:
      storage: /etc/traefik/acme.json
      httpChallenge:
        entryPoint: web
`;
    }

    return `http:
  routers:
    ${config.domain.replace(/\./g, "-")}:
      rule: "Host(\`${config.domain}\`)"
      service: ${config.domain.replace(/\./g, "-")}
      entryPoints:
        - web
  services:
    ${config.domain.replace(/\./g, "-")}:
      loadBalancer:
        servers:
          - url: "http://localhost:${config.port}"

entryPoints:
  web:
    address: ":80"
`;
  }

  async register(config: ProxyConfig): Promise<void> {
    const configPath = this.getConfigPath();
    const configContent = this.generateConfig(config);
    await sudoWriteFile(configPath, configContent);
    await this.reload();
  }

  async unregister(domain: string): Promise<void> {
    // Traefik uses file-based config, we'd need to parse and remove
    // For now, just reload after manual config edit
    await this.reload();
  }

  async reload(): Promise<void> {
    await run("sudo", ["killall", "-HUP", "traefik"]);
  }
}
