import { run, isCommandAvailable, which } from "../utils/exec.js";

export interface ResolvedBinaries {
  php: string;
  composer: string;
  node: string;
  isMise: boolean;
}

export async function resolveBinaries(cwd: string): Promise<ResolvedBinaries> {
  let isMise = await isCommandAvailable("mise");
  let phpPath = "php";
  let composerPath = "composer";
  let nodePath = "node";

  if (isMise) {
    try {
      const phpRes = await run("mise", ["which", "php"], { cwd });
      if (phpRes.exitCode === 0 && phpRes.stdout.trim()) {
        phpPath = phpRes.stdout.trim();
      } else {
        const sysPhp = await which("php");
        if (sysPhp) phpPath = sysPhp;
      }

      const composerRes = await run("mise", ["which", "composer"], { cwd });
      if (composerRes.exitCode === 0 && composerRes.stdout.trim()) {
        composerPath = composerRes.stdout.trim();
      } else {
        const sysComposer = await which("composer");
        if (sysComposer) composerPath = sysComposer;
      }

      const nodeRes = await run("mise", ["which", "node"], { cwd });
      if (nodeRes.exitCode === 0 && nodeRes.stdout.trim()) {
        nodePath = nodeRes.stdout.trim();
      } else {
        const sysNode = await which("node");
        if (sysNode) nodePath = sysNode;
      }
    } catch {
      isMise = false;
    }
  } else {
    const sysPhp = await which("php");
    if (sysPhp) phpPath = sysPhp;
    const sysComposer = await which("composer");
    if (sysComposer) composerPath = sysComposer;
    const sysNode = await which("node");
    if (sysNode) nodePath = sysNode;
  }

  return {
    php: phpPath,
    composer: composerPath,
    node: nodePath,
    isMise,
  };
}
