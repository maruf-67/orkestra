import { readFile } from "node:fs/promises";
import { getPlatform } from "../../platform/index.js";
import { sudoWriteFile } from "../../utils/exec.js";
import type { HostsProvider } from "../types.js";

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
    const line = `${ip}  ${domain}`;

    if (content.includes(line)) return;

    // Remove old entry if exists, then add
    const cleaned = content
      .split("\n")
      .filter((l) => !l.includes(domain))
      .join("\n");

    const newContent = cleaned.trimEnd() + "\n" + line + "\n";
    await this.writeHosts(newContent);
  }

  async remove(domain: string): Promise<void> {
    const content = await this.readHosts();
    const newContent = content
      .split("\n")
      .filter((line) => !line.includes(domain))
      .join("\n");
    await this.writeHosts(newContent);
  }

  async has(domain: string): Promise<boolean> {
    const content = await this.readHosts();
    return content.includes(domain);
  }
}
