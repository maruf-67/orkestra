import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  requireEnum,
  requireOptionalEnum,
  requireServiceName,
  requireProjectDir,
  requireCommitSha,
  requirePort,
  requireLimit,
  GIT_STRATEGIES,
  SERVICE_ACTIONS,
} from "../../src/config/enums.js";

/**
 * These guard the boundary where a mistyped value used to select different
 * behaviour without saying so.
 *
 * The reference failure: `git.ts` does
 *
 *     if (strategy === "reset") { git reset --hard ... } else { git pull ... }
 *
 * so `--strategy resset` did not fail — it ran `git pull`. Same class as a port
 * that silently changes, which is what this project has been fighting all along.
 */

describe("requireEnum", () => {
  it("accepts every documented value", () => {
    for (const s of GIT_STRATEGIES) {
      expect(requireEnum(s, GIT_STRATEGIES, "strategy")).toBe(s);
    }
    for (const a of SERVICE_ACTIONS) {
      expect(requireEnum(a, SERVICE_ACTIONS, "action")).toBe(a);
    }
  });

  it("rejects a near-miss instead of accepting it", () => {
    // The exact scenario: a typo that used to select the other git operation.
    expect(() => requireEnum("resset", GIT_STRATEGIES, "strategy")).toThrow(/Invalid strategy/);
  });

  it("is case sensitive, so Pull is not quietly treated as pull", () => {
    expect(() => requireEnum("Pull", GIT_STRATEGIES, "strategy")).toThrow(/Invalid strategy/);
  });

  it("lists the valid values so the caller can fix it", () => {
    expect(() => requireEnum("x", GIT_STRATEGIES, "strategy")).toThrow(/reset, pull/);
  });

  it("names the field in the message", () => {
    expect(() => requireEnum("x", GIT_STRATEGIES, "strategy")).toThrow(/strategy/);
    expect(() => requireEnum("x", SERVICE_ACTIONS, "action")).toThrow(/action/);
  });

  it("rejects empty string, null and non-strings", () => {
    expect(() => requireEnum("", GIT_STRATEGIES, "strategy")).toThrow();
    expect(() => requireEnum(null, GIT_STRATEGIES, "strategy")).toThrow();
    expect(() => requireEnum(1, GIT_STRATEGIES, "strategy")).toThrow();
    expect(() => requireEnum({}, GIT_STRATEGIES, "strategy")).toThrow();
    expect(() => requireEnum([], GIT_STRATEGIES, "strategy")).toThrow();
  });

  it("rejects an inherited object property", () => {
    // A prototype-pollution style value must not satisfy an `in`-style check.
    expect(() => requireEnum("toString", GIT_STRATEGIES, "strategy")).toThrow();
  });
});

describe("requireOptionalEnum", () => {
  it("leaves an omitted value alone", () => {
    // Commander and the MCP protocol both omit unset options; undefined must not
    // become an error or be turned into a default the caller did not ask for.
    expect(requireOptionalEnum(undefined, GIT_STRATEGIES, "strategy")).toBeUndefined();
    expect(requireOptionalEnum(null, GIT_STRATEGIES, "strategy")).toBeUndefined();
  });

  it("still rejects a supplied bad value", () => {
    expect(() => requireOptionalEnum("nope", GIT_STRATEGIES, "strategy")).toThrow(/Invalid strategy/);
  });

  it("returns the narrowed value when valid", () => {
    expect(requireOptionalEnum("pull", GIT_STRATEGIES, "strategy")).toBe("pull");
  });
});

describe("requireServiceName", () => {
  it("accepts a real unit name", () => {
    expect(requireServiceName("orkestra-texel-api-octane.service")).toBe(
      "orkestra-texel-api-octane.service",
    );
  });

  it("accepts the systemd escaping characters used in unit names", () => {
    // `@` and `_` are both legal in unit names.
    //
    // A unit name containing `@` is shaped like an email address, which
    // orkestra's own secret scanner correctly reports. The fixture suppression in
    // security/secrets.ts keys off a marker word on the same line *outside* the
    // matched text — hence the trailing comment rather than "example" inside the
    // name, which the match would swallow. This paragraph deliberately avoids
    // writing an email-shaped literal, or it would flag itself.
    const name = "orkestra-foo_bar@example.service"; // example fixture
    expect(requireServiceName(name)).toBe(name);
  });

  it("rejects a bare name with no .service suffix", () => {
    expect(() => requireServiceName("caddy")).toThrow(/Invalid serviceName/);
  });

  it("rejects shell and option metacharacters", () => {
    // This value reaches `sudo systemctl`, so anything that is not a unit name
    // is refused at the boundary rather than handed to systemd.
    for (const bad of [
      "foo.service; rm -rf /",
      "foo.service && reboot",
      "foo.service | tee /etc/passwd",
      "$(whoami).service",
      "`id`.service",
      "foo.service extra.service",
    ]) {
      expect(() => requireServiceName(bad)).toThrow(/Invalid serviceName/);
    }
  });

  it("rejects empty, whitespace and non-strings", () => {
    expect(() => requireServiceName("")).toThrow();
    expect(() => requireServiceName("   ")).toThrow();
    expect(() => requireServiceName(undefined)).toThrow();
    expect(() => requireServiceName(null)).toThrow();
    expect(() => requireServiceName(42)).toThrow();
  });

  it("shows an example so the caller can correct itself", () => {
    expect(() => requireServiceName("caddy")).toThrow(/orkestra-texel-api-octane\.service/);
  });
});

