import { run, isCommandAvailable, which } from "../utils/exec.js";

export interface ResolvedBinaries {
  php: string;
  composer: string;
  node: string;
  bun: string;
  pnpm: string;
  yarn: string;
  npm: string;
  isMise: boolean;
}

export async function resolveBinaries(cwd: string): Promise<ResolvedBinaries> {
  let isMise = await isCommandAvailable("mise");
  let phpPath = "php";
  let composerPath = "composer";
  let nodePath = "node";
  let bunPath = "bun";
  let pnpmPath = "pnpm";
  let yarnPath = "yarn";
  let npmPath = "npm";

  const resolveTool = async (tool: string, fallbackDefault: string): Promise<string> => {
    if (isMise) {
      try {
        const res = await run("mise", ["which", tool], { cwd });
        if (res.exitCode === 0 && res.stdout.trim()) {
          return res.stdout.trim();
        }
      } catch {}
    }
    const sysPath = await which(tool);
    return sysPath || fallbackDefault;
  };

  phpPath = await resolveTool("php", "php");
  composerPath = await resolveTool("composer", "composer");
  nodePath = await resolveTool("node", "node");
  bunPath = await resolveTool("bun", "bun");
  pnpmPath = await resolveTool("pnpm", "pnpm");
  yarnPath = await resolveTool("yarn", "yarn");
  npmPath = await resolveTool("npm", "npm");

  return {
    php: phpPath,
    composer: composerPath,
    node: nodePath,
    bun: bunPath,
    pnpm: pnpmPath,
    yarn: yarnPath,
    npm: npmPath,
    isMise,
  };
}
