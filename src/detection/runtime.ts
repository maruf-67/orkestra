import type { RuntimeProvider } from "../providers/types.js";
import { MiseRuntime } from "../providers/runtime/mise.js";
import { NvmRuntime } from "../providers/runtime/nvm.js";
import { FnmRuntime } from "../providers/runtime/fnm.js";
import { AsdfRuntime } from "../providers/runtime/asdf.js";
import { VoltaRuntime } from "../providers/runtime/volta.js";
import { SystemRuntime } from "../providers/runtime/system.js";

const allProviders: RuntimeProvider[] = [
  new MiseRuntime(),
  new NvmRuntime(),
  new FnmRuntime(),
  new AsdfRuntime(),
  new VoltaRuntime(),
  new SystemRuntime(),
];

export async function detectRuntime(preferred?: string): Promise<RuntimeProvider | null> {
  if (preferred && preferred !== "auto") {
    const provider = allProviders.find((p) => p.name === preferred);
    if (provider && await provider.detect()) {
      return provider;
    }
    return null;
  }

  const sorted = [...allProviders].sort((a, b) => b.priority - a.priority);
  for (const provider of sorted) {
    if (await provider.detect()) {
      return provider;
    }
  }
  return null;
}

export function listRuntimes(): RuntimeProvider[] {
  return allProviders;
}
