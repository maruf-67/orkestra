import type { ApplicationProvider, ApplicationDetection } from "./types.js";
import { LaravelProvider } from "./laravel/provider.js";
import { NextjsProvider } from "./nextjs/provider.js";
import { NuxtProvider } from "./nuxt/provider.js";

export class ProviderRegistry {
  private providers: ApplicationProvider[] = [];

  constructor() {
    this.register(new LaravelProvider());
    this.register(new NextjsProvider());
    this.register(new NuxtProvider());
  }

  register(provider: ApplicationProvider): void {
    this.providers.push(provider);
  }

  async resolve(
    dir: string
  ): Promise<{ provider: ApplicationProvider; detection: ApplicationDetection } | null> {
    for (const provider of this.providers) {
      const detection = await provider.detect(dir);
      if (detection) {
        return { provider, detection };
      }
    }
    return null;
  }

  list(): ApplicationProvider[] {
    return [...this.providers];
  }
}

export const providerRegistry = new ProviderRegistry();
