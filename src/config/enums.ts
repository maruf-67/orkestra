/**
 * The controlled vocabularies of the CLI and the MCP server.
 *
 * Every list here previously existed only as prose in an option description or
 * as a comment. Nothing enforced them, and each one failed silently rather than
 * loudly when given a value it did not recognise:
 *
 *   --strategy resset   fell through to the `else` branch in git.ts and ran
 *                       `git pull` instead of `git reset --hard`
 *   --provider localtunel
 *                       detectShareProvider() fell through to auto-detect and
 *                       silently picked a different provider
 *   --stream err        matched no log entries, so the command printed nothing
 *   --shell fish        was accepted by Commander and then discarded entirely
 *   orkestra_services_action { action: "enable" }
 *                       matched no branch, did nothing, and returned a
 *                       success-shaped payload
 *
 * A mistyped value that silently selects different behaviour is the same class
 * of failure as a mistyped port that silently selects a different port. Both are
 * caught here instead.
 *
 * Keep these aligned with the Zod enums in ./schema.ts — where a value is
 * constrained in both places, the lists must agree.
 */

/** `git.ts` treats anything that is not "reset" as a pull, so this must be exact. */
export const GIT_STRATEGIES = ["reset", "pull"] as const;
export type GitStrategy = (typeof GIT_STRATEGIES)[number];

/**
 * Mirrors `proxySectionSchema` in ./schema.ts.
 *
 * Traefik has a registered, implemented provider (detection/proxy.ts) but is
 * deliberately absent here: it is not selectable through the documented surface
 * and has no test coverage, so listing it would advertise an unverified path.
 */
export const PROXY_PROVIDERS = ["auto", "caddy", "apache", "nginx"] as const;
export type ProxyProviderName = (typeof PROXY_PROVIDERS)[number];

/** Matches the `stream` field written by the logger. */
export const LOG_STREAMS = ["stdout", "stderr"] as const;
export type LogStream = (typeof LOG_STREAMS)[number];

/** Interactive shells `orkestra shell` is allowed to spawn. */
export const SHELLS = ["bash", "zsh", "fish", "sh"] as const;
export type ShellName = (typeof SHELLS)[number];

/**
 * How to start each shell interactively.
 *
 * Every one of these accepts `-i`. Kept as an explicit table rather than
 * assuming a shared flag, so adding a shell has to state its arguments rather
 * than inherit whatever the previous one used.
 */
export const SHELL_ARGS: Record<ShellName, string[]> = {
  bash: ["-i"],
  zsh: ["-i"],
  fish: ["-i"],
  sh: ["-i"],
};

/** Mirrors the registered share providers. */
export const SHARE_PROVIDERS = ["localtunnel"] as const;

/**
 * Mirrors the methods on the systemd service wrapper. An unrecognised action
 * must be rejected, not ignored.
 */
export const SERVICE_ACTIONS = ["start", "stop", "restart", "reload"] as const;
export type ServiceAction = (typeof SERVICE_ACTIONS)[number];

/**
 * Validate a value against a controlled vocabulary.
 *
 * Returns the narrowed value, or throws naming the field and listing what is
 * valid. Throwing is deliberate: every caller of this is a place that would
 * otherwise do the wrong thing quietly.
 */
export function requireEnum<T extends readonly string[]>(
  value: unknown,
  allowed: T,
  field: string,
): T[number] {
  if (typeof value === "string" && (allowed as readonly string[]).includes(value)) {
    return value as T[number];
  }
  const shown = typeof value === "string" ? `"${value}"` : String(value);
  throw new Error(
    `Invalid ${field}: ${shown}. Expected one of: ${allowed.join(", ")}.`,
  );
}

/**
 * Validate an optional value, leaving undefined alone.
 *
 * Commander and the MCP protocol both omit unset options, so undefined is a
 * legitimate "not supplied" and must not be turned into an error.
 */
export function requireOptionalEnum<T extends readonly string[]>(
  value: unknown,
  allowed: T,
  field: string,
): T[number] | undefined {
  if (value === undefined || value === null) return undefined;
  return requireEnum(value, allowed, field);
}

/**
 * A systemd unit name.
 *
 * `orkestra_services_action` hands this straight to `sudo systemctl`, so it is
 * validated rather than trusted: the argument comes from an MCP client, which
 * means from a model, which means from text an attacker may have influenced.
 * Without a shape check, `serviceName` is an arbitrary string into a
 * privilege-adjacent call.
 */
export function requireServiceName(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error("Invalid serviceName: expected a systemd unit name.");
  }
  if (!/^[A-Za-z0-9@_.-]+\.service$/.test(value)) {
    throw new Error(
      `Invalid serviceName: "${value}". Expected a systemd unit name such as ` +
        `orkestra-texel-api-octane.service (letters, digits, @ _ . - only).`,
    );
  }
  return value;
}

/**
 * A directory an MCP client asked us to operate on.
 *
 * Deploy, rollback and inspect all take a path and then act on it with sudo
 * available. Requiring an absolute path is what stops `dir: "../../etc"` from
 * being silently resolved against the caller's working directory, which is not
 * something the caller necessarily intended.
 */
export function requireProjectDir(value: unknown): string {
  const raw = value === undefined || value === null || value === "" ? process.cwd() : value;
  if (typeof raw !== "string") {
    throw new Error("Invalid dir: expected a path string.");
  }
  if (!raw.startsWith("/") && !/^[A-Za-z]:[\\/]/.test(raw)) {
    throw new Error(
      `Invalid dir: "${raw}". Expected an absolute path to the project directory.`,
    );
  }
  return raw;
}

/**
 * A commit to roll back to.
 *
 * `orkestra_rollback` feeds this to `git checkout <sha>`. Constraining it to hex
 * prevents two problems at once: naming an arbitrary branch or tag when the
 * caller believed they were naming a commit, and passing something beginning
 * with `-`, which git would read as an option rather than a revision.
 */
export function requireCommitSha(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{7,40}$/i.test(value.trim())) {
    throw new Error(
      `Invalid toCommit: ${JSON.stringify(value)}. Expected a commit SHA ` +
        `(7-40 hexadecimal characters).`,
    );
  }
  return value.trim();
}

/** A TCP port supplied by a client rather than read from config. */
export function requirePort(value: unknown, field = "port"): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > 65535
  ) {
    throw new Error(
      `Invalid ${field}: ${JSON.stringify(value)}. Expected an integer between 1 and 65535.`,
    );
  }
  return value;
}

/**
 * A result count.
 *
 * Unbounded, `args.limit` reached `readLogs` and the audit reader directly. A
 * model asked for "all the logs" should get a large finite number, not whatever
 * integer it happened to emit.
 */
export function requireLimit(value: unknown, max = 1000, field = "limit"): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new Error(
      `Invalid ${field}: ${JSON.stringify(value)}. Expected a positive integer.`,
    );
  }
  if (value > max) {
    throw new Error(
      `Invalid ${field}: ${value} exceeds the maximum of ${max}.`,
    );
  }
  return value;
}