import { run } from "../utils/exec.js";

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
