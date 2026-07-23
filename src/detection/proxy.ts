import type { ProxyProvider } from "../providers/types.js";
import { CaddyProxy } from "../providers/proxy/caddy.js";

const allProviders: ProxyProvider[] = [new CaddyProxy()];

export async function detectProxy(preferred?: string): Promise<ProxyProvider | null> {
  if (preferred) {
    const provider = allProviders.find((p) => p.name === preferred);
    if (provider && await provider.detect()) {
      return provider;
    }
    return null;
  }

  // Sort by priority (highest first)
  const sorted = [...allProviders].sort((a, b) => b.priority - a.priority);
  for (const provider of sorted) {
    if (await provider.detect()) {
      return provider;
    }
  }
  return null;
}

export function listProxies(): ProxyProvider[] {
  return allProviders;
}
