# Orkestra Version Roadmap

## Branch Strategy

- `main` — Stable, production-ready releases
- `dev` — Integration branch for testing before main
- `feat/*` — Feature branches, merged into `dev` when ready

## Version History

### v0.1.0 (Initial Release)
**Branch:** `main`
**Status:** Released

**Features:**
- `register` — Register project with local domain + HTTPS
- `remove` — Clean up hosts, proxy, certs, state
- `list` — Show all registered projects
- `doctor` — Check prerequisites (Caddy, mkcert, Node.js)
- `open` — Open project in browser
- `init` — Create `.orkestra.yml` config file

**Infrastructure:**
- Provider-based plugin architecture
- Framework detection (18 frameworks)
- Proxy providers: Caddy, Apache, Nginx, Traefik
- SSL via mkcert
- Hosts file management

---

### v0.2.0 (Process Management)
**Branch:** `feat/up-down-status` → `dev`
**Status:** Released

**Features:**
- `up` — Start dev server with auto-registration
- `down` — Stop dev server by PID
- `status` — Show all projects with running/stopped status
- `logs` — Placeholder (future: log capture)

**Enhancements:**
- Auto-registration in `up` command (shared utility)
- `startCommand` config field for custom start commands
- Deep port detection from package.json, .env, composer.json

**Files Changed:**
- `src/utils/registration.ts` — Shared registration utility
- `src/commands/register.ts` — Refactored to use shared utility
- `src/commands/up.ts` — Refactored + startCommand support
- `src/config/schema.ts` — Added startCommand field
- `test/utils/registration.test.ts` — 7 new tests

---

### v0.3.0 (Logs & Monitoring)
**Branch:** `feat/logs-monitoring` → `dev`
**Status:** Released

**Features:**
- `logs` — View captured stdout/stderr from log files
- `logs --follow` — Tail logs in real-time
- `logs --since <time>` — Show logs since (e.g., 5m, 1h, 2d)
- `logs --stream <stdout|stderr>` — Filter by stream
- `logs -n <limit>` — Show last N entries
- `logs --list` — List available log files
- `up --foreground` — Run server in foreground (stdio inherited)

**Implementation:**
- `src/utils/logger-file.ts` — Log file capture, rotation, reading
- `up` command captures stdout/stderr to `.orkestra/logs/<project>.log`
- Log rotation at 10MB per file
- `--foreground` mode inherits stdio for direct output
- `--since` supports relative (5m, 1h, 2d) and absolute dates

**Files Changed:**
- `src/utils/logger-file.ts` — NEW: Log file utilities
- `src/commands/up.ts` — Added log capture and --foreground mode
- `src/commands/logs.ts` — Rewritten with full logging support
- `src/cli.ts` — Added command options
- `test/utils/logger-file.test.ts` — 10 new tests

---

### v0.4.0 (Health, Multi-Project & Shell)
**Branch:** `feat/health-multi` → `dev`
**Status:** Released

**Features:**
- `up --all` — Start all registered projects
- `down --all` — Stop all running projects
- Process health monitoring — Auto-restart on crash (max 3 attempts)
- `status --json` — Machine-readable output
- `status --verbose` — Show detailed information
- `status --watch` — Auto-refresh every 2 seconds
- `shell` — Open terminal with project environment variables

**Implementation:**
- `src/utils/health.ts` — HealthMonitor class with auto-restart
- Health monitoring starts automatically when server runs in background
- `shell` command sets ORKESTRA_* env vars (PROJECT, DOMAIN, PORT, FRAMEWORK)
- Status shows uptime and memory usage in verbose mode
- JSON output for scripting/automation

**Files Changed:**
- `src/utils/health.ts` — NEW: Health monitoring with auto-restart
- `src/commands/shell.ts` — NEW: Shell with project env vars
- `src/commands/up.ts` — Added --all flag and health monitoring
- `src/commands/status.ts` — Added --json, --verbose, --watch modes
- `src/cli.ts` — Added new command options

---

### v1.0.0 (Documentation & Polish)
**Branch:** `feat/docs-polish` → `dev`
**Status:** Merged to dev, testing in progress

**Features:**
- Updated README with all commands and examples
- `--help` examples for every command
- Better error messages with install instructions
- ZSH/Bash/Fish completion scripts
- `orkestra completions` command

**Implementation:**
- `src/commands/completions.ts` — Shell completion generator
- Updated README.md with comprehensive documentation
- Shell completions for ZSH, Bash, and Fish

**Files Changed:**
- `src/commands/completions.ts` — NEW: Shell completion scripts
- `src/cli.ts` — Added completions command
- `README.md` — Complete documentation rewrite

---

## Release Process

1. Feature branch → `dev` (via PR or merge)
2. Test on `dev` branch
3. `dev` → `main` (via PR with approval)
4. Tag release: `git tag v0.2.0`
5. Publish to npm: `npm publish`

## Versioning Rules

- **Major (x.0.0)**: Breaking changes to CLI interface or config format
- **Minor (0.x.0)**: New features, backward compatible
- **Patch (0.0.x)**: Bug fixes, no new features
