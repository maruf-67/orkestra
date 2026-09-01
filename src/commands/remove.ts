import { resolve, join } from "node:path";
import { unlink, rm, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { log, spinner, heading } from "../utils/logger.js";
import { HostsFileProvider } from "../providers/hosts/hosts.js";
import { getProject, unregisterProject } from "../state/store.js";
import { detectProxy } from "../detection/proxy.js";
import { run } from "../utils/exec.js";
import { isWindows, isLinux } from "../platform/index.js";
import { systemd } from "../services/systemd.js";
import { parse as parseYaml } from "yaml";

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

  // 1. Remove from hosts (main + any reverb domains in yml/state)
  const hostsSpin = spinner("Updating hosts file...");
  hostsSpin.start();
  const hosts = new HostsFileProvider();
  await hosts.remove(project.domain);
  // also clean reverb domains if present in .orkestra.yml
  for (const rd of await collectReverbDomains(projectDir, project)) {
    await hosts.remove(rd);
  }
  hostsSpin.succeed(`Removed ${project.domain} from hosts file`);

  // 2. Remove from proxy (Caddy config) — main + reverb domains
  if (project.proxy !== "none") {
    const proxySpin = spinner("Removing proxy config...");
    proxySpin.start();
    const proxy = await detectProxy(project.proxy);
    if (proxy) {
      await proxy.unregister(project.domain);
      for (const rd of await collectReverbDomains(projectDir, project)) {
        await proxy.unregister(rd);
      }
      proxySpin.succeed("Proxy config removed (including Reverb)");
    } else {
      proxySpin.fail("Proxy not found, skipping proxy cleanup");
    }
  }

  // 2b. Remove systemd services (production) — orkestra-<name>-*.service
  if (isLinux()) {
    const svcSpin = spinner("Removing systemd services...");
    svcSpin.start();
    const svcTypes: Array<"octane" | "queue" | "reverb" | "web"> = ["octane", "queue", "reverb", "web"];
    let svcCleaned = 0;
    for (const t of svcTypes) {
      const svc = systemd.getServiceName(project.name, t as any);
      // best-effort stop/disable/rm even if not active
      try { await run("systemctl", ["stop", svc], { sudo: true }); } catch {}
      try { await run("systemctl", ["disable", svc], { sudo: true }); } catch {}
      try { await run("rm", ["-f", join("/etc/systemd/system", svc)], { sudo: true }); svcCleaned++; } catch {}
    }
    try { await run("systemctl", ["daemon-reload"], { sudo: true }); } catch {}
    try { await run("systemctl", ["reset-failed"], { sudo: true }); } catch {}
    svcSpin.succeed(svcCleaned ? `Systemd services removed (${svcCleaned} units)` : "No systemd services to remove");
  }

  // 3. Remove SSL certificates (main + reverb)
  const certSpin = spinner("Removing certificates...");
  certSpin.start();
  let certsRemoved = await removeCerts(project.domain);
  for (const rd of await collectReverbDomains(projectDir, project)) {
    if (await removeCerts(rd)) certsRemoved = true;
  }
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

async function removeLogs(projectDir: string, _projectName: string): Promise<boolean> {
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

async function collectReverbDomains(projectDir: string, project: any): Promise<string[]> {
  const out: string[] = [];
  // from .orkestra.yml services.reverb.domain or reverbDomain
  try {
    const ymlPath = join(projectDir, ".orkestra.yml");
    if (existsSync(ymlPath)) {
      const raw = await readFile(ymlPath, "utf-8");
      const yml: any = parseYaml(raw);
      if (yml?.services?.reverb?.domain) out.push(String(yml.services.reverb.domain));
      if (yml?.reverbDomain) out.push(String(yml.reverbDomain));
    }
  } catch {}
  // from project state metadata if present
  if (project?.reverbDomain) out.push(String(project.reverbDomain));
  return [...new Set(out.filter(Boolean))];
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

  // Remove from Caddy cert directory
  const caddyCertDir = isWindows()
    ? join(homedir(), "AppData", "Roaming", "Caddy", "certs")
    : "/etc/caddy/certs";

  for (const ext of [".pem", "-key.pem"]) {
    const file = join(caddyCertDir, `${domain}${ext}`);
    if (isWindows()) {
      // Windows: No sudo needed
      if (existsSync(file)) {
        await unlink(file);
        removed = true;
      }
    } else {
      // Unix: Needs sudo
      try {
        await run("sudo", ["rm", "-f", file]);
        removed = true;
      } catch {}
    }
  }

  return removed;
}
