import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { FrameworkInfo } from "../providers/types.js";

interface FrameworkDetector {
  name: string;
  language: string;
  configFiles: string[];
  defaultPort: number;
  detect(dir: string): Promise<boolean>;
  getVersion?(dir: string): Promise<string>;
}

async function readJson(dir: string, file: string): Promise<Record<string, unknown> | null> {
  try {
    const content = await readFile(join(dir, file), "utf-8");
    return JSON.parse(content);
  } catch {
    return null;
  }
}

async function readText(dir: string, file: string): Promise<string> {
  try {
    return await readFile(join(dir, file), "utf-8");
  } catch {
    return "";
  }
}

const detectors: FrameworkDetector[] = [
  // ── PHP / Laravel ──────────────────────────────────────────────
  {
    name: "laravel",
    language: "php",
    configFiles: ["composer.json", "artisan"],
    defaultPort: 8000,
    detect: async (dir) => {
      const composer = await readJson(dir, "composer.json");
      return (composer?.require as Record<string, string>)?.["laravel/framework"] !== undefined;
    },
    getVersion: async (dir) => {
      const composer = await readJson(dir, "composer.json");
      return ((composer?.require as Record<string, string>)?.["laravel/framework"] as string) || "unknown";
    },
  },
  {
    name: "symfony",
    language: "php",
    configFiles: ["composer.json", "symfony.lock"],
    defaultPort: 8000,
    detect: async (dir) => {
      const composer = await readJson(dir, "composer.json");
      if (!composer) return false;
      const require = composer.require as Record<string, string> | undefined;
      const requireDev = composer["require-dev"] as Record<string, string> | undefined;
      return require?.["symfony/framework-bundle"] !== undefined || requireDev?.["symfony/framework-bundle"] !== undefined;
    },
  },

  // ── JavaScript / TypeScript ────────────────────────────────────
  {
    name: "next.js",
    language: "javascript",
    configFiles: ["next.config.js", "next.config.mjs", "next.config.ts"],
    defaultPort: 3000,
    detect: async (dir) => {
      const pkg = await readJson(dir, "package.json");
      if (!pkg) return false;
      const allDeps = { ...(pkg.dependencies as object), ...(pkg.devDependencies as object) };
      return allDeps?.["next"] !== undefined;
    },
    getVersion: async (dir) => {
      const pkg = await readJson(dir, "package.json");
      const allDeps = { ...(pkg?.dependencies as object), ...(pkg?.devDependencies as object) };
      return (allDeps?.["next"] as string) || "unknown";
    },
  },
  {
    name: "nuxt",
    language: "javascript",
    configFiles: ["nuxt.config.ts", "nuxt.config.js", "nuxt.config.mjs"],
    defaultPort: 3000,
    detect: async (dir) => {
      const pkg = await readJson(dir, "package.json");
      return (pkg?.dependencies as Record<string, string>)?.["nuxt"] !== undefined;
    },
    getVersion: async (dir) => {
      const pkg = await readJson(dir, "package.json");
      return ((pkg?.dependencies as Record<string, string>)?.["nuxt"] as string) || "unknown";
    },
  },
  {
    name: "remix",
    language: "javascript",
    configFiles: ["remix.config.js", "remix.config.ts", "remix.config.mjs"],
    defaultPort: 3000,
    detect: async (dir) => {
      const pkg = await readJson(dir, "package.json");
      if (!pkg) return false;
      const allDeps = { ...(pkg.dependencies as object), ...(pkg.devDependencies as object) };
      return allDeps?.["@remix-run/react"] !== undefined || allDeps?.["remix"] !== undefined;
    },
  },
  {
    name: "astro",
    language: "javascript",
    configFiles: ["astro.config.mjs", "astro.config.ts", "astro.config.js"],
    defaultPort: 4321,
    detect: async (dir) => {
      const pkg = await readJson(dir, "package.json");
      return (pkg?.dependencies as Record<string, string>)?.["astro"] !== undefined;
    },
  },
  {
    name: "sveltekit",
    language: "javascript",
    configFiles: ["svelte.config.js", "svelte.config.ts"],
    defaultPort: 5173,
    detect: async (dir) => {
      const pkg = await readJson(dir, "package.json");
      return (pkg?.devDependencies as Record<string, string>)?.["@sveltejs/kit"] !== undefined;
    },
  },
  {
    name: "vite",
    language: "javascript",
    configFiles: ["vite.config.ts", "vite.config.js", "vite.config.mjs"],
    defaultPort: 5173,
    detect: async (dir) => {
      const pkg = await readJson(dir, "package.json");
      return (pkg?.devDependencies as Record<string, string>)?.["vite"] !== undefined;
    },
  },
  {
    name: "express",
    language: "javascript",
    configFiles: [],
    defaultPort: 3000,
    detect: async (dir) => {
      const pkg = await readJson(dir, "package.json");
      return (pkg?.dependencies as Record<string, string>)?.["express"] !== undefined;
    },
  },
  {
    name: "fastify",
    language: "javascript",
    configFiles: [],
    defaultPort: 3000,
    detect: async (dir) => {
      const pkg = await readJson(dir, "package.json");
      return (pkg?.dependencies as Record<string, string>)?.["fastify"] !== undefined;
    },
  },

  // ── Python ─────────────────────────────────────────────────────
  {
    name: "fastapi",
    language: "python",
    configFiles: ["requirements.txt", "pyproject.toml", "Pipfile"],
    defaultPort: 8000,
    detect: async (dir) => {
      const req = await readText(dir, "requirements.txt");
      if (req.includes("fastapi")) return true;
      const pyproject = await readText(dir, "pyproject.toml");
      if (pyproject.includes("fastapi")) return true;
      const pipfile = await readText(dir, "Pipfile");
      return pipfile.includes("fastapi");
    },
  },
  {
    name: "flask",
    language: "python",
    configFiles: ["requirements.txt", "pyproject.toml", "Pipfile"],
    defaultPort: 5000,
    detect: async (dir) => {
      const req = await readText(dir, "requirements.txt");
      if (req.includes("flask") && !req.includes("fastapi")) return true;
      const pyproject = await readText(dir, "pyproject.toml");
      if (pyproject.includes("flask") && !pyproject.includes("fastapi")) return true;
      const pipfile = await readText(dir, "Pipfile");
      return pipfile.includes("flask") && !pipfile.includes("fastapi");
    },
  },
  {
    name: "django",
    language: "python",
    configFiles: ["manage.py", "settings.py"],
    defaultPort: 8000,
    detect: async (dir) => {
      const manage = await readText(dir, "manage.py");
      return manage.includes("django");
    },
  },
  {
    name: "python",
    language: "python",
    configFiles: ["requirements.txt", "pyproject.toml", "setup.py", "Pipfile", "uv.lock"],
    defaultPort: 8000,
    detect: async (dir) => {
      // Generic Python project — has any Python project indicator but no specific framework
      const hasReq = (await readText(dir, "requirements.txt")).length > 0;
      const hasPyproject = (await readText(dir, "pyproject.toml")).length > 0;
      const hasSetup = (await readText(dir, "setup.py")).length > 0;
      const hasPipfile = (await readText(dir, "Pipfile")).length > 0;
      const hasUv = (await readText(dir, "uv.lock")).length > 0;
      return hasReq || hasPyproject || hasSetup || hasPipfile || hasUv;
    },
  },

  // ── Go ─────────────────────────────────────────────────────────
  {
    name: "go",
    language: "go",
    configFiles: ["go.mod", "go.sum"],
    defaultPort: 8080,
    detect: async (dir) => {
      const gomod = await readText(dir, "go.mod");
      return gomod.startsWith("module ") || gomod.includes("\nmodule ");
    },
    getVersion: async (dir) => {
      const gomod = await readText(dir, "go.mod");
      const match = gomod.match(/^go\s+(\d+\.\d+)/m);
      return match ? match[1] : "unknown";
    },
  },

  // ── Rust ───────────────────────────────────────────────────────
  {
    name: "rust",
    language: "rust",
    configFiles: ["Cargo.toml", "Cargo.lock"],
    defaultPort: 8080,
    detect: async (dir) => {
      const cargo = await readText(dir, "Cargo.toml");
      return cargo.includes("[package]");
    },
    getVersion: async (dir) => {
      const cargo = await readText(dir, "Cargo.toml");
      const match = cargo.match(/^edition\s*=\s*"(\d+)"/m);
      return match ? `20${match[1]}` : "unknown";
    },
  },

  // ── Generic Node.js ────────────────────────────────────────────
  {
    name: "node.js",
    language: "javascript",
    configFiles: ["package.json"],
    defaultPort: 3000,
    detect: async (dir) => {
      const pkg = await readJson(dir, "package.json");
      return pkg !== null;
    },
  },
];

export async function detectFramework(dir: string): Promise<FrameworkInfo | null> {
  for (const detector of detectors) {
    if (await detector.detect(dir)) {
      const version = detector.getVersion ? await detector.getVersion(dir) : "unknown";
      return {
        name: detector.name,
        language: detector.language,
        version,
        port: detector.defaultPort,
        configFiles: detector.configFiles,
      };
    }
  }
  return null;
}

export async function detectFrameworkByName(
  dir: string,
  name: string
): Promise<FrameworkInfo | null> {
  const detector = detectors.find((d) => d.name === name);
  if (!detector) return null;
  if (!(await detector.detect(dir))) return null;
  const version = detector.getVersion ? await detector.getVersion(dir) : "unknown";
  return {
    name: detector.name,
    language: detector.language,
    version,
    port: detector.defaultPort,
    configFiles: detector.configFiles,
  };
}

export function listFrameworks(): string[] {
  return detectors.map((d) => d.name);
}

export function listLanguages(): string[] {
  return [...new Set(detectors.map((d) => d.language))];
}