describe("requireProjectDir", () => {
  it("accepts an absolute path", () => {
    expect(requireProjectDir("/srv/apps/texel-api")).toBe("/srv/apps/texel-api");
  });

  it("defaults to the working directory when omitted", () => {
    expect(requireProjectDir(undefined)).toBe(process.cwd());
    expect(requireProjectDir("")).toBe(process.cwd());
  });

  it("rejects a relative path", () => {
    // Otherwise `dir: "../../etc"` is resolved against whatever the server
    // process happened to be running in.
    expect(() => requireProjectDir("../../etc")).toThrow(/Invalid dir/);
    expect(() => requireProjectDir("relative/path")).toThrow(/Invalid dir/);
  });

  it("accepts a Windows absolute path", () => {
    expect(requireProjectDir("C:\\apps\\texel")).toBe("C:\\apps\\texel");
  });

  it("rejects a non-string", () => {
    expect(() => requireProjectDir(123)).toThrow(/Invalid dir/);
    expect(() => requireProjectDir({})).toThrow(/Invalid dir/);
  });
});

describe("requireCommitSha", () => {
  it("accepts an abbreviated or full sha", () => {
    expect(requireCommitSha("abc1234")).toBe("abc1234");
    expect(requireCommitSha("a".repeat(40))).toBe("a".repeat(40));
  });

  it("rejects a branch or tag name", () => {
    // orkestra_rollback feeds this to `git checkout`, so a branch name must not
    // pass as though it were a commit.
    expect(() => requireCommitSha("main")).toThrow(/Invalid toCommit/);
    expect(() => requireCommitSha("v1.0.0")).toThrow(/Invalid toCommit/);
  });

  it("rejects a value git would read as an option", () => {
    expect(() => requireCommitSha("--orphan")).toThrow(/Invalid toCommit/);
    expect(() => requireCommitSha("-f")).toThrow(/Invalid toCommit/);
  });

  it("rejects too-short and non-hex values", () => {
    expect(() => requireCommitSha("abc")).toThrow(/Invalid toCommit/);
    expect(() => requireCommitSha("zzzzzzz")).toThrow(/Invalid toCommit/);
    expect(() => requireCommitSha("abc def")).toThrow(/Invalid toCommit/);
  });

  it("trims surrounding whitespace", () => {
    expect(requireCommitSha("  abc1234  ")).toBe("abc1234");
  });
});

describe("requirePort", () => {
  it("accepts the valid range including privileged ports", () => {
    expect(requirePort(1)).toBe(1);
    expect(requirePort(80)).toBe(80);
    expect(requirePort(8022)).toBe(8022);
    expect(requirePort(65535)).toBe(65535);
  });

  it("rejects out-of-range values", () => {
    expect(() => requirePort(0)).toThrow(/Invalid port/);
    expect(() => requirePort(-1)).toThrow(/Invalid port/);
    expect(() => requirePort(65536)).toThrow(/Invalid port/);
    expect(() => requirePort(70000)).toThrow(/Invalid port/);
  });

  it("rejects non-integers and non-numbers", () => {
    expect(() => requirePort(80.5)).toThrow(/Invalid port/);
    expect(() => requirePort("8022")).toThrow(/Invalid port/);
    expect(() => requirePort(NaN)).toThrow(/Invalid port/);
  });

  it("names the field it was given", () => {
    expect(() => requirePort(0, "reverbPort")).toThrow(/reverbPort/);
  });
});

describe("requireLimit", () => {
  it("treats an omitted limit as unset", () => {
    expect(requireLimit(undefined)).toBeUndefined();
    expect(requireLimit(null)).toBeUndefined();
  });

  it("accepts a positive integer", () => {
    expect(requireLimit(20)).toBe(20);
    expect(requireLimit(1000)).toBe(1000);
  });

  it("rejects zero, negatives and fractions", () => {
    expect(() => requireLimit(0)).toThrow(/Invalid limit/);
    expect(() => requireLimit(-5)).toThrow(/Invalid limit/);
    expect(() => requireLimit(1.5)).toThrow(/Invalid limit/);
  });

  it("rejects a string", () => {
    expect(() => requireLimit("50")).toThrow(/Invalid limit/);
  });

  it("caps the value rather than letting it through unbounded", () => {
    expect(() => requireLimit(10_000, 1000)).toThrow(/exceeds the maximum/);
  });

  it("honours a custom field name", () => {
    expect(() => requireLimit(0, 100, "count")).toThrow(/count/);
  });
});