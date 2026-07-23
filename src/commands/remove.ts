import { resolve } from "node:path";
import { log, spinner, heading } from "../utils/logger.js";
import { HostsFileProvider } from "../providers/hosts/hosts.js";
import { getProject, unregisterProject } from "../state/store.js";
import { detectProxy } from "../detection/proxy.js";

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

  // Remove from hosts
  const hostsSpin = spinner("Updating hosts file...");
  hostsSpin.start();
  const hosts = new HostsFileProvider();
  await hosts.remove(project.domain);
  hostsSpin.succeed(`Removed ${project.domain} from hosts file`);

  // Remove from proxy
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

  // Remove from state
  await unregisterProject(projectDir);

  log.success("Project removed successfully!");
}
