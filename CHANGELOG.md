# Changelog

All notable changes to Orkestra will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.10] - 2026-10-04

Port-drift hardening, a shell-injection fix, an honest coverage gate, and 282
lines of dead code removed. Found by exercising the real binaries — `caddy`,
`systemd-analyze`, `mise`, and real `git` repositories — rather than by reading
code.

### Fixed

- **Arguments are no longer mangled by a shell, and can no longer be injected.**
  `utils/exec.ts` passed every argument through `/bin/sh` (`execa({ shell })`).
  Two consequences:
  - *Correctness.* Any argument containing a shell metacharacter broke. Real
    case: `git log -1 --format=%an|||%s` failed with
    `/bin/sh: Syntax error: "|" unexpected`, so `getCurrentGitInfo()` returned
    author `"unknown"` and an empty message for **every** deployment — deploy
    history has never recorded a real author.
  - *Security.* Arguments are built from project-controlled values (domains,
    project names, paths, service names), so a shell interpreted them.

  Execa now passes args as an argv array straight to `execve`. Verified safe:
  all 122 call sites pass a real binary plus an argv array, and none invokes a
  shell built-in. The one site that genuinely wants a shell,
  `run("sh", ["-c", ...])` in `utils/installer.ts`, still works. Windows keeps
  `shell: true` because Node cannot exec a `.cmd` shim directly.

- **`.git/info/exclude` never protected a tracked `.orkestra.yml`.** The 1.0.6 fix
  added the file to the exclude list, but that only affects *untracked* files.
  Since `.orkestra.yml` normally ships in the repository, `reset --hard`
  overwrote it regardless and the protection was a no-op. Verified directly:
  with a tracked file and a host-specific value, `reset --hard` reverts it every
  time. `ensureResetExemptions()` now handles both cases — untracked files via
  the exclude file, tracked files via `git update-index --skip-worktree`, which
  is the mechanism that actually works. `freezeAgainstState()` remains the
  defence in depth, re-applying deployed ports after the reset regardless.

- **A corrupt `composer.json` or `package.json` silently changed the port.**
  `detectPortFromProject()` wrapped `JSON.parse` in `catch {}`, so a malformed
  file returned `null`, the caller fell back to a default, and the project
  landed on a port nobody chose — invisible, and the same class as every other
  port bug. A `readJsonIfPresent()` helper now separates *missing* (normal,
  silent) from *invalid* (warns, naming the file and the consequence). Files
  matched by regex, such as `.env` and `.rr.yaml`, cannot fail to parse, so
  absence remains their only failure mode and stays silent.

- **Failure to gitignore `.orkestra/` is reported.** That directory holds the
  host-specific port config; if it is committed it travels to every other
  machine and CI checkout. Now warns, with the consequence spelled out.

- **`orkestra remove` no longer hides units that keep serving traffic.**
  Stopping a unit that does not exist stays quiet, but failing to stop one that
  does exist means the process survives the removal. Stop failures are now
  collected and reported with the `systemctl` command to check.
  `disable`/`rm`/`daemon-reload` remain best-effort.

### Changed

- **The coverage number was inflated, and the vitest upgrade exposed it.**
  Vitest 5 omits files that were never imported, shrinking the denominator. Out
  of the box it reported `45.62% (1033/2264)` against the honest
  `21.21% (1033/4869)` — the same 1033 covered statements over half the
  denominator, with `src/commands`, `cli.ts` and `pipeline.ts` dropped from the
  report entirely rather than showing 0%. A project at 3% real coverage would
  have reported 45%. `coverage.all: true` keeps untested files in the report.
- **Coverage thresholds added and enforced in CI**, and `bun run check` now
  mirrors CI exactly (`typecheck → test → coverage → build`). Thresholds are a
  ratchet just under current honest numbers (26/24/32/26), not a target:
  `src/commands` is ~4.5k lines of sudo/systemd-bound orchestration that needs an
  injectable process/filesystem seam before unit tests would mean anything, and
  inflating that number with mock-heavy tests would be worse than leaving the
  gap visible.
