import type { ProxyProvider, RuntimeProvider, ProcessProvider } from "../providers/types.js";

export interface PluginManifest {
  name: string;
  version: string;
  description: string;
  author: string;
  type: "proxy" | "runtime" | "process" | "framework";
  entry: string;
}

export interface Plugin {
  manifest: PluginManifest;
  proxy?: ProxyProvider;
  runtime?: RuntimeProvider;
  process?: ProcessProvider;
}

/**
 * Plugin SDK for extending Orkestra.
 *
 * To create a plugin:
 * 1. Create a directory in ~/.orkestra/plugins/<plugin-name>/
 * 2. Add a plugin.json with the manifest
 * 3. Add an index.js that exports the plugin
 *
 * Example plugin.json:
 * {
 *   "name": "my-proxy",
 *   "version": "1.0.0",
 *   "description": "My custom proxy provider",
 *   "author": "me",
 *   "type": "proxy",
 *   "entry": "index.js"
 * }
 *
 * Example index.js:
 * module.exports = {
 *   proxy: {
 *     name: "my-proxy",
 *     priority: 50,
 *     detect: async () => true,
 *     register: async (config) => { ... },
 *     unregister: async (domain) => { ... },
 *     reload: async () => { ... }
 *   }
 * }
 */

export function createProxyPlugin(manifest: PluginManifest, provider: ProxyProvider): Plugin {
  return { manifest, proxy: provider };
}

export function createRuntimePlugin(manifest: PluginManifest, provider: RuntimeProvider): Plugin {
  return { manifest, runtime: provider };
}

export function createProcessPlugin(manifest: PluginManifest, provider: ProcessProvider): Plugin {
  return { manifest, process: provider };
}
