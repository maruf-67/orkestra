import { appendFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { run } from "../utils/exec.js";

/**
 * Deployment-local files that must survive `git reset --hard`.
 *
 * `.orkestra.yml` records the port/domain actually bound on this host. A
 * `reset --hard origin/<branch>` reverts it to the repository default, which
 * then rewrites Caddy and systemd units against the wrong port.
 */
const DEPLOY_LOCAL_FILES = [".orkestra.yml"];

async function ensureResetExemptions(dir: string): Promise<void> {
  const excludePath = join(dir, ".git", "info", "exclude");
  if (!existsSync(excludePath)) return;

  let current = "";
  try {
    const res = await run("cat", [excludePath], { cwd: dir });
    if (res.exitCode === 0) current = res.stdout;
  } catch {}

  const missing = DEPLOY_LOCAL_FILES.filter(
    (f) => !current.split("\n").some((l) => l.trim() === f)
  );
  if (missing.length === 0) return;

  const block = `${current.trimEnd()}${current.trim() ? "\n" : ""}\n# Added by orkestra: deployment-local config must survive git reset --hard\n${missing.join("\n")}\n`;
  await appendFile(excludePath, block, "utf-8");
}

export interface GitInfo {
  branch: string;
  commit: string;
  shortCommit: string;
  author: string;
  message: string;
}

export async function isGitRepository(dir: string): Promise<boolean> {
  const res = await run("git", ["rev-parse", "--is-inside-work-tree"], { cwd: dir });
  return res.exitCode === 0 && res.stdout.trim() === "true";
}

export async function getCurrentGitInfo(dir: string): Promise<GitInfo | null> {
  if (!(await isGitRepository(dir))) return null;

  try {
    const branchRes = await run("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: dir });
    const branch = branchRes.stdout.trim();

    const commitRes = await run("git", ["rev-parse", "HEAD"], { cwd: dir });
    const commit = commitRes.stdout.trim();
    const shortCommit = commit.substring(0, 7);

    const logRes = await run("git", ["log", "-1", "--format=%an|||%s"], { cwd: dir });
    const [author, message] = logRes.stdout.trim().split("|||");

    return {
      branch,
      commit,
      shortCommit,
      author: author || "unknown",
      message: message || "",
    };
  } catch {
    return null;
  }
}

export async function syncGitBranch(
  dir: string,
  targetBranch: string = "main",
  strategy: "reset" | "pull" = "reset"
): Promise<{ previousCommit: string; currentCommit: string; updated: boolean }> {
  const initial = await getCurrentGitInfo(dir);
  const previousCommit = initial?.commit || "";

  // 1. Fetch latest changes
  const fetchRes = await run("git", ["fetch", "origin", targetBranch], { cwd: dir });
  if (fetchRes.exitCode !== 0) {
    // Try generic fetch
    await run("git", ["fetch", "origin"], { cwd: dir });
  }

  // 2. Checkout target branch if not currently on it
  if (initial?.branch !== targetBranch) {
    const checkoutRes = await run("git", ["checkout", targetBranch], { cwd: dir });
    if (checkoutRes.exitCode !== 0) {
      // Try checkout with track
      await run("git", ["checkout", "-B", targetBranch, `origin/${targetBranch}`], { cwd: dir });
    }
  }

  // 3. Apply sync strategy
  // Exempt deployment-local config from `reset --hard` before syncing so the
  // port/domain bound on this host is never reverted to the repo default.
  await ensureResetExemptions(dir);

  if (strategy === "reset") {
    const resetRes = await run("git", ["reset", "--hard", `origin/${targetBranch}`], { cwd: dir });
    if (resetRes.exitCode !== 0) {
      throw new Error(`Git reset --hard origin/${targetBranch} failed: ${resetRes.stderr}`);
    }
  } else {
    const pullRes = await run("git", ["pull", "origin", targetBranch], { cwd: dir });
    if (pullRes.exitCode !== 0) {
      throw new Error(`Git pull origin ${targetBranch} failed: ${pullRes.stderr}`);
    }
  }

  const updated = await getCurrentGitInfo(dir);
  const currentCommit = updated?.commit || "";

  return {
    previousCommit,
    currentCommit,
    updated: previousCommit !== currentCommit,
  };
}

export async function checkoutCommit(dir: string, commitSha: string): Promise<void> {
  const res = await run("git", ["checkout", commitSha], { cwd: dir });
  if (res.exitCode !== 0) {
    throw new Error(`Failed to checkout commit ${commitSha}: ${res.stderr}`);
  }
}