- **vitest 3.2.7 → 5.0.3.** Clears
  `[high] vitest — Path Traversal / Arbitrary File Read via @vitest/mocker`.
  All tests pass unchanged; `orkestra audit -d .` now reports 0 CVE findings.

### Removed

282 lines of dead code, each verified to have zero importers, zero CLI
registration and zero interface consumers: `commands/register.ts` (96),
`providers/process/pm2.ts` (57), `plugins/sdk.ts` (60), and the orphaned
`ProviderManifest`, `ProcessProvider` and `RuntimeInfo` interfaces.

`RuntimeProvider` is trimmed to `detect()`, the only method anything called —
`current()`, `install()` and `use()` were 18 dead method bodies across six
providers. The mise implementation was not merely unused but wrong:
`current()` ran `mise current --json`, which is not a valid command in mise
2026.8 (the correct form is `mise ls --current --json`, which returns an object
keyed by tool name, not a single record), and `install()` hardcoded `node@`, so
a PHP request would have run `mise install node@8.4`. Keeping a broken shim for
a capability with no consumer is worse than deleting it: the next person to
reach for `MiseRuntime.current()` would get a silent `null`.

### Added

- `test/deployment/pipeline.test.ts` (31) — all eight steps plus failure paths.
  The deploy lock is deliberately not mocked: it is a real file, so the
  stale-lock case, lock contention and release-on-every-exit are tested for real.
  `pipeline.ts` 21.75% → **100%** statements and functions.
- `test/deployment/git.test.ts` (19) — against real git repositories, including
  that a tracked `.orkestra.yml` keeps its host-specific port and `reverbPort`
  across an actual `reset --hard` while tracked source files still update from
  `origin`. `git.ts` 1.88% → 93.75%.
- `test/utils/registration-errors.test.ts` (10) — absent vs corrupt config.

Suite 219 → 293. Honest overall coverage 21.21% → 26.24% statements.

## [1.0.9] - 2026-10-04

Two fixes on the deploy path, one of them a regression introduced by 1.0.8.

### Fixed

- **`deploy --dry-run` no longer fails when the toolchain is incomplete.**
  Regression from 1.0.8. `resolveBinaries` became strict — it throws when `php`
  or `composer` cannot be resolved, which is correct for a real deploy because
  those paths are baked into systemd `ExecStart`. But it was called *before* the
  dry-run guard, so the read-only preview aborted on exactly the condition it
  exists to report. A preview now always renders and names the problem:

  ```
  i [Dry Run] Deployment preview for dryrun-app (Branch: main)
    • Framework:       laravel (^11.0)
  ⚠ Toolchain incomplete — a real deploy would stop here:
    Cannot resolve "php" to a real executable: php was not found on the system
    PATH and mise is not installed. Install php, or install mise so project
    toolchains are used.
    Resolved fallbacks: php=php composer=composer
  ```

  Verified end to end with `php`, `composer` and `mise` all absent from `PATH`:
  the preview renders, and the same environment still refuses the real deploy
  with exit code 1.

- **A restart can no longer move a project off its registered port.** Port drift
  returned in a different place from the 1.0.6 fix. `findAvailablePort` accepts an
  optional `forProjectPath`; when supplied, a project may reclaim the port state
  records for it. When omitted, that same port is treated as owned by somebody
  else. Three call sites omitted it, so an app could be started or restarted on a
  port other than the one in `.orkestra.yml`, breaking bookmarks, `.env` and the
  Caddy mapping:

  | Call site | Before |
  |---|---|
  | `commands/up.ts` | `findAvailablePort(port)` |
  | `commands/start.ts` | `findAvailablePort(port)` |
  | `utils/health.ts` | `findAvailablePort(port)` — and **unconditionally** |

  The health-monitor path was the worst of the three: it re-resolved the port on
  *every* auto-restart rather than only on a real conflict. All three now pass
  the project path, and the health path only scans when the configured port is
  genuinely occupied. This is the same failure you hit repeatedly across
  1.0.2–1.0.5, so it is worth confirming against `texel-front` before merging.

