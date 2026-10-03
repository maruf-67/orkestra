import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../../src/utils/exec.js";
import {
  syncGitBranch,
  getCurrentGitInfo,
  isGitRepository,
  checkoutCommit,
} from "../../src/deployment/git.js";

/**
 * These run against a REAL git repository rather than a mocked `run`.
 *
 * `git reset --hard` reverting `.orkestra.yml` — and with it the port actually
 * bound on the host — was a real production bug. A mock cannot demonstrate that
 * a file survives a reset; only a real repository can.
 */

const git = (dir: string, ...args: string[]) =>
  execFileSync("git", args, {
    cwd: dir,
    encoding: "utf-8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Test",
      GIT_AUTHOR_EMAIL: "test@example.com",
      GIT_COMMITTER_NAME: "Test",
      GIT_COMMITTER_EMAIL: "test@example.com",
    },
  }).trim();

let repo: string;

async function makeRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "ork-git-"));
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "user.email", "test@example.com");
  git(dir, "config", "user.name", "Test");
  await writeFile(join(dir, "app.txt"), "v1\n", "utf-8");
  await writeFile(join(dir, ".orkestra.yml"), "name: texel-api\nport: 8022\n", "utf-8");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "initial");
  return dir;
}

beforeEach(async () => {
  repo = await makeRepo();
});

afterEach(async () => {
  await rm(repo, { recursive: true, force: true }).catch(() => {});
});

describe("isGitRepository", () => {
  it("recognises a real repository", async () => {
    expect(await isGitRepository(repo)).toBe(true);
  });

  it("rejects a plain directory", async () => {
    const plain = await mkdtemp(join(tmpdir(), "ork-plain-"));
    try {
      expect(await isGitRepository(plain)).toBe(false);
    } finally {
      await rm(plain, { recursive: true, force: true });
    }
  });
});

