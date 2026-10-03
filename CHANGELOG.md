# Changelog

All notable changes to Orkestra will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
