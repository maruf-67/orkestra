# Changelog

All notable changes to Orkestra will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
