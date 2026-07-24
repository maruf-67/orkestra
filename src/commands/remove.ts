import { resolve, join, basename } from "node:path";
import { unlink, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { log, spinner, heading } from "../utils/logger.js";
import { HostsFileProvider } from "../providers/hosts/hosts.js";
import { getProject, unregisterProject } from "../state/store.js";
import { detectProxy } from "../detection/proxy.js";
import { run } from "../utils/exec.js";
import { loadConfig } from "../config/loader.js";

interface RemoveOptions {
  dir?: string;
}

export async function remove(options: RemoveOptions) {
  const projectDir = resolve(options.dir || process.cwd());

  heading("Remove Project");

  const project = await getProject(projectDir);
  if (!project) {
    log.error("Project not registered. Run `orkestra init` first.");
    process.exit(1);
  }

  log.info(`Removing: ${project.name} (${project.domain})`);

  // 1. Remove from hosts
  const hostsSpin = spinner("Updating hosts file...");
  hostsSpin.start();
  const hosts = new HostsFileProvider();
  await hosts.remove(project.domain);
  hostsSpin.succeed(`Removed ${project.domain} from hosts file`);

  // 2. Remove from proxy (Caddy config)
  if (project.proxy !== "none") {
    const proxySpin = spinner("Removing proxy config...");
    proxySpin.start();
    const proxy = await detectProxy(project.proxy);
    if (proxy) {
      await proxy.unregister(project.domain);
      proxySpin.succeed("Proxy config removed");
    } else {
      proxySpin.fail("Proxy not found, skipping proxy cleanup");
    }
  }

  // 3. Remove SSL certificates
  const certSpin = spinner("Removing certificates...");
  certSpin.start();
  const certsRemoved = await removeCerts(project.domain);
  certSpin.succeed(certsRemoved ? "Certificates removed" : "No certificates to remove");

  // 4. Remove log files
  const logSpin = spinner("Removing logs...");
  logSpin.start();
  const logsRemoved = await removeLogs(projectDir, project.name);
  logSpin.succeed(logsRemoved ? "Logs removed" : "No logs to remove");

  // 5. Remove .orkestra directory
  const dirSpin = spinner("Removing .orkestra directory...");
  dirSpin.start();
  const orkestraDir = join(projectDir, ".orkestra");
  if (existsSync(orkestraDir)) {
    await rm(orkestraDir, { recursive: true, force: true });
    dirSpin.succeed("Removed .orkestra directory");
  } else {
    dirSpin.succeed("No .orkestra directory to remove");
  }

  // 6. Remove .orkestra.yml from project
  const ymlSpin = spinner("Removing config file...");
  ymlSpin.start();
  const configPath = join(projectDir, ".orkestra.yml");
  if (existsSync(configPath)) {
    await unlink(configPath);
    ymlSpin.succeed("Removed .orkestra.yml");
  } else {
    ymlSpin.succeed("No config file to remove");
  }

  // 7. Remove from state
  await unregisterProject(projectDir);

  log.success("Project removed successfully!");
}

async function removeLogs(projectDir: string, projectName: string): Promise<boolean> {
  const logsDir = join(projectDir, ".orkestra", "logs");
  if (!existsSync(logsDir)) {
    return false;
  }

  try {
    await rm(logsDir, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

async function removeCerts(domain: string): Promise<boolean> {
  let removed = false;

  // Remove from ~/.orkestra/certs/
  const userCertDir = join(homedir(), ".orkestra", "certs");
  for (const ext of [".pem", "-key.pem"]) {
    const file = join(userCertDir, `${domain}${ext}`);
    if (existsSync(file)) {
      await unlink(file);
      removed = true;
    }
  }

  // Remove from /etc/caddy/certs/ (needs sudo)
  const caddyCertDir = "/etc/caddy/certs";
  for (const ext of [".pem", "-key.pem"]) {
    const file = `${caddyCertDir}/${domain}${ext}`;
    try {
      await run("sudo", ["rm", "-f", file]);
      removed = true;
    } catch {}
  }

  return removed;
}