### Changed
- `isPortOccupied` was duplicated privately in `commands/up.ts` and
  `commands/start.ts`. Promoted to `state/ports.ts` and exported, so the health
  monitor uses the same check instead of re-deriving it. Probing `127.0.0.1` is
  the conservative direction, since a listener on `0.0.0.0` also holds loopback.
- Deployments that fail *before* the pipeline lock — an unresolvable toolchain, or
  an undetectable framework — throw rather than being recorded in the deployment
  report, so they leave no entry in deploy history. Pre-existing behaviour, not
  introduced here; `rollback` and `orkestra audit --history` cannot see these
  failures. Tracked as a follow-up.

### Added
- `test/deployment/dry-run-and-port-guard.test.ts` (5) and
  `test/state/port-affinity.test.ts` (4). Suite 210 → 219. The port suite
  includes a structural guard that fails if any `findAvailablePort` call site
  omits the project path, so a fourth site cannot reintroduce the drift.

## [1.0.8] - 2026-10-03

Stack hardening for the mise + Caddy + systemd deployment path. Every change
below was found by exercising the real binaries, not by reading the code.

### Fixed

- **Caddy no longer corrupts the Caddyfile when a site block contains a nested
  block.** Site blocks were matched with `^\\s*domain\\s*\\{[^}]*\\}`, and `[^}]*`
  stops at the *first* `}`, so any block containing `tls { }`, `handle { }`,
  `route { }` or `header { }` was rewritten only up to the inner brace. The
  orphaned remainder was not merely untidy — verified against the real `caddy`
  binary, the truncated file adapts to a config that **listens on the
  application's own port**:

  ```
  OLD: listen [':443']  hosts ['api.texelbd.com', 'reverse_proxy']
       listen [':8022'] hosts ['localhost']      <- steals the app port
  NEW: listen [':443']  hosts ['api.texelbd.com']
  ```

  So a single deploy of a domain with a nested block could make Caddy compete
  with the application for its port. Block matching is now a brace-depth scan
  that respects quoted matchers, so the block is replaced or removed whole.
- **Caddy reload failures are no longer swallowed.** Both the `systemctl reload
  caddy` and the `caddy reload` paths discarded their exit code, so a config
  Caddy rejected still reported success — the same silent-drift class as the
  Reverb port bug. Both paths now throw with the captured stderr.
- **Caddy config is validated before it is written.** `caddy validate` was never
  invoked anywhere. Writes are now staged, validated, and only then committed; if
  the reload fails, the previous config is restored and reloaded so a bad edit
  cannot take the proxy down.
- **Unresolvable toolchains fail the deploy instead of degrading silently.**
  `resolveBinaries` fell back to a bare command name whenever `mise which`
  failed — untrusted project config, or a version not yet installed. `php` and
  `composer` are baked into systemd `ExecStart`, so systemd ran the unit with a
  minimal PATH and either failed to start or silently used a *different* system
  PHP than the project targets, while the deploy reported success. Both now
  raise `BinaryResolutionError` naming the tool, the reason, and the fix. Tools
  that are not `ExecStart` paths (`node`, `bun`, `pnpm`, `yarn`, `npm`) still
  degrade to a bare name, since that is harmless.
- **Project mise config is trusted before resolution.** `mise trust` was never
  called, so a project-local `mise.toml` could make `mise which` report its
  tools as inactive. Now run automatically; opt out with
  `resolveBinaries(cwd, { trustProject: false })`.
