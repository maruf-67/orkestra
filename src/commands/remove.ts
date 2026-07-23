import { resolve, join } from "node:path";
import { unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { log, spinner, heading } from "../utils/logger.js";
import { HostsFileProvider } from "../providers/hosts/hosts.js";
import { getProject, unregisterProject } from "../state/store.js";
import { detectProxy } from "../detection/proxy.js";
import { run } from "../utils/exec.js";

interface RemoveOptions {
  dir?: string;
  domain?: string;
}

export async function remove(options: RemoveOptions) {
  const projectDir = resolve(options.dir || process.cwd());

  heading("Remove Project");

  const project = await getProject(projectDir);
  if (!project) {
    log.error("Project not registered. Run `orkestra register` first.");
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

  // 4. Remove .orkestra.yml from project
  const ymlSpin = spinner("Removing config file...");
  ymlSpin.start();
  const configPath = join(projectDir, ".orkestra.yml");
  if (existsSync(configPath)) {
    await unlink(configPath);
    ymlSpin.succeed("Removed .orkestra.yml");
  } else {
    ymlSpin.succeed("No config file to remove");
  }

  // 5. Remove from state
  await unregisterProject(projectDir);

  log.success("Project removed successfully!");
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
