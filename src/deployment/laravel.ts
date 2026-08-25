import { run } from "../utils/exec.js";

export interface LaravelDeployActions {
  phpBinary?: string;
  cwd: string;
  migrate?: boolean;
  seed?: boolean;
  optimize?: boolean;
}

export async function runLaravelMigrations(
  options: LaravelDeployActions
): Promise<{ success: boolean; output: string }> {
  const php = options.phpBinary || "php";
  const args = ["artisan", "migrate", "--force", "--no-interaction"];
  if (options.seed) {
    args.push("--seed");
  }

  const result = await run(php, args, { cwd: options.cwd });
  if (result.exitCode !== 0) {
    throw new Error(`Database migrations failed:\n${result.stderr || result.stdout}`);
  }

  return {
    success: true,
    output: result.stdout || result.stderr,
  };
}

export async function ensureStorageLink(
  options: LaravelDeployActions
): Promise<{ success: boolean }> {
  const php = options.phpBinary || "php";
  await run(php, ["artisan", "storage:link", "--no-interaction"], { cwd: options.cwd });
  return { success: true };
}

export async function optimizeLaravel(
  options: LaravelDeployActions
): Promise<{ success: boolean; output: string }> {
  const php = options.phpBinary || "php";
  const result = await run(php, ["artisan", "optimize", "--no-interaction"], { cwd: options.cwd });
  
  if (result.exitCode !== 0) {
    // Fall back to config:cache and route:cache if optimize command is unsupported
    await run(php, ["artisan", "config:cache", "--no-interaction"], { cwd: options.cwd });
    await run(php, ["artisan", "route:cache", "--no-interaction"], { cwd: options.cwd });
    await run(php, ["artisan", "view:cache", "--no-interaction"], { cwd: options.cwd });
  }

  return {
    success: true,
    output: result.stdout || result.stderr,
  };
}

export async function reloadOctane(
  options: LaravelDeployActions
): Promise<{ success: boolean }> {
  const php = options.phpBinary || "php";
  const result = await run(php, ["artisan", "octane:reload", "--no-interaction"], { cwd: options.cwd });
  return { success: result.exitCode === 0 };
}