- **Services are verified after restart instead of assumed.** `systemctl restart`
  succeeds once the unit is *started*, which for `Type=simple` means the process
  was forked. With `Restart=always` a unit that dies immediately loops forever
  and still reports a successful restart, so deploys claimed services were
  "restarted" while they were crash-looping. Units are now polled for a settle
  window and must be active at the end; a failure aborts the deploy and prints
  the relevant `journalctl` output. All units are restarted first and settled
  once, so the added latency is a single window rather than one per service.
- **Units wait for a usable network.** All four templates used
  `After=network.target`, which is reached before the network is usable, so a
  queue worker or Octane could lose its Redis/DB connection on boot. Now
  `network-online.target`.
- **Literal `%` in a unit is escaped.** systemd reads `%` as a specifier
  introducer. Confirmed against `systemd-analyze verify`: a project path
  containing `%z` yields `ExecStart=...100%z/...` and systemd rejects the unit
  with `Invalid slot`. Paths are rendered into both `WorkingDirectory` and
  `ExecStart`, so such a project produced a service that did not exist after
  deploy. Narrow, but a real hard failure.
- **Unhandled command failures now exit non-zero with a readable message.**
  Commander actions are wired fire-and-forget, so a rejected promise surfaced
  as a raw stack trace and an unreliable exit code.

### Changed
- `LimitNOFILE=65535` was set on the web, Octane and Reverb units but missing
  from the queue worker, which is the unit most likely to exhaust descriptors.

### Added
- `test/providers/caddy.test.ts` 22 → 27, `test/services/mise-resolver.test.ts`
  (12) and `test/services/systemd-hardening.test.ts` (22). Suite 167 → 210.
  All four generated unit types were additionally checked with the real
  `systemd-analyze verify` and are valid.

## [1.0.7] - 2026-10-03

### Fixed
- **Hosts file no longer destroys subdomain entries.** `HostsFileProvider` matched
  domains with `line.includes(domain)`, so `add("texelbd.com")` or
  `remove("texelbd.com")` also matched `api.texelbd.com` and `reverb.texelbd.com`
  and deleted them. Matching is now exact against the hostnames a line actually maps,
  comment-aware, case- and trailing-dot-insensitive, and alias-aware. `add()` is also
  idempotent regardless of the whitespace a hosts file uses.
- **Revived a dead injection-detection rule.** `SQL Injection (PHP concat)` required
  a dot directly after a quote-delimited literal, which can never match because PHP
  always closes the literal with its own quote before the concatenation dot. Any
  report claiming to check for this was silently clean. The rule now matches the real
  forms (`"x = " . $v`, `"a='{$v}'" . $w`, `$col . " = " . $val`) across
  `whereRaw|selectRaw|orderByRaw|havingRaw`, while `[^;]*` keeps the match inside a
  single statement so an unrelated dynamic expression is not misattributed.
- **Security scanner no longer flags its own test fixtures.** Scanning a clean
  repository that tests the scanner produced 14 findings against itself: seven from
  the secret scanner and seven more from the injection scanner, which also matched the
  literal rule names inside its own `it(...)` titles and `toContain()` assertions. AWS's
  published documentation keys are now always ignored; fixtures under
  `test/`/`spec/`/`fixtures/` are suppressed only when the line carries an explicit
  `example`/`dummy`/`fake` marker *outside the matched credential itself*; and the
  scanner's own suite is exempt alongside `src/security/`. A genuine leak or
  vulnerability committed under `test/` is still reported, and both cases are pinned by
  tests.

### Changed
- Migrated the toolchain from pnpm to Bun 1.4+ for install, build, test, and type
  checking. `pnpm-lock.yaml` and `pnpm-workspace.yaml` are replaced by `bun.lock`;
  pnpm's `allowBuilds` maps to `trustedDependencies` in `package.json`.
- CI and Release now provision Bun via `oven-sh/setup-bun@v2` and run
  `bun install --frozen-lockfile`. The setup-node cache dependency on
  `pnpm store path` is gone, so the earlier step-ordering failure cannot recur.
