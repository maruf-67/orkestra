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
**Status:** Merged to dev, testing in progress

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
**Branch:** `feat/logs-monitoring` (planned)
**Status:** Planned

**Features:**
- `logs` — Capture stdout/stderr to log files
- `logs --follow` — Tail logs in real-time
- `logs --since <time>` — Show logs from specific time
- `up --foreground` — Run server in foreground (no detach)

**Implementation:**
- Modify `up` command to write logs to `~/.orkestra/logs/<project>.log`
- Implement log rotation (max 10MB per project)
- Add `--follow` flag using `tail -f` or chokidar

---

### v0.4.0 (Health & Multi-Project)
**Branch:** `feat/health-multi` (planned)
**Status:** Planned

**Features:**
- `up --all` — Start all registered projects
- `down --all` — Stop all running projects
- Process health monitoring — Auto-restart on crash
- `status --json` — Machine-readable output

**Implementation:**
- Store PID + startedAt in state (already done)
- Add health check interval (configurable)
- Implement restart policy (max retries, backoff)
- Batch operations on all projects

---

### v0.5.0 (Shell & Status)
**Branch:** `feat/shell-status` (planned)
**Status:** Planned

**Features:**
- `shell` — Open terminal with project env vars
- `status --verbose` — Show port, framework, uptime, memory
- `status --watch` — Auto-refresh every N seconds

**Implementation:**
- Spawn shell with `PORT`, `DOMAIN`, `FRAMEWORK` env vars
- Read `/proc/<pid>/status` for memory usage
- Calculate uptime from `startedAt` timestamp

---

### v1.0.0 (Documentation & Polish)
**Branch:** `feat/docs-polish` (planned)
**Status:** Planned

**Features:**
- Updated README with all commands
- `--help` examples for every command
- Better error messages with install instructions
- Man page generation
- ZSH/Bash completion scripts

**Implementation:**
- Commander.js built-in help customization
- Error message templates with platform-specific install commands
- `orkestra completion` command for shell completions

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
