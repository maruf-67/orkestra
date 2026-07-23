import { readFile, writeFile, access } from "node:fs/promises";
import { join } from "node:path";

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Add a domain to vite.config / nuxt.config server.allowedHosts.
 */
export async function addAllowedHost(dir: string, domain: string): Promise<boolean> {
  const candidates = [
    { file: "nuxt.config.ts", handler: addHostToNuxtConfig },
    { file: "nuxt.config.js", handler: addHostToNuxtConfig },
    { file: "vite.config.ts", handler: addHostToViteConfig },
    { file: "vite.config.js", handler: addHostToViteConfig },
    { file: "vite.config.mjs", handler: addHostToViteConfig },
  ];

  for (const { file, handler } of candidates) {
    const filePath = join(dir, file);
    if (await fileExists(filePath)) {
      return handler(filePath, domain);
    }
  }
  return false;
}

async function addHostToNuxtConfig(filePath: string, domain: string): Promise<boolean> {
  const content = await readFile(filePath, "utf-8");
  if (content.includes(domain)) return false;

  // Already has allowedHosts array — add to it
  if (content.includes("allowedHosts")) {
    const updated = content.replace(
      /allowedHosts\s*:\s*\[([^\]]*)\]/,
      (_, existing) => {
        const hosts = existing.trim();
        const newEntry = hosts ? `${hosts}, "${domain}"` : `"${domain}"`;
        return `allowedHosts: [${newEntry}]`;
      }
    );
    await writeFile(filePath, updated, "utf-8");
    return true;
  }

  // Has vite block with server — add allowedHosts inside it
  if (/vite\s*:\s*\{[^}]*server\s*:/s.test(content)) {
    const updated = content.replace(
      /server\s*:\s*\{/,
      `server: {\n      allowedHosts: ["${domain}"],`
    );
    await writeFile(filePath, updated, "utf-8");
    return true;
  }

  // Has vite block but no server — add server inside it
  if (/vite\s*:\s*\{/.test(content)) {
    const updated = content.replace(
      /vite\s*:\s*\{/,
      `vite: {\n    server: {\n      allowedHosts: ["${domain}"]\n    },`
    );
    await writeFile(filePath, updated, "utf-8");
    return true;
  }

  // No vite block at all — add one inside defineNuxtConfig
  if (content.includes("defineNuxtConfig({")) {
    const updated = content.replace(
      /defineNuxtConfig\(\{/,
      `defineNuxtConfig({\n  vite: {\n    server: {\n      allowedHosts: ["${domain}"]\n    }\n  },`
    );
    await writeFile(filePath, updated, "utf-8");
    return true;
  }

  return false;
}

async function addHostToViteConfig(filePath: string, domain: string): Promise<boolean> {
  const content = await readFile(filePath, "utf-8");
  if (content.includes(domain)) return false;

  if (content.includes("allowedHosts")) {
    const updated = content.replace(
      /allowedHosts\s*:\s*\[([^\]]*)\]/,
      (_, existing) => {
        const hosts = existing.trim();
        const newEntry = hosts ? `${hosts}, "${domain}"` : `"${domain}"`;
        return `allowedHosts: [${newEntry}]`;
      }
    );
    await writeFile(filePath, updated, "utf-8");
    return true;
  }

  if (content.includes("server:")) {
    const updated = content.replace(
      /server\s*:\s*\{/,
      `server: {\n    allowedHosts: ["${domain}"],`
    );
    await writeFile(filePath, updated, "utf-8");
    return true;
  }

  const updated = content.replace(
    /defineConfig\(\{/,
    `defineConfig({\n  server: {\n    allowedHosts: ["${domain}"]\n  },`
  );
  if (updated !== content) {
    await writeFile(filePath, updated, "utf-8");
    return true;
  }

  return false;
}
