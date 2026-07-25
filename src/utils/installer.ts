import { isCommandAvailable, run } from "./exec.js";
import { isWindows, isMacOS } from "../platform/index.js";
import { log } from "./logger.js";
import prompts from "prompts";

export interface InstallResult {
  installed: boolean;
  skipped: boolean;
  error?: string;
}

// Global flag for CI/CD mode (skip prompts)
let autoInstall = false;

/**
 * Set auto-install mode (for CI/CD).
 */
export function setAutoInstall(enabled: boolean): void {
  autoInstall = enabled;
}

/**
 * Ask user permission before installing a tool.
 */
async function askPermission(toolName: string, _installCmd: string): Promise<boolean> {
  // Skip prompt in auto-install mode
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

/**
 * Install mkcert with user permission.
 * - macOS: brew install mkcert
 * - Linux: curl install script
 * - Windows: choco install mkcert
 */
export async function installMkcert(force: boolean = false): Promise<InstallResult> {
  if (await isCommandAvailable("mkcert")) {
    return { installed: true, skipped: false };
  }

  log.info("mkcert is required for SSL certificates");

  const installCmd = isWindows()
    ? "choco install mkcert -y"
    : isMacOS()
    ? "brew install mkcert"
    : "curl -fsSL https://mkcert.dev/install.sh | sudo sh";

  if (!force) {
    const proceed = await askPermission("mkcert", installCmd);
    if (!proceed) {
      log.dim("Skipping mkcert installation. SSL will not work.");
      log.dim("Install manually: https://github.com/FiloSottile/mkcert#installation");
      return { installed: false, skipped: true };
    }
  }

  log.info(`Installing mkcert via: ${installCmd}`);

  let result;
  if (isWindows()) {
    result = await run("choco", ["install", "mkcert", "-y"]);
  } else if (isMacOS()) {
    result = await run("brew", ["install", "mkcert"]);
  } else {
    result = await run("sh", ["-c", "curl -fsSL https://mkcert.dev/install.sh | sudo sh"]);
  }

  if (result.exitCode !== 0) {
    return {
      installed: false,
      skipped: false,
      error: `Failed to install mkcert: ${result.stderr}`,
    };
  }

  // Install the local CA
  const caResult = await run("mkcert", ["-install"]);
  if (caResult.exitCode !== 0) {
    log.warn("mkcert installed but CA installation failed");
    log.dim("Run manually: mkcert -install");
  }

  return { installed: true, skipped: false };
}

/**
 * Install Caddy with user permission.
 * - macOS: brew install caddy
 * - Linux: apt/dnf install
 * - Windows: choco install caddy
 */
export async function installCaddy(force: boolean = false): Promise<InstallResult> {
  if (await isCommandAvailable("caddy")) {
    return { installed: true, skipped: false };
  }

  log.info("Caddy is recommended for local HTTPS development");

  let installCmd: string;
  if (isWindows()) {
    installCmd = "choco install caddy -y";
  } else if (isMacOS()) {
    installCmd = "brew install caddy";
  } else {
    // Detect package manager
    if (await isCommandAvailable("apt")) {
      installCmd = "sudo apt update && sudo apt install -y caddy";
    } else if (await isCommandAvailable("dnf")) {
      installCmd = "sudo dnf install -y caddy";
    } else if (await isCommandAvailable("pacman")) {
      installCmd = "sudo pacman -S caddy";
    } else {
      installCmd = "Download from https://caddyserver.com/download";
    }
  }

  if (!force) {
    const proceed = await askPermission("Caddy", installCmd);
    if (!proceed) {
      log.dim("Skipping Caddy installation.");
      log.dim("Install manually: https://caddyserver.com/download");
      return { installed: false, skipped: true };
    }
  }

  log.info(`Installing Caddy via: ${installCmd}`);

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
      return {
        installed: false,
        skipped: false,
        error: "Cannot auto-install Caddy. No supported package manager found.",
      };
    }
  }

  if (result.exitCode !== 0) {
    return {
      installed: false,
      skipped: false,
      error: `Failed to install Caddy: ${result.stderr}`,
    };
  }

  return { installed: true, skipped: false };
}

/**
 * Ensure a tool is available, offering to install if missing.
 */
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

  if (result.skipped) {
    return false;
  }

  if (result.error) {
    log.error(result.error);
  }

  return false;
}

/**
 * Check and offer to install all required tools.
 */
export async function ensureAllTools(): Promise<{
  proxy: boolean;
  ssl: boolean;
}> {
  const proxy = await ensureTool("caddy", () => installCaddy());
  const ssl = proxy ? await ensureTool("mkcert", () => installMkcert()) : false;

  return { proxy, ssl };
}
