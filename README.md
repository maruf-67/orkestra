# Orkestra

**A capability-driven development workspace manager and server deployment system.**

[![Version](https://img.shields.io/badge/version-2.0.0-blue.svg)](https://github.com/maruf-67/orkestra)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D22-brightgreen.svg)](https://nodejs.org)
[![Bun](https://img.shields.io/badge/bun-%3E%3D1.4-black.svg)](https://bun.sh)
[![Platform](https://img.shields.io/badge/platform-Linux%20%7C%20macOS%20%7C%20Windows-lightgrey.svg)]()

Orkestra orchestrates local workspace environments and automates production cloud server deployments (**Laravel**, **Next.js**, **Nuxt**) with **Systemd process supervision**, **Caddy reverse proxying**, **Mise runtime management** (PHP 8.4, Bun 1.4+, Node.js, Composer, pnpm), **real-time observability** (`orkestra monitor`), and native **Model Context Protocol (MCP)** AI server integration.

---

## Key Features

- **Multi-Framework Application Providers**: Pluggable provider architecture for **Laravel** (Octane, Queue Workers, Reverb WebSockets), **Next.js** (SSR Web), and **Nuxt** (Nitro SSR).
- **Runtime Abstraction**: First-class support for **Bun (1.4+)**, **Node.js**, and **PHP 8.4**, dynamically resolved via **Mise** or system binaries.
- **Package Manager Intelligence**: Auto-detects `pnpm`, `bun`, `yarn`, `npm`, and `composer` with frozen/immutable lockfile installations (`--frozen-lockfile`, `--immutable`, `ci`).
- **Systemd Supervision & Reliability**: Native Systemd templates without PM2 overhead, auto-restarts, worker recycling, and zero-downtime reloads.
- **Automatic Caddy Proxy**: Instant public Let's Encrypt / ZeroSSL HTTPS certificates and `tls internal` for local development.
- **Live System Observability**: `orkestra monitor` displays CPU, RAM, Disk, Load, Systemd process metrics (`MemoryCurrent`, `CPUUsageNSec`), crash-loop detection, and infrastructure health (Caddy, Redis, PostgreSQL, MySQL).
- **Application Topology Inspector**: `orkestra inspect` provides deep insight into framework versions, package managers, runtimes, ports, databases, and routes.
- **Model Context Protocol (MCP)**: Native JSON-RPC MCP server (`orkestra mcp`) allowing AI assistants (Claude, Antigravity, AI-OS) to deploy, inspect, monitor, diagnose, and rollback servers autonomously.

---

## Quick Start

### Local Workspace Development

```bash
# In your project directory (Laravel / Next.js / Nuxt)
orkestra init

# Start local server with HTTPS proxy
orkestra up

# Check status
orkestra status

# View live application logs
orkestra logs
```

### Production Deployment & Observability

```bash
# Deploy locally or to remote server over SSH
orkestra deploy

# Inspect application topology and capabilities
orkestra inspect

# Live monitoring dashboard (CPU, RAM, Systemd, Caddy, DBs)
orkestra monitor --watch

# Service health & status
orkestra services

# Rollback to previous stable commit
orkestra rollback
```

---

## Commands Reference

| Command | Description |
|---------|-------------|
| `orkestra deploy` | One-command deployment (Git sync, dependencies, build, systemd, Caddy, health checks) |
| `orkestra monitor` | Real-time system, infrastructure, and systemd application observability dashboard |
| `orkestra inspect` | Deep inspection of project framework, package manager, runtimes, and databases |
| `orkestra services` | Live status of application services (Octane, Queue, Reverb, Web SSR) and databases |
| `orkestra rollback` | Instant rollback to the previous or a specific commit SHA |
| `orkestra mcp` | Starts the Model Context Protocol (MCP) server for AI agents |
| `orkestra init` | Initialize and register project with proxy, hosts, and SSL |
| `orkestra up` | Start dev server in background or foreground |
| `orkestra down` | Stop running project server |
| `orkestra status` | Show project status and allocated ports |
| `orkestra logs` | View server output and error logs |
| `orkestra doctor` | Verify system runtimes, proxies, package managers, and databases |
| `orkestra share` | Share local project publicly via tunnel |

---

## Configuration (`.orkestra.yml`)

### Next.js Example (Bun / Node)

```yaml
name: digital-library-web

deployment:
  branch: main
  strategy: reset

  remote:
    host: oracle-vps
    path: /srv/apps/digital-library-web

proxy:
  provider: caddy
  api:
    domain: app.book.almaruf67.com
    port: 3000

health:
  api:
    url: https://app.book.almaruf67.com/api/health
    expectedStatus: 200
```

### Laravel Example (Octane + Reverb + Queue + PostgreSQL)

```yaml
name: digital-library-api

deployment:
  branch: main
  remote:
    host: oracle-vps
    path: /srv/apps/digital-library-api

services:
  octane:
    enabled: auto
    server: roadrunner
    port: 8000

  queue:
    enabled: true
    connection: redis

  reverb:
    enabled: auto
    port: 8080

proxy:
  provider: caddy
  api:
    domain: book-api.almaruf67.com
    port: 8000

  realtime:
    domain: reverb.almaruf67.com
    port: 8080
    websocket: true
```

---

## AI & MCP Server Integration

Orkestra includes a built-in MCP server that exposes tools to AI coding assistants and autonomous agents:

```json
{
  "mcpServers": {
    "orkestra": {
      "command": "orkestra",
      "args": ["mcp"]
    }
  }
}
```

### Available MCP Tools:
- `orkestra_deploy`: Autonomous deployment execution with dry-run/migration controls.
- `orkestra_monitor`: Live system, infrastructure, and application process performance metrics.
- `orkestra_inspect`: Project framework, package manager, runtime, and database metadata.
- `orkestra_services_status`: Systemd and infrastructure health inspection.
- `orkestra_services_action`: Start / Stop / Restart / Reload systemd units.
- `orkestra_logs`: Retrieve recent log streams.
- `orkestra_health_check`: Automated endpoint and WebSocket health verification.
- `orkestra_rollback`: One-step automated recovery.

---

## License

MIT © [maruf-67](https://github.com/maruf-67)
