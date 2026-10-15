import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ProxyProvider, ProxyConfig } from "../types.js";
import { run, isCommandAvailable, sudoWriteFile, sudoRemoveFile } from "../../utils/exec.js";
import { getPlatform, isWindows } from "../../platform/index.js";

function isLocalDomain(domain: string): boolean {
  const d = domain.toLowerCase();
  return (
    d.endsWith(".test") ||
    d.endsWith(".local") ||
    d.endsWith(".localhost") ||
    d === "localhost" ||
    d.endsWith(".internal")
  );
}

export class CaddyProxy implements ProxyProvider {
  readonly name = "caddy";
  readonly priority = 100;

  async detect(): Promise<boolean> {
    return isCommandAvailable("caddy");
  }

  private getConfigPath(): string {
    const platform = getPlatform();
    return join(platform.caddyConfigDir, "Caddyfile");
  }

  private async readConfig(): Promise<string> {
    const configPath = this.getConfigPath();
    if (existsSync(configPath)) {
      return readFile(configPath, "utf-8");
    }
    return "";
  }

  private async writeConfig(config: string): Promise<void> {
    await sudoWriteFile(this.getConfigPath(), config);
  }

  private generateBlock(config: ProxyConfig): string {
    if (config.ssl) {
      if (isLocalDomain(config.domain)) {
        // Caddy built-in internal CA for local development (zero external dependencies, never hangs)
        return `${config.domain} {
  tls internal
  reverse_proxy localhost:${config.port}
}
`;
      }
      // Public domain in production: Caddy manages automatic TLS with Let's Encrypt / ZeroSSL
      return `${config.domain} {
  reverse_proxy localhost:${config.port}
}
`;
    }

    return `http://${config.domain} {
  reverse_proxy localhost:${config.port}
}
`;
  }

  private escapeDomain(domain: string): string {
    return domain.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  /**
   * Find the byte range of a site block, honouring nested braces.
   *
   * A flat `^\\s*domain\\s*\\{[^}]*\\}` cannot be used here: any Caddy block
   * containing a nested block (`tls { }`, `handle { }`, `route { }`,
   * `header { }`) ends at the *first* `}`, so a rewrite would replace only the
   * opening portion and orphan the rest of the block, leaving an invalid
   * Caddyfile behind. Scanning with a depth counter keeps the whole block
   * intact.
   *
   * Returns null when the domain has no block.
   */
  private findBlockRange(config: string, domain: string): { start: number; end: number } | null {
    const esc = this.escapeDomain(domain);
    // Site header: start of line, optional whitespace, optional scheme, the
    // domain, then the opening brace. Matches `texelbd.com {`,
    // `http://texelbd.com {` and `api.texelbd.com {`.
    const header = new RegExp(`^[ \\t]*(?:https?:\\/\\/)?${esc}[ \\t]*\\{`, "m");
    const match = header.exec(config);
    if (!match) return null;

    const start = match.index;
    let depth = 0;

    // Walk the block counting braces so nested blocks are included. Quotes are
    // tracked so a `}` inside a matcher or header value does not confuse the
    // count.
    let inQuote: string | null = null;
    for (let i = match.index + match[0].length - 1; i < config.length; i++) {
      const ch = config[i];

      if (inQuote) {
        if (ch === "\\") {
          i++;
        } else if (ch === inQuote) {
          inQuote = null;
        }
        continue;
      }

      if (ch === '"' || ch === "'" || ch === "`") {
        inQuote = ch;
        continue;
      }

      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          // Consume the trailing newline so repeated edits do not accumulate
          // blank lines.
          let end = i + 1;
          if (config[end] === "\r") end++;
          if (config[end] === "\n") end++;
          return { start, end };
        }
      }
    }