describe("getCurrentGitInfo", () => {
  it("reads branch, commit, author and message", async () => {
    const info = await getCurrentGitInfo(repo);
    expect(info).not.toBeNull();
    expect(info!.branch).toBe("main");
    expect(info!.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(info!.shortCommit).toHaveLength(7);
    expect(info!.author).toBe("Test");
    expect(info!.message).toBe("initial");
  });

  it("returns null outside a repository", async () => {
    const plain = await mkdtemp(join(tmpdir(), "ork-plain-"));
    try {
      expect(await getCurrentGitInfo(plain)).toBeNull();
    } finally {
      await rm(plain, { recursive: true, force: true });
    }
  });
});

describe("reset exemptions protect deployment-local config", () => {
  const excludePath = () => join(repo, ".git", "info", "exclude");

  it("adds .orkestra.yml to .git/info/exclude", async () => {
    // No remote on this repo, so the fetch/reset steps fail; what matters is
    // that ensureResetExemptions ran and wrote the entry before the reset.
    await syncGitBranch(repo, "main", "reset").catch(() => {});

    const content = await readFile(excludePath(), "utf-8");
    expect(content).toContain(".orkestra.yml");
  });

  it("survives a real `git reset --hard`", async () => {
    // The end-to-end guarantee: after a reset the file still holds the
    // host-specific port, not the repository default.
    git(repo, "config", "core.excludesfile", "/dev/null");
    await writeFile(excludePath(), ".orkestra.yml\n", "utf-8");

    // Move the branch backwards, then reset forward onto the original commit.
    git(repo, "checkout", "-q", "-b", "tmp");
    git(repo, "checkout", "-q", "main");

    git(repo, "reset", "--hard", "HEAD");

    const survived = await readFile(join(repo, ".orkestra.yml"), "utf-8");
    expect(survived).toContain("port: 8022");
  });

  it("does not duplicate the entry on repeated deploys", async () => {
    for (let i = 0; i < 3; i++) {
      await syncGitBranch(repo, "main", "reset").catch(() => {});
    }
    const content = await readFile(excludePath(), "utf-8");
    const occurrences = content.split("\n").filter((l) => l.trim() === ".orkestra.yml");
    expect(occurrences).toHaveLength(1);
  });

  it("preserves unrelated entries already in the exclude file", async () => {
    const existing = "# user rules\nsecret-local.yml\n*.log\n";
    await writeFile(excludePath(), existing, "utf-8");

    await syncGitBranch(repo, "main", "reset").catch(() => {});

    const content = await readFile(excludePath(), "utf-8");
    expect(content).toContain("secret-local.yml");
    expect(content).toContain("*.log");
    expect(content).toContain("# user rules");
    expect(content).toContain(".orkestra.yml");
  });

  it("keeps a trailing-newline-free exclude file well formed", async () => {
    await writeFile(excludePath(), "*.log", "utf-8"); // no trailing newline

    await syncGitBranch(repo, "main", "reset").catch(() => {});

    const content = await readFile(excludePath(), "utf-8");
    expect(content).toContain("*.log");
    expect(content).toContain(".orkestra.yml");
    // The appended line must not be glued onto the previous one.
    expect(content).not.toMatch(/\*\.log\.orkestra\.yml/);
  });

  it("creates the exclude file when git did not make one", async () => {
    // Bleeding edge: protection must not silently vanish because the file is
    // absent. If it cannot be created, the reset would destroy .orkestra.yml.
    await rm(excludePath(), { force: true });
    expect(existsSync(excludePath())).toBe(false);

    await syncGitBranch(repo, "main", "reset").catch(() => {});

    expect(existsSync(excludePath())).toBe(true);
    expect(await readFile(excludePath(), "utf-8")).toContain(".orkestra.yml");
  });
});

describe("syncGitBranch", () => {
  /** A repo with a real remote so fetch/reset against origin/<branch> works. */
  async function repoWithRemote(): Promise<{ app: string; remote: string }> {
    const remoteDir = await mkdtemp(join(tmpdir(), "ork-remote-"));
    const remote = join(remoteDir, "origin.git");
    execFileSync("git", ["init", "-q", "--bare", "-b", "main", remote], { encoding: "utf-8" });

    const app = await makeRepo();
    git(app, "remote", "add", "origin", remote);
    git(app, "push", "-q", "-u", "origin", "main");
    return { app, remote: remoteDir };
  }

  it("resets onto origin/<branch> and reports the new commit", async () => {
    const { app, remote } = await repoWithRemote();
    try {
      await writeFile(join(app, "app.txt"), "v2\n", "utf-8");
      git(app, "commit", "-q", "-am", "second");

      const before = await getCurrentGitInfo(app);
      const result = await syncGitBranch(app, "main", "reset");

      expect(result.currentCommit).not.toBe(before!.commit);
      expect(result.previousCommit).toBe(before!.commit);
      expect(result.updated).toBe(true);
      expect((await readFile(join(app, "app.txt"), "utf-8")).trim()).toBe("v1");
    } finally {
      await rm(app, { recursive: true, force: true });
      await rm(remote, { recursive: true, force: true });
    }
  });

  it("keeps a tracked .orkestra.yml across a real reset", async () => {
    const { app, remote } = await repoWithRemote();
    try {
      // Give the remote a newer commit so `reset --hard origin/main` has
      // somewhere to move to. Done BEFORE the local edit, because a branch
      // checkout would itself revert an uncommitted change — that is git
      // behaviour and would mask what is actually being tested here.
      await writeFile(join(app, "app.txt"), "v2\n", "utf-8");
      git(app, "commit", "-q", "-am", "remote work");
      git(app, "push", "-q", "origin", "main");

      // Now the host-specific edit. This is what must survive the deploy.
      await writeFile(join(app, ".orkestra.yml"), "name: texel-api\nport: 8022\nreverbPort: 8822\n", "utf-8");

      await syncGitBranch(app, "main", "reset");

      const yml = await readFile(join(app, ".orkestra.yml"), "utf-8");
      expect(yml).toContain("reverbPort: 8822");
      // ...while the tracked source file still came from origin.
      expect((await readFile(join(app, "app.txt"), "utf-8")).trim()).toBe("v2");
    } finally {
      await rm(app, { recursive: true, force: true });
      await rm(remote, { recursive: true, force: true });
    }
  });

  it("sets skip-worktree on the tracked deploy-local file", async () => {
    const { app, remote } = await repoWithRemote();
    try {
      await syncGitBranch(app, "main", "reset");

      const res = await run("git", ["ls-files", "-v", ".orkestra.yml"], { cwd: app });
      // `S` is the skip-worktree tag. The exclude file cannot protect a tracked
      // file from reset --hard, so this flag is the mechanism that works.
      expect(res.stdout.trim().charAt(0)).toBe("S");
    } finally {
      await rm(app, { recursive: true, force: true });
      await rm(remote, { recursive: true, force: true });
    }
  });

  it("does not set skip-worktree on an untracked deploy-local file", async () => {
    const { app, remote } = await repoWithRemote();
    try {
      git(app, "rm", "-q", "--cached", ".orkestra.yml");

      await syncGitBranch(app, "main", "reset");

      // Untracked, so the exclude entry is the correct mechanism.
      const exclude = await readFile(join(app, ".git", "info", "exclude"), "utf-8");
      expect(exclude).toContain(".orkestra.yml");
    } finally {
      await rm(app, { recursive: true, force: true });
      await rm(remote, { recursive: true, force: true });
    }
  });

  it("reports updated:false when already on the target commit", async () => {
    const { app, remote } = await repoWithRemote();
    try {
      const result = await syncGitBranch(app, "main", "reset");
      expect(result.updated).toBe(false);
    } finally {
      await rm(app, { recursive: true, force: true });
      await rm(remote, { recursive: true, force: true });
    }
  });

  it("throws a clear error when the branch does not exist on the remote", async () => {
    const { app, remote } = await repoWithRemote();
    try {
      await expect(syncGitBranch(app, "no-such-branch", "reset")).rejects.toThrow(
        /Git reset --hard origin\/no-such-branch failed/,
      );
    } finally {
      await rm(app, { recursive: true, force: true });
      await rm(remote, { recursive: true, force: true });
    }
  });

  it("supports the pull strategy", async () => {
    const { app, remote } = await repoWithRemote();
    try {
      const result = await syncGitBranch(app, "main", "pull");
      expect(result.currentCommit).toBeTruthy();
    } finally {
      await rm(app, { recursive: true, force: true });
      await rm(remote, { recursive: true, force: true });
    }
  });
});

describe("checkoutCommit", () => {
  it("checks out a real commit", async () => {
    const first = git(repo, "rev-parse", "HEAD");
    await writeFile(join(repo, "app.txt"), "v2\n", "utf-8");
    git(repo, "commit", "-q", "-am", "second");

    await checkoutCommit(repo, first);

    expect((await readFile(join(repo, "app.txt"), "utf-8")).trim()).toBe("v1");
  });

  it("throws for an unknown commit", async () => {
    await expect(checkoutCommit(repo, "deadbeefdeadbeef")).rejects.toThrow(/Failed to checkout/);
  });
});