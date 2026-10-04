import { findAvailablePort, isPortOccupied } from "../state/ports.js";

/**
 * The single resolver for the port a local dev server binds.
 *
 * `orkestra up` and the health monitor's auto-restart both had their own copy of
 * this decision, and the copies disagreed. `up` consulted the port recorded in
 * orkestra's state; the monitor did not:
 *
 *     commands/up.ts      options.port || config?.port || existing?.port
 *                          || config?.port || framework.port
 *     utils/health.ts     config?.port || framework.port
 *
 * For a project whose `.orkestra.yml` omits `port` — which is the normal shape
 * once `freezeAgainstState` has put the deployed port in state — the two
 * disagreed outright:
 *
 *     state port            8022
 *     .orkestra.yml port    (absent)
 *     framework default     3000
 *
 *     up() binds            8022
 *     monitor restarts onto 3000
 *
 * and because the monitor had no proxy reconfiguration, Caddy kept proxying to
 * 8022 while the app listened on 3000. The user's description of the symptom —
 * start it, kill it, let the monitor restart it, and the port has moved — is this
 * bug.
 *
 * Both callers now go through `selectDevPort` and `ensurePortAvailable`, so the
 * precedence cannot drift apart again.
 */

/** Used only when nothing at all is configured. */
export const DEFAULT_DEV_PORT = 3000;

/** Where the chosen port came from. Useful in diagnostics and in tests. */
export type DevPortSource = "cli" | "config" | "state" | "framework" | "default";

export interface DevPortSources {
  /** `--port` on the command line. */
  cliPort?: number | null;
  /** `port` in .orkestra.yml. */
  configPort?: number | null;
  /** The port recorded for this project in orkestra's state. */
  statePort?: number | null;
  /** The framework's own default. */
  frameworkPort?: number | null;
}

export interface DevPortDecision {
  /** The port to bind. */
  port: number;
  /** The port that was asked for, before any conflict resolution. */
  requestedPort: number;
  /** True when `port` differs from `requestedPort`. */
  moved: boolean;
  /** Which input supplied `requestedPort`. */
  source: DevPortSource;
}

/** A usable TCP port, or undefined. Mirrors deployment/ports.ts firstPort(). */
function asPort(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 65535) {
    return value;
  }
  return undefined;
}

/**
 * Resolve the port to use, before checking whether it is free.
 *
 * Pure: no I/O, so the precedence is directly testable. Order is
 * CLI > config > state > framework > default.
 *
 * State outranks the framework default deliberately. `.orkestra.yml` frequently
 * omits `port` because the deployed value lives in state, and ignoring state there
 * is what let the monitor restart onto a different port.
 */
export function selectDevPort(sources: DevPortSources): DevPortDecision {
  const candidates: Array<[DevPortSource, unknown]> = [
    ["cli", sources.cliPort],
    ["config", sources.configPort],
    ["state", sources.statePort],
    ["framework", sources.frameworkPort],
  ];

  for (const [source, raw] of candidates) {
    const port = asPort(raw);
    if (port !== undefined) {
      return { port, requestedPort: port, moved: false, source };
    }
  }

  return {
    port: DEFAULT_DEV_PORT,
    requestedPort: DEFAULT_DEV_PORT,
    moved: false,
    source: "default",
  };
}

export interface PortProbes {
  isPortOccupied: (port: number) => Promise<boolean>;
  findAvailablePort: (startPort: number, forProjectPath: string) => Promise<number>;
}

const realProbes: PortProbes = { isPortOccupied, findAvailablePort };

/**
 * Move off `requestedPort` only if something else is genuinely holding it.
 *
 * `forProjectPath` is not optional here. Without it the project's own recorded
 * port reads as "taken by someone else", and the app quietly moves to a different
 * port than the one registered — the original port-drift bug.
 */
export async function ensurePortAvailable(
  decision: DevPortDecision,
  projectDir: string,
  probes: PortProbes = realProbes,
): Promise<DevPortDecision> {
  if (!(await probes.isPortOccupied(decision.requestedPort))) {
    return decision;
  }

  const port = await probes.findAvailablePort(decision.requestedPort, projectDir);
  return { ...decision, port, moved: port !== decision.requestedPort };
}