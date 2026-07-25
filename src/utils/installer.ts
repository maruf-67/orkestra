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

export async function installCloudflared(): Promise<InstallResult> {
  if (await isCommandAvailable("cloudflared")) {
    return { installed: true, skipped: false };
  }

  log.info("Cloudflared is required for sharing projects");

  const proceed = await askPermission("cloudflared");
  if (!proceed) {
    log.dim("Skipping cloudflared installation.");
    log.dim("Install manually: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/");
    return { installed: false, skipped: true };
  }

  const spin = spinner("Installing cloudflared...");
  spin.start();

  if (isWindows()) {
    // Windows: Download binary (no sudo needed)
    spin.text = "Downloading cloudflared...";
    const result = await run("powershell", [
      "-Command",
      "Invoke-WebRequest -Uri 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe' -OutFile '$env:USERPROFILE\\cloudflared.exe'"
    ]);
    if (result.exitCode === 0) {
      spin.succeed("Cloudflared installed to ~/cloudflared.exe");
      log.dim("Add to PATH or run: ~/cloudflared.exe tunnel --url http://localhost:PORT");
    } else {
      spin.fail("Failed to download cloudflared");
      return { installed: false, skipped: false, error: "Failed to download cloudflared" };
    }
  } else if (isMacOS()) {
    // macOS: Use brew (no sudo needed)
    spin.text = "Installing via Homebrew...";
    const result = await run("brew", ["install", "cloudflared"]);
    if (result.exitCode !== 0) {
      spin.fail("Failed to install via brew");
      return { installed: false, skipped: false, error: "Failed to install via brew" };
    }
    spin.succeed("Cloudflared installed via Homebrew");
  } else {
    // Linux: Download binary to ~/.local/bin (no sudo needed)
    const homeDir = process.env.HOME || "~";
    const binDir = `${homeDir}/.local/bin`;
    const binPath = `${binDir}/cloudflared`;

    // Create directory if needed
    spin.text = "Creating directory...";
    await run("mkdir", ["-p", binDir]);

    // Download binary with progress
    spin.text = "Downloading cloudflared binary...";
    const result = await run("curl", [
      "-fsSL",
      "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64",
      "-o", binPath
    ]);

    if (result.exitCode !== 0) {
      spin.fail("Failed to download cloudflared");
      return { installed: false, skipped: false, error: "Failed to download cloudflared" };
    }

    // Make executable
    spin.text = "Making executable...";
    await run("chmod", ["+x", binPath]);

    spin.succeed("Cloudflared installed");
    log.dim(`Installed to ${binPath}`);
    log.dim("Add ~/.local/bin to your PATH:");
    log.dim("  echo 'export PATH=\"$HOME/.local/bin:$PATH\"' >> ~/.bashrc");
    log.dim("  source ~/.bashrc");
  }

  // Verify installation
  if (await isCommandAvailable("cloudflared")) {
    return { installed: true, skipped: false };
  }

  // On Linux, check if it's in ~/.local/bin
  if (!isWindows() && !isMacOS()) {
    const homeDir = process.env.HOME || "~";
    const binPath = `${homeDir}/.local/bin/cloudflared`;
    if (await isCommandAvailable(binPath)) {
      return { installed: true, skipped: false };
    }
  }

  return {
    installed: false,
    skipped: false,
    error: "Installation completed but cloudflared not found. Check your PATH."
  };
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
