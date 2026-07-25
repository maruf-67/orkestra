import { resolve, basename } from "node:path";
import { log, heading, spinner } from "../utils/logger.js";
import { getProject, listProjects } from "../state/store.js";
import { loadConfig } from "../config/loader.js";
import { detectFramework } from "../detection/framework.js";
import { detectShareProvider, type ShareSession } from "../providers/share/index.js";
import { printQRCode } from "../utils/qr.js";
import { isCommandAvailable } from "../utils/exec.js";
import { installCloudflared } from "../utils/installer.js";
import { addAllowedHost } from "../utils/host-config.js";

interface ShareOptions {
  dir?: string;
  project?: string;
  provider?: string;
  qr?: boolean;
  copy?: boolean;
  json?: boolean;
  stop?: boolean;
  status?: boolean;
  url?: boolean;
}

// Store active sessions
const activeSessions: Map<string, ShareSession> = new Map();

export async function share(options: ShareOptions) {
  // Handle share stop
  if (options.stop) {
    await stopShare(options);
    return;
  }

  // Handle share status
  if (options.status) {
    await showStatus(options);
    return;
  }

  // Handle share url
  if (options.url) {
    await showUrl(options);
    return;
  }

  heading("Share Project");

  // Resolve project directory
  let projectDir: string;
  if (options.project) {
    const allProjects = await listProjects();
    const match = allProjects.find(p =>
      p.name.toLowerCase() === options.project!.toLowerCase() ||
      p.path.toLowerCase().includes(options.project!.toLowerCase())
    );
    if (!match) {
      log.error(`Project not found: ${options.project}`);
      process.exit(1);
    }
    projectDir = match.path;
  } else {
    projectDir = resolve(options.dir || process.cwd());
  }

  // Check if project is registered
  let project = await getProject(projectDir);
  const config = await loadConfig(projectDir);
  const projectName = config?.name || basename(projectDir);

  // Auto-start server if not running
  if (!project?.pid || !await isProcessAlive(project.pid)) {
    log.info("Project server not running. Starting...");

    const framework = await detectFramework(projectDir);
    if (!framework) {
      log.error("Cannot detect framework. Run `orkestra init` first.");
      process.exit(1);
    }

    // Start server using up command logic
    const { up } = await import("./up.js");
    await up({ dir: projectDir, foreground: false });

    // Refresh project state
    project = await getProject(projectDir);
  }

  if (!project?.pid) {
    log.error("Failed to start server");
    process.exit(1);
  }

  // Detect share provider with auto-install
  const providerSpin = spinner("Detecting share provider...");
  providerSpin.start();

  // Try to detect provider first
  let provider = await detectShareProvider(options.provider);

  // If not found, try to install cloudflared
  if (!provider) {
    providerSpin.stop();

    const installResult = await installCloudflared();
    if (installResult.installed) {
      // Retry detection after install
      provider = await detectShareProvider(options.provider);
    }
  }

  if (!provider) {
    providerSpin.fail("No share provider available");
    log.warn("Cloudflare tunnel could not be installed.");
    log.dim("Install manually:");
    log.dim("  macOS:      brew install cloudflared");
    log.dim("  Linux:      curl -fsSL https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o ~/.local/bin/cloudflared && chmod +x ~/.local/bin/cloudflared");
    log.dim("  Windows:    choco install cloudflared");
    log.dim("  Download:   https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/");
    process.exit(1);
  }

  providerSpin.succeed(`Using ${provider.name}`);

  // Start tunnel
  const tunnelSpin = spinner("Creating tunnel...");
  tunnelSpin.start();

  try {
    const session = await provider.start({
      port: project.port,
      domain: project.domain,
      projectName,
    });

    // Store session
    activeSessions.set(projectDir, session);

    tunnelSpin.succeed("Tunnel established!");

    // Auto-add tunnel domain to allowedHosts
    const tunnelDomain = new URL(session.publicUrl).hostname;
    log.dim(`Adding ${tunnelDomain} to allowedHosts...`);
    await addAllowedHost(projectDir, tunnelDomain);

    // Display results
    heading("Share Details");
    log.plain(`  Project:   ${projectName}`);
    log.plain(`  Local:     https://${project.domain}`);
    log.plain(`  Public:    ${session.publicUrl}`);
    log.plain(`  Provider:  ${provider.name}`);
    log.plain(`  Expires:   When terminal exits`);
    log.plain("");

    // Show QR code if requested
    if (options.qr) {
      await printQRCode(session.publicUrl);
    }

    // Copy to clipboard if requested
    if (options.copy) {
      await copyToClipboard(session.publicUrl);
    }

    // JSON output
    if (options.json) {
      console.log(JSON.stringify({
        project: projectName,
        localUrl: `https://${project.domain}`,
        publicUrl: session.publicUrl,
        provider: provider.name,
        pid: session.pid,
      }, null, 2));
    }

    log.dim("Stop with: orkestra share stop");
    log.dim("View status: orkestra share status");

  } catch (error) {
    tunnelSpin.fail(`Failed to create tunnel: ${error}`);
    process.exit(1);
  }
}

