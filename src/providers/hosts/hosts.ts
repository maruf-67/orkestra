import { readFile } from "node:fs/promises";
import { getPlatform } from "../../platform/index.js";
import { sudoWriteFile } from "../../utils/exec.js";
import type { HostsProvider } from "../types.js";

/**
 * Extract the hostnames mapped by a single hosts-file line.
 *
 * A hosts line is `<ip> <name> [alias...]`. Matching must be exact against
 * those names: a substring match on the domain would make `texelbd.com` also
 * match `api.texelbd.com`, so registering or removing the apex domain would
 * silently destroy every subdomain entry.
 */
export function hostnamesInLine(line: string): string[] {
  const withoutComment = line.split("#")[0];
  const parts = withoutComment.trim().split(/\s+/).filter(Boolean);
  // parts[0] is the address; the rest are names.
  return parts.slice(1).map((p) => p.toLowerCase().replace(/\.$/, ""));
}

export function lineMapsDomain(line: string, domain: string): boolean {
  const target = domain.toLowerCase().replace(/\.$/, "");
  return hostnamesInLine(line).some((h) => h === target);
}

export class HostsFileProvider implements HostsProvider {
  private async readHosts(): Promise<string> {
    const platform = getPlatform();
    return readFile(platform.hostsFile, "utf-8");
  }

  private async writeHosts(content: string): Promise<void> {
    const platform = getPlatform();
    await sudoWriteFile(platform.hostsFile, content);
  }

  async add(domain: string, ip = "127.0.0.1"): Promise<void> {
    const content = await this.readHosts();
    const target = domain.toLowerCase();
    const desired = `${ip}  ${domain}`;
    const lines = content.split("\n");

    // Already mapped to exactly this name and address: nothing to do. Compared
    // semantically rather than by string equality because hosts files use
    // varying whitespace. This is what makes repeated `init` calls idempotent.
    const alreadyMapped = lines.some((l) => {
      if (!lineMapsDomain(l, target)) return false;
      return l.trim().split(/\s+/)[0] === ip;
    });
    if (alreadyMapped) return;

    // Drop only entries mapping this exact domain under any address. Subdomain
    // entries such as `api.texelbd.com` must survive an apex-domain update.
    const kept = lines.filter((l) => !lineMapsDomain(l, target));

    await this.writeHosts(kept.join("\n").trimEnd() + "\n" + desired + "\n");
  }

  async remove(domain: string): Promise<void> {
    const content = await this.readHosts();
    const target = domain.toLowerCase();
    const newContent = content.split("\n").filter((line) => !lineMapsDomain(line, target)).join("\n");
    await this.writeHosts(newContent);
  }

  async has(domain: string): Promise<boolean> {
    const content = await this.readHosts();
    const target = domain.toLowerCase();
    return content.split("\n").some((line) => lineMapsDomain(line, target));
  }
}