import type { ShareProvider } from "./types.js";
import { CloudflareShare } from "./cloudflare.js";

export type { ShareProvider, ShareOptions, ShareSession, ShareStatus } from "./types.js";

const providers: ShareProvider[] = [
  new CloudflareShare(),
];

export async function detectShareProvider(preferred?: string): Promise<ShareProvider | null> {
  // If preferred provider specified, try that first
  if (preferred) {
    const provider = providers.find(p => p.name === preferred);
    if (provider && await provider.detect()) {
      return provider;
    }
  }

  // Auto-detect by priority
  for (const provider of providers) {
    if (await provider.detect()) {
      return provider;
    }
  }

  return null;
}

export function getShareProviders(): ShareProvider[] {
  return [...providers];
}
