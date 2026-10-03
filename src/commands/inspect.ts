import { resolve, basename } from "node:path";
import { heading, table } from "../utils/logger.js";
import { providerRegistry } from "../deployment/providers/registry.js";
import { resolveBinaries } from "../services/mise-resolver.js";
import { detectDatabases } from "../detection/database.js";
import { loadConfig } from "../config/loader.js";
import { getProject } from "../state/store.js";
import { resolvePorts } from "../deployment/ports.js";

interface InspectOptions {
  dir?: string;
  json?: boolean;
}

export async function inspect(dirOption?: string, options?: InspectOptions) {
  const targetDir = resolve(dirOption || options?.dir || process.cwd());
  const config = await loadConfig(targetDir);
  const existingProject = await getProject(targetDir);
  const resolved = await providerRegistry.resolve(targetDir);
  const binaries = await resolveBinaries(targetDir);
  const databases = await detectDatabases(targetDir);

  const projectName = config?.name || existingProject?.name || basename(targetDir);
  const frameworkName = resolved?.detection.framework || "unknown";
  const language = resolved?.detection.language || "unknown";
  const packageManager = resolved?.detection.packageManager || "unknown";
  const runtime = resolved?.detection.runtime || "node";
  const detectedDbs = databases.filter((d) => d.detected).map((d) => d.name);

  // Same resolution chain as deploy, so `inspect` reports the deployed port.
  const ports = resolvePorts(config, {
    state: existingProject,
    projectName,
    defaultApiPort: resolved?.detection.defaultPort ?? 3000,
  });
  const { apiPort: port, apiDomain: domain, reverbPort } = ports;

  if (options?.json) {
    console.log(
      JSON.stringify(
        {
          project: projectName,
          path: targetDir,
          framework: frameworkName,
          version: resolved?.detection.version,
          language,
          packageManager,
          runtime,
          binaries,
          port,
          domain,
          reverbPort,
          databases: detectedDbs,
          capabilities: resolved?.detection.capabilities || {},
        },
        null,
        2
      )
    );
    return;
  }

  heading(`Project Inspection: ${projectName}`);
  table([
    ["Framework", `${frameworkName} ${resolved?.detection.version ? `(${resolved.detection.version})` : ""}`],
    ["Language", language],
    ["Package Manager", packageManager],
    ["Runtime", `${runtime} (${binaries.isMise ? "Mise managed" : "system"})`],
    ["Build Command", resolved?.detection.buildCommand || "none"],
    ["Start Command", resolved?.detection.startCommand || "none"],
  ]);

  heading("Network & Proxy");
  table([
    ["Domain", `https://${domain}`],
    ["Internal Port", String(port)],
    ...(ports.reverbDomain
      ? [["Reverb Domain", `wss://${ports.reverbDomain}`], ["Reverb Port", String(reverbPort)] as [string, string]]
      : []),
    ["Proxy Provider", typeof config?.proxy === "string" ? config.proxy : config?.proxy?.provider || "caddy"],
  ]);

  heading("Infrastructure & Capabilities");
  const detectedDbText = detectedDbs.length > 0 ? detectedDbs.join(", ") : "None detected";
  table([
    ["Databases", detectedDbText],
    ["Octane", resolved?.detection.capabilities.hasOctane ? `Yes (${resolved.detection.capabilities.octaneServer})` : "No"],
    ["Queue Workers", resolved?.detection.capabilities.hasQueue ? "Yes" : "No"],
    ["Reverb (WebSocket)", resolved?.detection.capabilities.hasReverb ? "Yes" : "No"],
  ]);
}