- Added `bun run test:coverage` and `bun run check` (typecheck, test, build), plus
  `@vitest/coverage-v8`, which was previously missing so coverage could not be
  measured at all.
- Installation docs now list `bun add -g orkestra` first. Orkestra still *detects*
  pnpm, npm, yarn, and composer when deploying applications — that is a feature for
  target projects and is unchanged.

### Added
- Test coverage for the highest-risk previously untested code: Caddyfile domain-block
  editing, exact-name hosts-file matching, the security scanners, and port resolution
  across all three framework providers. The suite grew from 97 to 167 tests;
  `src/providers/hosts`, `src/security`, and the application providers are now between
  71% and 100% covered.

## [1.0.6] - 2026-10-03

### Fixed
- **Reverb no longer hardcoded to port 8080.** `systemd.ts` rendered `REVERB_PORT` from
  `options.reverbPort || 8080`, but neither the deploy pipeline nor `redeploy` passed
  `reverbPort` to `installService`, so every deploy silently rewrote the Reverb unit to
  bind 8080 regardless of `.orkestra.yml`. Both callers now forward the resolved port.
- **Octane and queue configuration is no longer discarded.** `octaneServer`, `maxRequests`,
  and the queue tuning options (`sleep`, `tries`, `timeout`, `maxJobs`, `maxTime`) were
  never forwarded to the systemd units, so `services.octane.server` and `services.queue.*`
  were silently ignored and units fell back to defaults.
- **Deploy now fails on proxy configuration errors.** A Caddy write failure was caught and
  swallowed, so services could restart against a proxy that was never written while the
  report claimed success.
- **Deploy now fails on health check failures.** Unhealthy checks were recorded with status
  `"success"`; they are now recorded as `"failed"` and abort the deployment.
- **Octane server detection.** Both branches of the detection `if` assigned `roadrunner`,
  making Swoole and FrankenPHP undetectable. Detection now honours explicit config, then
  RoadRunner artefacts, then extension availability.
- **Octane server precedence.** `services.octane.server` in `.orkestra.yml` is now honoured
  when rendering the unit, not only during detection.
- **`.orkestra.yml` survives `git reset --hard`.** `syncGitBranch` now appends the file to
  `.git/info/exclude`, so the deployment-local port/domain cannot be reverted to a
  repository default by the default `reset` sync strategy.

### Changed
- Added `src/deployment/ports.ts` as the single source of truth for port and domain
  resolution (`resolvePorts`, `freezeAgainstState`). The precedence chain was previously
  duplicated across five call sites, which is how the Reverb port drift recurred across
  releases.
- `services` command now resolves ports against deployment state, so the displayed port
  matches the deployed unit rather than a `.orkestra.yml` that `git reset --hard` reverted.
- Removed the divergent `src/services/templates/**.service` files. They were never copied
  into the published package and had already drifted from the inline templates (for example
  `laravel/web.service` hardcoded `artisan serve` while the inline web template uses
  `{{EXEC_START}}`). `DEFAULT_TEMPLATES` in `services/systemd.ts` is now the only source.
- Removed `ServicesManager.setupLaravelServices`, which had no callers.

### Added
- Regression coverage for all of the above: `test/deployment/ports.test.ts`,
  `test/deployment/laravel-provider-ports.test.ts`, `test/services/systemd-units.test.ts`
  (test suite grew from 51 to 90 tests).

## [1.0.5] - 2026-09-10

### Fixed
- `orkestra down` now stops deployed systemd services (`octane`, `web`, `queue`, `reverb`)
  in addition to the local dev process, so deployed applications can be paused. Previously
  it only killed the dev PID tree and reported "No server running" for deployed services.

## [1.0.4] - 2026-09-10

### Fixed
- `reverbPort` and `reverbDomain` are persisted in `~/.orkestra/state.json` and preserved
  across `deploy`, preventing the Reverb port from reverting to 8080 after a git sync.
