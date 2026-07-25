# User Guide

Complete reference for all Orkestra commands and options.

## Commands Overview

| Command | Description |
|---------|-------------|
| `orkestra init` | Initialize and register project |
| `orkestra up` | Start dev server |
| `orkestra down` | Stop dev server |
| `orkestra restart` | Restart dev server |
| `orkestra status` | Show project status |
| `orkestra logs` | View server logs |
| `orkestra shell` | Open shell with env vars |
| `orkestra remove` | Remove project completely |
| `orkestra list` | List all projects |
| `orkestra doctor` | Check system capabilities |
| `orkestra open` | Open project in browser |
| `orkestra db` | Database management |
| `orkestra env` | Environment variable management |
| `orkestra docker` | Docker compose management |
| `orkestra completions` | Generate shell completions |

---

## orkestra init

Initialize a project with configuration and register with proxy.

```bash
orkestra init [options]
```

### Options

| Flag | Description |
|------|-------------|
| `-d, --dir <path>` | Project directory |
| `--domain <domain>` | Domain name (default: `<name>.dev.com`) |
| `--port <port>` | Dev server port |
| `--proxy <proxy>` | Proxy provider (caddy, apache, nginx) |
| `-y, --yes` | Skip prompts, use defaults (for CI/CD) |

### Examples

```bash
# Interactive setup
orkestra init

# Specify options
orkestra init --port 3000 --domain my-app.dev.com

# Specify directory
orkestra init --dir ~/projects/my-app
```

### What It Does

1. Detects framework (Next.js, Nuxt, Laravel, etc.)
2. Creates `.orkestra.yml` configuration
3. Adds `.orkestra` to `.gitignore`
4. Registers with proxy (Caddy)
5. Adds domain to `/etc/hosts`
6. Configures SSL (if proxy available)

---

## orkestra up

Start the dev server with auto-registration.

```bash
orkestra up [options]
```

### Options

| Flag | Description |
|------|-------------|
| `-d, --dir <path>` | Project directory |
| `--port <port>` | Dev server port |
| `-f, --foreground` | Run in foreground (direct output) |
| `-a, --all` | Start all registered projects |

### Examples

```bash
# Start in background (logs captured)
orkestra up

# Start in foreground (see output directly)
orkestra up -f

# Start all projects
orkestra up --all

# Specify port
orkestra up --port 3000
```

### Features

- **Auto-registration**: Registers project if not already registered
- **Log capture**: All output saved to `.orkestra/logs/`
- **Health monitoring**: Auto-restarts on crash (max 3 attempts)
- **Port detection**: Uses configured port, falls back to framework default

---

## orkestra down

Stop the dev server.

```bash
orkestra down [options]
```

### Options

| Flag | Description |
|------|-------------|
| `-d, --dir <path>` | Project directory |
| `-a, --all` | Stop all running servers |

### Examples

```bash
# Stop current project
orkestra down

# Stop all servers
orkestra down --all
```

---

## orkestra status

Show project status with multiple output modes.

```bash
orkestra status [options]
```

### Options

| Flag | Description |
|------|-------------|
| `--json` | Output as JSON |
| `-v, --verbose` | Show detailed information |
| `-w, --watch` | Auto-refresh every 2 seconds |

### Examples

```bash
# Compact view
orkestra status

# Detailed view
orkestra status --verbose

# JSON output (for scripting)
orkestra status --json

# Watch mode
orkestra status --watch
```

### Output Example

```
Project Status
──────────────

  ● my-app — running
    Domain:     my-app.dev.com
    Port:       3000
    Framework:  nuxt
    Proxy:      caddy
    URL:        https://my-app.dev.com
    PID:        12345

1 project(s) registered, 1 running
```

---

## orkestra logs

View captured server logs.

```bash
orkestra logs [options]
```

### Options

| Flag | Description |
|------|-------------|
| `-d, --dir <path>` | Project directory |
| `-f, --follow` | Follow logs in real-time |
| `--since <time>` | Show logs since (e.g., 5m, 1h, 2d) |
| `--stream <stream>` | Filter by stream (stdout, stderr) |
| `-n, --limit <number>` | Number of recent entries |
| `-l, --list` | List available log files |

### Examples