async function stopShare(options: ShareOptions) {
  heading("Stop Sharing");

  let projectDir: string;
  if (options.project) {
    const allProjects = await listProjects();
    const match = allProjects.find(p =>
      p.name.toLowerCase() === options.project!.toLowerCase() ||
      p.path.toLowerCase().includes(options.project!.toLowerCase())
    );
    if (!match) {
      log.error(`Project not found: ${options.project}`);
      process.exit(1);
    }
    projectDir = match.path;
  } else {
    projectDir = resolve(options.dir || process.cwd());
  }

  const session = activeSessions.get(projectDir);
  if (!session) {
    log.info("No active tunnel found for this project.");
    return;
  }

  const provider = await detectShareProvider(session.provider);
  if (provider) {
    await provider.stop(session);
  }

  activeSessions.delete(projectDir);
  log.success("Tunnel stopped.");
}

async function showStatus(options: ShareOptions) {
  heading("Share Status");

  const projects = await listProjects();
  const results: { name: string; url: string; status: string }[] = [];

  for (const project of projects) {
    const session = activeSessions.get(project.path);
    if (session) {
      const provider = await detectShareProvider(session.provider);
      if (provider) {
        const status = await provider.getStatus(session);
        results.push({
          name: project.name,
          url: status.publicUrl || "-",
          status: status.isRunning ? `Running (${status.uptime})` : "Stopped",
        });
      }
    }
  }

  if (results.length === 0) {
    log.info("No active tunnels.");
    log.dim("Start sharing with: orkestra share");
    return;
  }

  for (const result of results) {
    log.plain(`  ${result.name}`);
    log.plain(`    URL:      ${result.url}`);
    log.plain(`    Status:   ${result.status}`);
    log.plain("");
  }
}

async function showUrl(options: ShareOptions) {
  let projectDir: string;
  if (options.project) {
    const allProjects = await listProjects();
    const match = allProjects.find(p =>
      p.name.toLowerCase() === options.project!.toLowerCase() ||
      p.path.toLowerCase().includes(options.project!.toLowerCase())
    );
    if (!match) {
      log.error(`Project not found: ${options.project}`);
      process.exit(1);
    }
    projectDir = match.path;
  } else {
    projectDir = resolve(options.dir || process.cwd());
  }

  const session = activeSessions.get(projectDir);
  if (!session) {
    log.error("No active tunnel found.");
    log.dim("Start sharing with: orkestra share");
    process.exit(1);
  }

  if (options.json) {
    console.log(JSON.stringify({ publicUrl: session.publicUrl }));
  } else {
    console.log(session.publicUrl);
  }

  await copyToClipboard(session.publicUrl);
}

async function isProcessAlive(pid: number): Promise<boolean> {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function copyToClipboard(text: string): Promise<void> {
  try {
    const { isWindows, isMacOS } = await import("../platform/index.js");
    const { run } = await import("../utils/exec.js");

    if (isMacOS()) {
      await run("pbcopy", [], { stdin: text });
    } else if (isWindows()) {
      await run("clip", [], { stdin: text });
    } else {
      await run("xclip", ["-selection", "clipboard"], { stdin: text });
    }
    log.success("URL copied to clipboard!");
  } catch {
    log.dim("Could not copy to clipboard automatically");
  }
}
