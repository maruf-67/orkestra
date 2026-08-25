import { run } from "../utils/exec.js";

export interface ComposerOptions {
  composerBinary?: string;
  flags?: string;
  cwd: string;
}

export async function installComposerDependencies(options: ComposerOptions): Promise<{ durationMs: number; output: string }> {
  const start = Date.now();
  const binary = options.composerBinary || "composer";
  const defaultFlags = ["install", "--no-dev", "--optimize-autoloader", "--prefer-dist", "--no-interaction"];
  
  let args = defaultFlags;
  if (options.flags) {
    args = options.flags.split(/\s+/).filter(Boolean);
    if (!args.includes("install")) {
      args.unshift("install");
    }
  }

  const result = await run(binary, args, {
    cwd: options.cwd,
  });

  const durationMs = Date.now() - start;

  if (result.exitCode !== 0) {
    throw new Error(`Composer install failed (exit ${result.exitCode}):\n${result.stderr || result.stdout}`);
  }

  return {
    durationMs,
    output: result.stdout || result.stderr,
  };
}