```bash
# Show last 100 entries
orkestra logs

# Follow in real-time
orkestra logs -f

# Show last 50 entries
orkestra logs -n 50

# Show logs from last hour
orkestra logs --since 1h

# Show only errors
orkestra logs --stream stderr

# List log files
orkestra logs --list
```

---

## orkestra shell

Open a shell with project environment variables.

```bash
orkestra shell [options]
```

### Options

| Flag | Description |
|------|-------------|
| `-d, --dir <path>` | Project directory |

### Environment Variables Set

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

### Example

```bash
orkestra shell
# Now you can use:
echo $ORKESTRA_DOMAIN  # my-app.dev.com
echo $ORKESTRA_PORT    # 3000
```

---

## orkestra remove

Remove project completely (hosts, proxy, certs, logs, config).

```bash
orkestra remove [options]
```

### Options

| Flag | Description |
|------|-------------|
| `-d, --dir <path>` | Project directory |

### What It Removes

- Domain entry from `/etc/hosts`
- Proxy configuration (Caddy)
- SSL certificates
- Log files
- `.orkestra/` directory
- `.orkestra.yml` config file
- Project from state

---

## orkestra list

List all registered projects.

```bash
orkestra list
```

---

## orkestra doctor

Check system capabilities and dependencies.

```bash
orkestra doctor
```

### Output Shows

- Installed frameworks
- Runtime managers (mise, nvm, fnm, asdf, volta)
- Proxy providers (caddy, nginx, apache, traefik)
- Package managers (pnpm, npm, yarn, bun)
- Databases (postgresql, mysql, sqlite, mongodb, redis)

---

## orkestra open

Open project in browser.

```bash
orkestra open [options]
```

### Options

| Flag | Description |
|------|-------------|
| `-d, --dir <path>` | Project directory |

---

## orkestra completions

Generate shell completion scripts.

```bash
orkestra completions [options]
```

### Options

| Flag | Description |
|------|-------------|
| `--shell <shell>` | Shell type (zsh, bash, fish, powershell) |

### Examples

```bash
# ZSH
orkestra completions --shell zsh > ~/.zfunc/_orkestra

# Bash
orkestra completions --shell bash > /etc/bash_completion.d/orkestra

# Fish
orkestra completions --shell fish > ~/.config/fish/completions/orkestra.fish

# PowerShell
orkestra completions --shell powershell > $PROFILE
```

---

## orkestra db

Database management for detected databases.

```bash
orkestra db [options]
```

### Options

| Flag | Description |
|------|-------------|
| `-a, --action <action>` | Action: list, create, drop |
| `-n, --name <name>` | Database name |
| `-d, --dir <path>` | Project directory |

### Examples

```bash
# Show database status
orkestra db

# List detected databases
orkestra db list

# Create a database
orkestra db create mydb

# Drop a database
orkestra db drop mydb
```

### Supported Databases

- PostgreSQL (via `psql`, `createdb`, `dropdb`)
- MySQL (via `mysql` CLI)
- SQLite (file-based)

---

## orkestra env

Environment variable management for `.env` files.

```bash
orkestra env [options]
```

### Options

| Flag | Description |
|------|-------------|
| `-s, --set <key=value>` | Set a variable |
| `-g, --get <key>` | Get a variable |
| `-d, --dir <path>` | Project directory |

### Examples

```bash
# List all env vars
orkestra env

# Get a variable
orkestra env --get DATABASE_URL

# Set a variable
orkestra env --set PORT=3000

# Set with spaces in value
orkestra env --set "APP_NAME=My App"
```

### Security

Sensitive values (containing `password`, `secret`, `token`, `key`, `api_key`) are automatically masked in output:

```
DB_PASSWORD=ab****xy
API_KEY=pk****98
```

---

## orkestra docker

Docker Compose management.

```bash
orkestra docker [options]
```

### Options

| Flag | Description |
|------|-------------|
| `-a, --action <action>` | Action: list, up, down, status |
| `-d, --dir <path>` | Project directory |

### Examples

```bash
# Show Docker services
orkestra docker

# List services
orkestra docker list

# Start all services
orkestra docker up

# Stop all services
orkestra docker down

# Show running containers
orkestra docker status
```

### Supported Compose Files

- `docker-compose.yml`
- `docker-compose.yaml`
- `compose.yml`
- `compose.yaml`
- `docker-compose.override.yml`
