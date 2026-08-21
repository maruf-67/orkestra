/**
 * Orkestra Reverb Utility
 * Handles WebSocket (Reverb) domain registration for Laravel projects.
 * - Registers a dedicated proxy entry + hosts file entry for the Reverb domain
 * - Updates the project .env with REVERB_* variables
 */

import { resolve, join } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { HostsFileProvider } from "../providers/hosts/hosts.js";
import { detectProxy } from "../detection/proxy.js";
import { log } from "./logger.js";

export interface ReverbConfig {
  domain: string;
  serverPort: number;
  appKey: string;
  appSecret: string;
  appId: string;
}

/** Check if a TCP port is already in use */
export function isPortInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.unref();
    server.on("error", () => resolve(true));
    server.listen(port, "0.0.0.0", () => {
      server.close(() => resolve(false));
    });
  });
}

/**
 * Register the Reverb domain in /etc/hosts and the web proxy (Caddy etc.).
 */
export async function registerReverbDomain(
  domain: string,
  serverPort: number,
  ssl: boolean,
  proxyPreference?: string
): Promise<void> {
  const hosts = new HostsFileProvider();
  await hosts.add(domain);
  log.dim(`  Added ${domain} to /etc/hosts`);

  const proxy = await detectProxy(proxyPreference);
  if (proxy) {
    await proxy.register({ domain, port: serverPort, ssl });
    log.dim(`  Registered ${domain} -> localhost:${serverPort} in ${proxy.name}`);
  } else {
    log.warn(`  No proxy found — Reverb accessible at ws://localhost:${serverPort} only`);
  }
}

/**
 * Update the Laravel .env file with REVERB_* and VITE_REVERB_* variables.
 */
export async function updateLaravelEnvForReverb(
  projectDir: string,
  config: ReverbConfig,
  ssl: boolean
): Promise<void> {
  const envPath = join(resolve(projectDir), ".env");
  if (!existsSync(envPath)) {
    log.warn("  .env not found — skipping Reverb env update");
    return;
  }

  let env = await readFile(envPath, "utf-8");

  const scheme = ssl ? "https" : "http";
  const publicPort = ssl ? 443 : config.serverPort;

  const reverbBlock = [
    `# Laravel Reverb Configuration (managed by orkestra)`,
    `# Public: ${config.domain}:${publicPort} -> localhost:${config.serverPort}`,
    `REVERB_APP_KEY=${config.appKey}`,
    `REVERB_APP_SECRET=${config.appSecret}`,
    `REVERB_APP_ID=${config.appId}`,
    `REVERB_HOST=${config.domain}`,
    `REVERB_PORT=${publicPort}`,
    `REVERB_SCHEME=${scheme}`,
    `REVERB_SERVER_HOST=0.0.0.0`,
    `REVERB_SERVER_PORT=${config.serverPort}`,
  ].join("\n");

  const viteBlock = [
    `VITE_REVERB_APP_KEY="\${REVERB_APP_KEY}"`,
    `VITE_REVERB_HOST="\${REVERB_HOST}"`,
    `VITE_REVERB_PORT="\${REVERB_PORT}"`,
    `VITE_REVERB_SCHEME="\${REVERB_SCHEME}"`,
  ].join("\n");

  // Replace existing managed block or REVERB_ lines
  const managedBlockRe = /# Laravel Reverb Configuration \(managed by orkestra\)[\s\S]*?REVERB_SERVER_PORT=\d+/;
  const looseBlockRe = /REVERB_APP_KEY=[\s\S]*?REVERB_SERVER_PORT=\d+/;

  if (managedBlockRe.test(env)) {
    env = env.replace(managedBlockRe, reverbBlock);
  } else if (looseBlockRe.test(env)) {
    env = env.replace(looseBlockRe, reverbBlock);
  } else {
    env = env.trimEnd() + "\n\n" + reverbBlock + "\n";
  }

  // Replace or append VITE_REVERB_* block
  const viteRe = /VITE_REVERB_APP_KEY=[\s\S]*?VITE_REVERB_SCHEME=.*/;
  if (viteRe.test(env)) {
    env = env.replace(viteRe, viteBlock);
  } else {
    env = env.trimEnd() + "\n" + viteBlock + "\n";
  }

  await writeFile(envPath, env, "utf-8");
}

/**
 * Read existing REVERB_* values from .env (to pre-populate prompts).
 */
export async function parseExistingReverbConfig(
  projectDir: string
): Promise<Partial<ReverbConfig>> {
  const envPath = join(resolve(projectDir), ".env");
  if (!existsSync(envPath)) return {};

  const env = await readFile(envPath, "utf-8");
  const get = (key: string): string | undefined => {
    const m = env.match(new RegExp(`^${key}=(.+)$`, "m"));
    return m?.[1]?.trim().replace(/^["']|["']$/g, "");
  };

  return {
    appKey: get("REVERB_APP_KEY"),
    appSecret: get("REVERB_APP_SECRET"),
    appId: get("REVERB_APP_ID"),
    domain: get("REVERB_HOST"),
    serverPort: get("REVERB_SERVER_PORT") ? Number(get("REVERB_SERVER_PORT")) : undefined,
  };
}

/** Generate deterministic Reverb credentials from project name */
export function generateReverbCredentials(
  projectName: string
): Pick<ReverbConfig, "appKey" | "appSecret" | "appId"> {
  const slug = projectName.toLowerCase().replace(/[^a-z0-9]/g, "-");
  return {
    appKey: `${slug}-key`,
    appSecret: `${slug}-secret`,
    appId: `${slug}-id`,
  };
}

/** Inject reverbPort + reverbDomain into a .orkestra.yml YAML string */
export function injectReverbYaml(
  yaml: string,
  reverbPort: number,
  reverbDomain: string
): string {
  const lines = yaml.trimEnd().split("\n").filter(
    (l) =>
      !l.startsWith("reverbPort:") &&
      !l.startsWith("reverbDomain:") &&
      !l.includes("Reverb WebSocket:")
  );

  return (
    lines.join("\n") +
    "\n" +
    `# Reverb WebSocket: binds to ${reverbPort}, proxied as ${reverbDomain}\n` +
    `reverbPort: ${reverbPort}\n` +
    `reverbDomain: ${reverbDomain}\n`
  );
}
