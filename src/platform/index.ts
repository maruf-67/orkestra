import { homedir, platform } from "node:os";
import { join } from "node:path";

export interface PlatformConfig {
  hostsFile: string;
  shell: string;
  shellArgs: string[];
  configDir: string;
  caddyConfigDir: string;
  caddyReloadCmd: string[];
  serviceManager: "systemctl" | "brew" | "launchctl" | "sc" | null;
}

const linuxConfig: PlatformConfig = {
  hostsFile: "/etc/hosts",
  shell: "/bin/sh",
  shellArgs: ["-c"],
  configDir: join(homedir(), ".orkestra"),
  caddyConfigDir: "/etc/caddy",
  caddyReloadCmd: ["caddy", "reload", "--config", "/etc/caddy/Caddyfile"],
  serviceManager: "systemctl",
};

const macosConfig: PlatformConfig = {
  hostsFile: "/etc/hosts",
  shell: "/bin/zsh",
  shellArgs: ["-c"],
  configDir: join(homedir(), ".orkestra"),
  caddyConfigDir: join(homedir(), "Library", "Application Support", "Caddy"),
  caddyReloadCmd: ["caddy", "reload", "--config", join(homedir(), "Library", "Application Support", "Caddy", "Caddyfile")],
  serviceManager: "launchctl",
};

const windowsConfig: PlatformConfig = {
  hostsFile: "C:\\Windows\\System32\\drivers\\etc\\hosts",
  shell: "powershell.exe",
  shellArgs: ["-Command"],
  configDir: join(homedir(), ".orkestra"),
  caddyConfigDir: join(homedir(), "AppData", "Roaming", "Caddy"),
  caddyReloadCmd: ["caddy", "reload", "--config", join(homedir(), "AppData", "Roaming", "Caddy", "Caddyfile")],
  serviceManager: "sc",
};

export function getPlatform(): PlatformConfig {
  const os = platform();
  switch (os) {
    case "linux":
      return linuxConfig;
    case "darwin":
      return macosConfig;
    case "win32":
      return windowsConfig;
    default:
      return linuxConfig;
  }
}

export function isWindows(): boolean {
  return platform() === "win32";
}

export function isMacOS(): boolean {
  return platform() === "darwin";
}

export function isLinux(): boolean {
  return platform() === "linux";
}
