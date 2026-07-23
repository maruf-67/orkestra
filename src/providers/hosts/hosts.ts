import { readFile, writeFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getPlatform } from "../../platform/index.js";
import { run } from "../../utils/exec.js";
import type { HostsProvider } from "../types.js";

export class HostsFileProvider implements HostsProvider {
  private async readHosts(): Promise<string> {
    const platform = getPlatform();
    return readFile(platform.hostsFile, "utf-8");
  }

  private async writeHosts(content: string): Promise<void> {
    const platform = getPlatform();
    // Write to temp file, then copy with sudo
    const tmpDir = await mkdtemp(join(tmpdir(), "orkestra-hosts-"));
    const tmpFile = join(tmpDir, "hosts");
    await writeFile(tmpFile, content, "utf-8");
    await run("cp", [tmpFile, platform.hostsFile], { sudo: true });
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