- `redeploy` preserves Reverb configuration from deployment state when `.orkestra.yml` is
  reverted by the sync strategy.

## [1.0.3] - 2026-09-10

### Added
- `orkestra redeploy`: git sync, dependency install (Composer for Laravel, bun/pnpm/npm for
  Node), `optimize:clear` + `optimize`, then service restart — without touching ports,
  domains, or the Caddy configuration.
- `--skip-build` and `--skip-optimize` flags for targeted restarts.

### Fixed
- `deploy` preserves the deployed port and domain after `git reset --hard`, preventing the
  reverse proxy and systemd units from drifting to a repository default.

## [1.0.2] - 2026-09-10

### Fixed
- Caddy domain block matching now anchors on an exact domain match, so registering one domain
  no longer rewrites neighbouring proxy blocks.

## [1.0.1] - 2026-09-10

### Added
- Security audit bundle: secrets and PII detection (including Bangladeshi NID and phone
  patterns), injection and validation gap detection (SQLi, command injection, XSS), and
  online CVE lookups via npm audit, Composer audit, and OSV.dev.
- `orkestra audit` / `orkestra security` commands, an audit trail at
  `~/.orkestra/audit.log.jsonl`, and the `orkestra_audit`, `orkestra_security_scan`, and
  `orkestra_audit_history` MCP tools.

## [1.0.0] - 2026-07-25

### Added
- Share projects via tunnel using localtunnel
- QR code generation for mobile sharing
- Session persistence for active tunnels
- Auto-install localtunnel when sharing
- Smart installer with user permission for Caddy/mkcert
- Windows support (PowerShell, where.exe, UAC elevation)
- PowerShell shell completions
- Graceful degradation for missing tools
- Merged `init` and `register` into single `init` command
- Auto-add `.orkestra` to `.gitignore` on init
- Clean logs and `.orkestra` directory on remove
- Health monitoring with auto-restart (max 3 attempts)
- Log capture with rotation (10MB per file)
- `--foreground` mode for direct output
- `--all` flag for multi-project operations
- `status --json` for machine-readable output
- `status --verbose` for detailed view
- `status --watch` for auto-refresh
- `logs --follow` for real-time logging
- `logs --since` for time-based filtering
- `shell` command with project environment variables
- `completions` command for ZSH/Bash/Fish/PowerShell
- Cross-platform sudo/elevation handling
- Platform-aware cert directory resolution

### Changed
- Port detection now uses config file priority
- Better error messages with install instructions
- Updated README with comprehensive documentation

### Fixed
- Port detection for `--port=XXX` format (with equals sign)
- Bash completion script escaping issue
- Runtime providers using global `which()` function
- Caddy cert directory platform-aware paths

## [0.4.0] - 2026-07-24

### Added
- `up --all` to start all registered projects
- `down --all` to stop all running servers
- Health monitoring with auto-restart
- `status --json` for machine-readable output
- `status --verbose` for detailed view
- `status --watch` for auto-refresh
- `shell` command with project environment variables

## [0.3.0] - 2026-07-24

### Added
- Log capture to `.orkestra/logs/<project>.log`
- `up --foreground` for direct output
- `logs --follow` for real-time logging
- `logs --since` for time-based filtering
- `logs --stream` for stdout/stderr filtering
- `logs --list` to list log files
- Log rotation at 10MB per file

## [0.2.0] - 2026-07-24

### Added
- `up` command with auto-registration
- `down` command to stop servers
- `status` command to show project status
- `startCommand` config field
- Deep port detection from package.json, .env
- Shared registration utility

## [0.1.0] - 2026-07-23

### Added
- Initial release
- `register` command for project registration
- `remove` command for cleanup
- `list` command to show projects
- `doctor` command to check prerequisites
- `open` command to open in browser
- `init` command to create config
- Provider-based architecture
- Framework detection (18 frameworks)
- Proxy providers: Caddy, Apache, Nginx, Traefik
- SSL via mkcert
- Hosts file management