    // Unbalanced braces: fall back to end-of-file rather than corrupting.
    return { start, end: config.length };
  }

  async register(config: ProxyConfig): Promise<void> {
    const existing = await this.readConfig();
    const block = this.generateBlock(config);

    await this.writeAndReload(
      this.substitute(existing, config.domain, block),
    );
  }

  async registerMultiple(configs: ProxyConfig[]): Promise<void> {
    let currentConfig = await this.readConfig();

    for (const config of configs) {
      currentConfig = this.substitute(currentConfig, config.domain, this.generateBlock(config));
    }

    await this.writeAndReload(currentConfig);
  }

  async unregister(domain: string): Promise<void> {
    const existing = await this.readConfig();
    const range = this.findBlockRange(existing, domain);
    if (!range) return;

    const remaining = (existing.slice(0, range.start) + existing.slice(range.end))
      // Collapse the blank line the removed block would have left behind.
      .replace(/\n{3,}/g, "\n\n")
      .trim();

    await this.writeAndReload(remaining ? remaining + "\n" : "");
  }

  /** Replace the block for `domain` with `block`, or append it if absent. */
  private substitute(config: string, domain: string, block: string): string {
    const range = this.findBlockRange(config, domain);
    if (range) {
      return (config.slice(0, range.start) + block + config.slice(range.end)).trimEnd() + "\n";
    }
    const separator = config.trim() ? "\n\n" : "";
    return config.trim() + separator + block;
  }

  /**
   * Write the config, prove Caddy accepts it, then reload.
   *
   * Previously the reload result was discarded, so a config Caddy rejected
   * still reported success — the same silent-drift class as the port bug. The
   * sequence is now: validate, write, reload, and on any failure restore the
   * previous config and reload again so a bad edit cannot take the proxy down.
   */
  private async writeAndReload(next: string): Promise<void> {
    const previous = await this.readConfig();

    const validation = await this.validate(next);
    if (!validation.ok) {
      // Distinguish "Caddy rejected this config" from "we could not check it".
      // Calling a permission failure an invalid Caddyfile is what sent the
      // original report looking for a syntax problem in a config that was fine.
      const headline =
        validation.reason === "staging-failed"
          ? `Could not validate the generated Caddyfile; nothing was changed. ${validation.error}`
          : `Generated Caddyfile is invalid; nothing was changed. ${validation.error}`;
      throw new Error(headline);
    }

    await this.writeConfig(next);

    try {
      await this.reload();
    } catch (err) {
      // Roll back so the running proxy keeps serving the last good config.
      try {
        await this.writeConfig(previous);
        await this.reload();
      } catch {
        // Rollback itself failed; surface the original failure, which is the
        // actionable one.
      }
      throw new Error(
        `Caddy reload failed and the previous configuration was restored. ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Run `caddy validate` against config text without touching the live file.
   *
   * Three bugs lived here, and they compounded into one misleading error:
   *
   *  1. The candidate was staged with plain `writeFile`, while the real config is
   *     written with `sudoWriteFile`. `/etc/caddy` is root-owned, so staging
   *     failed with EACCES.
   *  2. That failure was swallowed by `.catch(() => {})`, so `caddy validate`
   *     then ran against a file that was never created and reported
   *     `open /etc/caddy/Caddyfile.orkestra-candidate: no such file or directory`.
   *  3. writeAndReload turned that into "Generated Caddyfile is invalid" — so a
   *     perfectly good config was rejected, and the message pointed at the config
   *     file instead of at the missing permission. `orkestra init` could not
   *     register any project at all.
   *
   * Staging now uses the same privileged write as the real config, a staging
   * failure is reported as a staging failure, and cleanup uses sudo too — a plain
   * `rm` cannot remove the root-owned candidate and left it behind.
   */
  private async validate(
    config: string,
  ): Promise<{
    ok: boolean;
    error: string;
    /** Why validation failed, so the caller can phrase it honestly. */
    reason?: "invalid" | "staging-failed";
  }> {
    if (!isCommandAvailable("caddy")) {
      // Nothing to validate against; let the reload decide.
      return { ok: true, error: "" };
    }

    // caddy validate reads a file, so the candidate is staged in the same
    // directory as the real config to keep relative `import` statements working.
    const configPath = this.getConfigPath();
    const stagedPath = `${configPath}.orkestra-candidate`;

    try {
      await sudoWriteFile(stagedPath, config);
    } catch (err) {
      // Do not fall through. Validating a file that does not exist produces an
      // error that reads like a config problem, which is what misdirected the
      // original report.
      return {
        ok: false,
        reason: "staging-failed",
        error:
          `Could not stage a candidate config at ${stagedPath} for validation: ` +
          `${err instanceof Error ? err.message : String(err)}. ` +
          `The configuration itself has not been checked.`,
      };
    }

    try {
      // The adapter is stated explicitly: the staged filename does not end in
      // a form Caddy reliably auto-detects, and without this Caddy parses the
      // file as JSON and rejects every config.
      const res = await run("caddy", [
        "validate",
        "--adapter",
        "caddyfile",
        "--config",
        stagedPath,
      ]);
      return {
        ok: res.exitCode === 0,
        reason: res.exitCode === 0 ? undefined : "invalid",
        error: (res.stderr || res.stdout || "").trim(),
      };
    } finally {
      // sudoWriteFile stages through `sudo cp`, so the candidate is root-owned
      // and a plain unlink fails. Leaving it behind would accumulate litter in
      // /etc/caddy and could shadow a later run.
      await sudoRemoveFile(stagedPath).catch(() => {});
    }
  }

  async reload(): Promise<void> {
    const platform = getPlatform();

    if (!isWindows() && await isCommandAvailable("systemctl")) {
      const checkActive = await run("systemctl", ["is-active", "caddy"]);
      if (checkActive.stdout.trim() === "active") {
        const res = await run("systemctl", ["reload", "caddy"], { sudo: true });
        if (res.exitCode === 0) return;
        throw new Error(
          `systemctl reload caddy failed: ${(res.stderr || res.stdout).trim()}`,
        );
      }
    }

    const [cmd, ...args] = platform.caddyReloadCmd;
    const res = await run(cmd, args, { sudo: !isWindows() });
    if (res.exitCode !== 0) {
      throw new Error(
        `${cmd} ${args.join(" ")} failed: ${(res.stderr || res.stdout).trim()}`,
      );
    }
  }
}
