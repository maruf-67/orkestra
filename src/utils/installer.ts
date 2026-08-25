import { isCommandAvailable, run } from "./exec.js";
import { isWindows, isMacOS } from "../platform/index.js";
import { log, spinner } from "./logger.js";
import prompts from "prompts";

export interface InstallResult {
  installed: boolean;
  skipped: boolean;
  error?: string;
}

let autoInstall = false;

export function setAutoInstall(enabled: boolean): void {
  autoInstall = enabled;
}

async function askPermission(toolName: string): Promise<boolean> {
  if (autoInstall) {
    log.info(`Auto-installing ${toolName} (CI/CD mode)`);
    return true;
  }

  const response = await prompts({
    type: "confirm",
    name: "value",
    message: `${toolName} is not installed. Install it now?`,
    initial: true,
  });
  return response.value ?? false;
}

export async function installCaddy(): Promise<InstallResult> {
  if (await isCommandAvailable("caddy")) {
    return { installed: true, skipped: false };
  }

  log.info("Caddy is recommended for local HTTPS development");

  const proceed = await askPermission("Caddy");
  if (!proceed) {
    log.dim("Skipping Caddy installation.");
    return { installed: false, skipped: true };
  }

  const spin = spinner("Installing Caddy...");
  spin.start();

  let result;

  if (isWindows()) {
    result = await run("choco", ["install", "caddy", "-y"]);
  } else if (isMacOS()) {
    result = await run("brew", ["install", "caddy"]);
  } else {
    if (await isCommandAvailable("apt")) {
      result = await run("sh", ["-c", "sudo apt update && sudo apt install -y caddy"]);
    } else if (await isCommandAvailable("dnf")) {
      result = await run("sh", ["-c", "sudo dnf install -y caddy"]);
    } else if (await isCommandAvailable("pacman")) {
      result = await run("sh", ["-c", "sudo pacman -S --noconfirm caddy"]);
    } else {
      spin.fail("No supported package manager found");
      return { installed: false, skipped: false, error: "No supported package manager found" };
    }
  }

  if (result.exitCode !== 0) {
    spin.fail("Failed to install Caddy");
    return { installed: false, skipped: false, error: `Failed to install Caddy` };
  }

  spin.succeed("Caddy installed successfully");
  return { installed: true, skipped: false };
}

export async function installMkcert(): Promise<InstallResult> {
  if (await isCommandAvailable("mkcert")) {
    return { installed: true, skipped: false };
  }

  log.info("mkcert is required for SSL certificates");

  const proceed = await askPermission("mkcert");
  if (!proceed) {
    log.dim("Skipping mkcert installation.");
    return { installed: false, skipped: true };
  }

  const spin = spinner("Installing mkcert...");
  spin.start();

  let result;

  if (isWindows()) {
    result = await run("choco", ["install", "mkcert", "-y"]);
  } else if (isMacOS()) {
    result = await run("brew", ["install", "mkcert"]);
  } else {
    result = await run("sh", ["-c", "curl -fsSL https://mkcert.dev/install.sh | sudo sh"]);
  }

  if (result.exitCode !== 0) {
    spin.fail("Failed to install mkcert");
    return { installed: false, skipped: false, error: `Failed to install mkcert` };
  }

  // Install the local CA
  await run("mkcert", ["-install"]);

  spin.succeed("mkcert installed successfully");
  return { installed: true, skipped: false };
}

export async function installLocaltunnel(): Promise<InstallResult> {
  if (await isCommandAvailable("lt")) {
    return { installed: true, skipped: false };
  }

  log.info("Localtunnel is required for sharing projects");

  const proceed = await askPermission("localtunnel");
  if (!proceed) {
    log.dim("Skipping localtunnel installation.");
    log.dim("Install manually: npm install -g localtunnel");
    return { installed: false, skipped: true };
  }

  const spin = spinner("Installing localtunnel...");
  spin.start();

  const result = await run("npm", ["install", "-g", "localtunnel"]);

  if (result.exitCode !== 0) {
    spin.fail("Failed to install localtunnel");
    return { installed: false, skipped: false, error: "Failed to install localtunnel" };
  }

  spin.succeed("Localtunnel installed successfully");
  return { installed: true, skipped: false };
}

export async function ensureTool(
  toolName: string,
  installFn: () => Promise<InstallResult>
): Promise<boolean> {
  if (await isCommandAvailable(toolName)) {
    return true;
  }

  const result = await installFn();

  if (result.installed) {
    log.success(`${toolName} installed successfully`);
    return true;
  }

  if (result.error) {
    log.error(result.error);
  }

  return false;
}
