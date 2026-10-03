import type { OrkestraConfig } from "../config/schema.js";
import type { ProjectState } from "../state/store.js";

/**
 * Single source of truth for deployment port/domain resolution.
 *
 * Every consumer (providers, redeploy, services listing, systemd unit
 * rendering) MUST resolve ports through this module. Previously the precedence
 * chain was duplicated in five places, which let a Reverb unit silently fall
 * back to 8080 while the resolved port elsewhere said 8822.
 */

/** Fallback ports used only when nothing else is configured. */
export const DEFAULT_API_PORT = 8000;
export const DEFAULT_REVERB_PORT = 8080;

export interface ResolvedPorts {
  /** Public HTTP port (Octane or Laravel web). */
  apiPort: number;
  /** WebSocket (Reverb) port. */
  reverbPort: number;
  /** Public HTTP domain. */
  apiDomain: string;
  /** WebSocket domain, when a realtime proxy endpoint is configured. */
  reverbDomain?: string;
}

function proxySection(config?: OrkestraConfig | null) {
  return typeof config?.proxy === "object" ? config.proxy : undefined;
}

function firstPort(...candidates: Array<number | undefined | null>): number | undefined {
  for (const c of candidates) {
    if (typeof c === "number" && Number.isInteger(c) && c >= 1024 && c <= 65535) {
      return c;
    }
  }
  return undefined;
}

/**
 * Merge deployment state over config so a deployed port/domain always wins.
 *
 * `deploy`/`redeploy` call this after `git reset --hard` reverts
 * `.orkestra.yml` to a repository default that may not match what is actually
 * bound on the host.
 */
export function freezeAgainstState(
  config: OrkestraConfig | null | undefined,
  state: ProjectState | null | undefined
): OrkestraConfig | null {
  if (!config || !state) return config ?? null;

  const merged: OrkestraConfig = { ...config };
  const mutable = merged as Record<string, any>;
  const services = merged.services;
  const proxy = proxySection(merged);

  if (state.domain) merged.domain = state.domain;
  if (typeof state.port === "number") merged.port = state.port;
  if (typeof state.reverbPort === "number") {
    merged.reverbPort = state.reverbPort;
    if (services?.reverb) services.reverb.port = state.reverbPort;
  }
  if (state.reverbDomain) {
    merged.reverbDomain = state.reverbDomain;
    if (services?.reverb) services.reverb.domain = state.reverbDomain;
  }

  // Keep the structured proxy section consistent with the frozen values so
  // providers that read `config.proxy.api` cannot drift from `config.port`.
  if (proxy?.api) {
    if (state.domain) proxy.api.domain = state.domain;
    if (typeof state.port === "number") proxy.api.port = state.port;
  }
  if (proxy?.realtime) {
    if (state.reverbDomain) proxy.realtime.domain = state.reverbDomain;
    if (typeof state.reverbPort === "number") proxy.realtime.port = state.reverbPort;
  }

  // `mutable` retained for future structured overrides without a cast at each site.
  void mutable;
  return merged;
}

/**
 * Resolve the HTTP and WebSocket ports/domains for a project.
 *
 * Precedence (highest first):
 *   1. deployed state (`~/.orkestra/state.json`) — authoritative, survives
 *      `git reset --hard`
 *   2. `proxy.api` / `proxy.realtime` — explicit public endpoints
 *   3. `services.octane` / `services.reverb`
 *   4. top-level `port` / `reverbPort`
 *   5. framework defaults
 */
export function resolvePorts(
  config: OrkestraConfig | null | undefined,
  options: {
    state?: ProjectState | null;
    projectName?: string;
    defaultApiPort?: number;
  } = {}
): ResolvedPorts {
  const state = options.state ?? null;
  const cfg = state ? freezeAgainstState(config, state) : config ?? null;

  const proxy = proxySection(cfg);
  const projectName = options.projectName ?? cfg?.name ?? "app";

  const apiPort =
    firstPort(
      state?.port,
      proxy?.api?.port,
      cfg?.services?.octane?.port,
      cfg?.port,
      options.defaultApiPort,
      DEFAULT_API_PORT
    ) ?? DEFAULT_API_PORT;

  const reverbPort =
    firstPort(
      state?.reverbPort,
      proxy?.realtime?.port,
      cfg?.services?.reverb?.port,
      cfg?.reverbPort,
      DEFAULT_REVERB_PORT
    ) ?? DEFAULT_REVERB_PORT;

  const apiDomain =
    state?.domain ??
    proxy?.api?.domain ??
    cfg?.domain ??
    cfg?.services?.reverb?.domain ??
    `${projectName}.dev.com`;

  const reverbDomain =
    state?.reverbDomain ??
    proxy?.realtime?.domain ??
    cfg?.reverbDomain ??
    cfg?.services?.reverb?.domain ??
    undefined;

  return { apiPort, reverbPort, apiDomain, reverbDomain };
}