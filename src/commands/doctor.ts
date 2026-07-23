import { existsSync } from "node:fs";
import { heading, log, table, spinner } from "../utils/logger.js";
import { isCommandAvailable } from "../utils/exec.js";
import { listFrameworks, listLanguages } from "../detection/framework.js";
import { detectProxy, listProxies } from "../detection/proxy.js";
import { detectRuntime, listRuntimes } from "../detection/runtime.js";
import { listPackageManagers, detectPackageManager } from "../detection/package-manager.js";
import { getPlatform, isWindows, isMacOS, isLinux } from "../platform/index.js";

export async function doctor() {
  heading("Orkestra Doctor");

  const osName = isWindows() ? "Windows" : isMacOS() ? "macOS" : isLinux() ? "Linux" : "Unknown";
  log.info(`OS: ${osName}`);

  // Supported languages & frameworks
  const languages = listLanguages();
  const frameworks = listFrameworks();
  heading("Languages & Frameworks");
  table([
    ["Languages", languages.join(", ")],
    ["Frameworks", frameworks.join(", ")],
  ]);

  // Runtime detection
  const runtimeSpin = spinner("Detecting runtimes...");
  runtimeSpin.start();
  const runtimes = listRuntimes();
  const runtimeResults: [string, string][] = [];
  for (const rt of runtimes) {
    const detected = await rt.detect();
    runtimeResults.push([rt.name, detected ? "✓" : "✗"]);
  }
  runtimeSpin.stop();

  heading("Runtime Managers");
  table(runtimeResults);

  // Proxy detection
  const proxySpin = spinner("Detecting proxies...");
  proxySpin.start();
  const proxies = listProxies();
  const proxyResults: [string, string][] = [];
  for (const px of proxies) {
    const detected = await px.detect();
    proxyResults.push([px.name, detected ? "✓" : "✗"]);
  }
  proxySpin.stop();

  heading("Proxies");
  table(proxyResults);

  // Package managers
  const pmSpin = spinner("Detecting package managers...");
  pmSpin.start();
  const pms = listPackageManagers();
  const pmResults: [string, string][] = [];
  for (const pm of pms) {
    const detected = await isCommandAvailable(pm.command);
    pmResults.push([pm.name, detected ? "✓" : "✗"]);
  }
  pmSpin.stop();

  heading("Package Managers");
  table(pmResults);

  // Config directory
  const platform = getPlatform();
  const configDirExists = existsSync(platform.configDir);
  heading("Configuration");
  table([
    ["Config dir", platform.configDir],
    ["Exists", configDirExists ? "✓" : "✗"],
    ["Hosts file", platform.hostsFile],
  ]);

  // Recommendations
  const recommendedProxy = await detectProxy();
  const recommendedRuntime = await detectRuntime();
  const recommendedPm = await detectPackageManager();

  heading("Recommendations");
  if (recommendedProxy) {
    log.success(`Proxy: ${recommendedProxy.name}`);
  } else {
    log.warn("No proxy detected. Install Caddy for local HTTPS domains.");
  }

  if (recommendedRuntime) {
    log.success(`Runtime: ${recommendedRuntime.name}`);
  } else {
    log.warn("No Node.js runtime detected.");
  }

  if (recommendedPm) {
    log.success(`Package manager: ${recommendedPm.name}`);
  } else {
    log.warn("No package manager detected.");
  }
}
