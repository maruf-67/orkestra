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

/**
 * Tools that must exist for the resolved paths to be meaningful.
 *
 * `php` and `composer` are not optional: their paths are baked into systemd
 * units as `ExecStart`. If resolution falls back to a bare command name,
 * systemd runs the service with a minimal PATH, and the unit either fails to
 * start or silently picks up a different system PHP than the project needs.
 * That failure is invisible at deploy time, so it is surfaced here instead.
 */
const REQUIRED = new Set(["php", "composer"]);

export class BinaryResolutionError extends Error {
  constructor(
    readonly tool: string,
    readonly reason: string,
    readonly hint: string,
  ) {
    super(
      `Cannot resolve "${tool}" to a real executable: ${reason}. ${hint}`,
    );
    this.name = "BinaryResolutionError";
  }
}

/**
 * Resolve a tool to an absolute path via mise, then the system PATH.
 *
 * Returns the bare tool name only when a real executable was found for it; an
 * unresolvable required tool throws rather than degrading silently.
 */
async function resolveTool(
  tool: string,
  cwd: string,
  isMise: boolean,
  trustProject: boolean,
): Promise<string> {
  if (isMise) {
    // A project-local mise config is untrusted by default. Without trusting it,
    // `mise which` reports the tool as inactive even when it is installed, and
    // the deploy silently falls through to whatever is on the system PATH.
    if (trustProject) {
      await run("mise", ["trust", cwd]).catch(() => {});
    }

    const res = await run("mise", ["which", tool], { cwd });
    if (res.exitCode === 0 && res.stdout.trim()) {
      return res.stdout.trim().split("\n")[0].trim();
    }

    const detail = (res.stderr || res.stdout || `exit ${res.exitCode}`).trim();
    const sysPath = await which(tool);
    if (sysPath) {
      // mise is installed but did not resolve this tool. Using the system
      // binary risks a version the project does not target, so for the tools
      // whose path ends up in a systemd unit that is fatal rather than silent.
      if (REQUIRED.has(tool)) {
        throw new BinaryResolutionError(
          tool,
          `mise is installed but "mise which ${tool}" failed (${detail}); a different ${tool} was found at ${sysPath}`,
          `Run "mise install ${tool}@<version>" in ${cwd}, or check "mise.toml" for the required version.`,
        );
      }
      return sysPath;
    }

    // Optional tools (node, bun, pnpm, yarn, npm) are allowed to be absent:
    // they are not ExecStart paths, so a bare name is harmless and lets the
    // rest of the toolchain resolve.
    if (!REQUIRED.has(tool)) return tool;

    throw new BinaryResolutionError(
      tool,
      `"mise which ${tool}" failed (${detail}) and no ${tool} was found on the system PATH`,
      `Run "mise install ${tool}@<version>" in ${cwd}, or install ${tool} system-wide.`,
    );
  }

  const sysPath = await which(tool);
  if (sysPath) return sysPath;

  // No mise: only fail for tools whose path ends up in a systemd unit.
  if (REQUIRED.has(tool)) {
    throw new BinaryResolutionError(
      tool,
      `${tool} was not found on the system PATH and mise is not installed`,
      `Install ${tool}, or install mise so project toolchains are used.`,
    );
  }
  return tool;
}

export async function resolveBinaries(
  cwd: string,
  options: { trustProject?: boolean } = {},
): Promise<ResolvedBinaries> {
  const isMise = await isCommandAvailable("mise");
  const trustProject = options.trustProject ?? true;

  const [php, composer, node, bun, pnpm, yarn, npm] = await Promise.all([
    resolveTool("php", cwd, isMise, trustProject),
    resolveTool("composer", cwd, isMise, trustProject),
    resolveTool("node", cwd, isMise, trustProject),
    resolveTool("bun", cwd, isMise, trustProject),
    resolveTool("pnpm", cwd, isMise, trustProject),
    resolveTool("yarn", cwd, isMise, trustProject),
    resolveTool("npm", cwd, isMise, trustProject),
  ]);

  return { php, composer, node, bun, pnpm, yarn, npm, isMise };
}