# Orkestra

**A cross-platform development workspace manager.**

Orkestra orchestrates your local development environment — reverse proxy, hosts file, SSL certificates, runtime detection, process management, logging, health monitoring, and project registration — into a single CLI.

[![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)](https://github.com/maruf-67/orkestra)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D22-brightgreen.svg)](https://nodejs.org)

---

## Installation

```bash
npm install -g orkestra
# or
pnpm install -g orkestra
# or
yarn global add orkestra
```

### Verify

```bash
orkestra --version
orkestra doctor
```

### Shell Completions

```bash
# ZSH
orkestra completions zsh > ~/.zfunc/_orkestra

# Bash
orkestra completions bash > /etc/bash_completion.d/orkestra

# Fish
orkestra completions fish > ~/.config/fish/completions/orkestra.fish
```

---

## Quick Start

```bash
cd ~/projects/my-app

# Initialize and start
orkestra init              # create .orkestra.yml
orkestra up                # register + start server

# Or just run (auto-registers)
orkestra up

# Check status
orkestra status

# View logs
orkestra logs

# Open shell with project vars
orkestra shell

# Stop and clean
orkestra down
orkestra remove
```

---

## Commands

| Command | Description |
|---------|-------------|
| `orkestra doctor` | Check system capabilities and dependencies |
| `orkestra init` | Create `.orkestra.yml` config file |
| `orkestra register` | Register project with proxy, hosts, and SSL |
| `orkestra up` | Start dev server with auto-registration |
| `orkestra down` | Stop dev server |
| `orkestra restart` | Restart dev server |
| `orkestra status` | Show all projects and their state |
| `orkestra open` | Open project in browser |
| `orkestra list` | List all registered projects |
| `orkestra remove` | Remove project and clean up everything |
| `orkestra logs` | View dev server logs |
| `orkestra shell` | Open shell with project environment variables |
| `orkestra db` | Database management |
| `orkestra env` | Environment variable management |
| `orkestra docker` | Docker compose management |
| `orkestra completions` | Generate shell completion scripts |

---

## Detailed Usage

### `orkestra up`

Starts your dev server with auto-registration and log capture.

```bash
orkestra up                    # Background mode (logs captured, health monitored)
orkestra up -f                 # Foreground mode (direct output)
orkestra up --all              # Start all registered projects
orkestra up --port 3000        # Specify port
```

**Options:**
| Flag | Description |
|------|-------------|
| `-d, --dir <path>` | Project directory |
| `--port <port>` | Dev server port |
| `-f, --foreground` | Run in foreground (stdio inherited) |
| `-a, --all` | Start all registered projects |

**Health Monitoring:**
- Auto-restarts on crash (max 3 attempts)
- 10-second health check interval
- All output captured to log files

### `orkestra down`

```bash
orkestra down                  # Stop current project
orkestra down --all            # Stop all running servers
```

### `orkestra status`

```bash
orkestra status                # Compact view
orkestra status --verbose      # Detailed view
orkestra status --json         # Machine-readable JSON
orkestra status --watch        # Auto-refresh every 2 seconds
orkestra status -v -w          # Verbose + watch combined
```

**Example Output:**
```
Project Status

  ● my-app
  Status     running
  Domain     my-app.dev.com
  Port       3000
  Framework  nuxt
  Proxy      caddy
  URL        https://my-app.dev.com
  PID        12345

  ○ api-service
  Status     stopped
  Domain     api.dev.com
  Port       8080
  Framework  go

2 project(s) registered, 1 running
```

### `orkestra logs`

```bash
orkestra logs                  # Show last 100 entries
orkestra logs -f               # Follow logs in real-time
orkestra logs --since 5m       # Logs from last 5 minutes
orkestra logs --since 1h       # Logs from last hour
orkestra logs --stream stderr  # Show only stderr
orkestra logs -n 50            # Show last 50 entries
orkestra logs --list           # List available log files
```

**Log Format:**
```
[2026-07-25T10:30:00.000Z] [stdout] Server started on port 3000
[2026-07-25T10:30:01.000Z] [stderr] Warning: deprecated API used
```

### `orkestra shell`

Opens an interactive shell with project environment variables.

```bash
orkestra shell                 # Open shell in current project
orkestra shell -d ~/my-app     # Open shell for specific project
```

**Environment Variables:**
| Variable | Description |
|----------|-------------|
| `ORKESTRA_PROJECT` | Project name |
| `ORKESTRA_DIR` | Project directory |
| `ORKESTRA_DOMAIN` | Project domain |
| `ORKESTRA_PORT` | Dev server port |
| `ORKESTRA_FRAMEWORK` | Detected framework |
| `ORKESTRA_PROXY` | Proxy provider |
| `ORKESTRA_PID` | Server PID (if running) |
| `ORKESTRA_START_COMMAND` | Configured start command |

### `orkestra register`

```bash
orkestra register                          # Interactive registration
orkestra register --domain my-app.dev.com  # Specify domain
orkestra register --port 3000              # Specify port
orkestra register --proxy nginx            # Use specific proxy
```

### `orkestra db`

```bash
orkestra db                    # Show database status
orkestra db create mydb        # Create database
orkestra db drop mydb          # Drop database
orkestra db list               # List detected databases
```

### `orkestra env`

```bash
orkestra env                          # List all env vars
orkestra env --get DATABASE_URL       # Get a variable
orkestra env --set PORT=3000          # Set a variable
```

### `orkestra docker`

```bash
orkestra docker              # Show docker services
orkestra docker up           # Start all services
orkestra docker down         # Stop all services
orkestra docker status       # Show running containers
```

---

## Configuration

### `.orkestra.yml`

```yaml
name: my-app
domain: my-app.dev.com
port: 3000
ssl: true
proxy: auto          # auto | caddy | nginx | apache | traefik
runtime: auto        # auto | mise | nvm | fnm | asdf | volta | system
startCommand: "pnpm dev"  # Override auto-detected start command
```

### State

Stored in `~/.orkestra/state.json`:

```json
{
  "projects": {
    "/home/user/projects/my-app": {
      "name": "my-app",
      "domain": "my-app.dev.com",
      "port": 3000,
      "framework": "nuxt",
      "proxy": "caddy",
      "path": "/home/user/projects/my-app",
      "registeredAt": "2026-07-25T00:00:00.000Z",
      "pid": 12345,
      "startedAt": "2026-07-25T10:30:00.000Z"
    }
  },
  "allocatedPorts": [3000, 8080]
}
```

---

## Supported Frameworks

| Language | Framework | Default Port |
|----------|-----------|--------------|
| PHP | Laravel, Symfony | 8000 |
| JavaScript | Next.js, Nuxt, Remix, Astro, SvelteKit, Vite, Express, Fastify | 3000-5173 |
| Python | FastAPI, Flask, Django | 5000-8000 |
| Go | Go | 8080 |
| Rust | Rust | 8080 |

---

## Supported Proxies

| Proxy | Priority | SSL |
|-------|----------|-----|
| Caddy | 100 | mkcert (trusted) |
| Traefik | 90 | ACME/Let's Encrypt |
| Nginx | 80 | snakeoil cert |
| Apache | 60 | snakeoil cert |

---

## Supported Runtimes

| Runtime | Priority |
|---------|----------|
| mise | 100 |
| nvm | 80 |
| fnm | 70 |
| asdf | 60 |
| volta | 50 |
| system | 10 |

---

## SSL Certificates

Orkestra uses **mkcert** for locally-trusted SSL:

1. Installs a local Certificate Authority
2. Adds CA to system trust store
3. Generates certificates per domain
4. Browsers trust them — no warnings

---

## Platform Support

| Platform | Hosts File | Proxies |
|----------|-----------|---------|
| Linux | `/etc/hosts` | Caddy, Nginx, Apache, Traefik |
| macOS | `/etc/hosts` | Caddy, Nginx, Apache, Traefik |
| Windows | `C:\Windows\System32\drivers\etc\hosts` | Caddy |

---

## Version History

| Version | Features |
|---------|----------|
| **1.0.0** | Shell completions, documentation, polish |
| **0.4.0** | Health monitoring, multi-project, shell, status enhancements |
| **0.3.0** | Log capture, --follow, --since, --foreground |
| **0.2.0** | Process management (up, down, status), auto-registration |
| **0.1.0** | Initial release (register, remove, list, doctor, init) |

---

## Troubleshooting

**Permission denied on hosts file** — Orkestra needs sudo. You'll be prompted.

**Host not allowed** — Add to `server.allowedHosts` in vite.config or nuxt.config.

**SSL not trusted** — Run `mkcert -install`.

**Port in use** — Orkestra auto-finds next available port, or specify `--port`.

**Server won't start** — Check logs: `orkestra logs`

**Process crashed** — Health monitoring auto-restarts (max 3 attempts). Check logs for errors.

---

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run tests: `pnpm test`
5. Submit a pull request

---

## License

MIT
