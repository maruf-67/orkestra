# Orkestra

**A cross-platform development workspace manager.**

Orkestra orchestrates your local development environment — reverse proxy, hosts file, SSL certificates, runtime detection, and project registration — into a single CLI. No more manually editing Caddyfiles, `/etc/hosts`, or remembering which port each project uses.

---

## Installation

### Prerequisites

- **Node.js >= 22** (required)
- **A reverse proxy** (Caddy recommended — auto-installed if missing)
- **mkcert** (for trusted local SSL — installed automatically)

### Install

```bash
npm install -g orkestra
```

Or with pnpm:

```bash
pnpm install -g orkestra
```

### Verify Installation

```bash
orkestra --version
orkestra doctor
```

The `doctor` command checks your system and shows what's available:

```
Orkestra Doctor
───────────────
i OS: Linux

Languages & Frameworks
──────────────────────
  Languages   php, javascript, python, go, rust
  Frameworks  laravel, symfony, next.js, nuxt, remix, astro, ...

Runtime Managers
────────────────
  mise    ✓
  system  ✓

Proxies
───────
  caddy   ✓
  nginx   ✗
  apache  ✓

Package Managers
────────────────
  pnpm  ✓
  npm   ✓

Databases
─────────
  postgresql  ✓
  mysql       ✓
  redis       ✗

Recommendations
───────────────
✓ Proxy: caddy
✓ Runtime: mise
```

---

## Quick Start

```bash
# 1. Go to your project
cd ~/projects/my-app

# 2. Start everything (auto-detects framework, registers, starts server)
orkestra up

# 3. Open in browser
orkestra open

# 4. When done, stop and clean up
orkestra down
orkestra remove
```

That's it. One command to start, one to stop.

---

## Commands

| Command | Description |
|---------|-------------|
| `orkestra doctor` | Check system capabilities |
| `orkestra init` | Create `.orkestra.yml` config |
| `orkestra register` | Register project with proxy and hosts |
| `orkestra up` | Start dev server |
| `orkestra down` | Stop dev server |
| `orkestra restart` | Restart dev server |
| `orkestra status` | Show all projects and their state |
| `orkestra open` | Open project in browser |
| `orkestra list` | List all registered projects |
| `orkestra remove` | Remove project and clean up everything |
| `orkestra logs` | View dev server logs |

---

## Detailed Usage

### `orkestra up`

Starts your dev server. Auto-detects the framework and the right command to run.

```bash
orkestra up
orkestra up --port 3000
orkestra up --dir /path/to/project
```

What it does:
1. Detects your framework (Laravel, Next.js, Nuxt, Go, Rust, etc.)
2. Finds or generates an SSL certificate (via mkcert)
3. Updates `/etc/hosts` with the domain
4. Configures the reverse proxy (Caddy/Nginx/Apache)
5. Starts the dev server in the background
6. Adds domain to Vite/Nuxt `allowedHosts`

Output:
```
Start Dev Server
────────────────
✓ Framework: nuxt ^4.5.0
✓ Registered as my-app.dev.com
✓ Server started (PID: 12345)

Summary
───────
  PID:      12345
  URL:      https://my-app.dev.com
  Local:    http://localhost:3000
  Framework: nuxt
  Port:     3000

Stop with: orkestra down
```

### `orkestra down`

Stops the dev server.

```bash
orkestra down          # stop current project
orkestra down --all    # stop all running servers
```

### `orkestra restart`

Restarts the dev server (stop + start).

```bash
orkestra restart
```

### `orkestra status`

Shows all registered projects and whether they're running.

```bash
orkestra status
```

Output:
```
Project Status
──────────────

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
  Proxy      caddy
  URL        -
  PID        -

2 project(s) registered
```

### `orkestra register`

Registers a project with the reverse proxy and hosts file.

```bash
orkestra register
orkestra register --domain custom.dev.com --port 8080
orkestra register --proxy nginx
```

### `orkestra remove`

Removes everything: hosts entry, proxy config, SSL certs, `.orkestra.yml`, and state.

```bash
orkestra remove
```

### `orkestra open`

Opens the project URL in your default browser.

```bash
orkestra open
```

### `orkestra init`

Creates `.orkestra.yml` in the project directory.

```bash
orkestra init
```

Generated config:
```yaml
name: my-app
framework: nuxt
proxy: auto
runtime: auto
port: 3000
domain: my-app.dev.com
ssl: true
```

---

## Supported Frameworks

| Language | Framework | Default Port |
|----------|-----------|--------------|
| PHP | Laravel | 8000 |
| PHP | Symfony | 8000 |
| JavaScript | Next.js | 3000 |
| JavaScript | Nuxt | 3000 |
| JavaScript | Remix | 3000 |
| JavaScript | Astro | 4321 |
| JavaScript | SvelteKit | 5173 |
| JavaScript | Vite | 5173 |
| JavaScript | Express | 3000 |
| JavaScript | Fastify | 3000 |
| JavaScript | Node.js | 3000 |
| Python | FastAPI | 8000 |
| Python | Flask | 5000 |
| Python | Django | 8000 |
| Python | Python (generic) | 8000 |
| Go | Go | 8080 |
| Rust | Rust | 8080 |

---

## Supported Proxies

| Proxy | Priority | SSL | Auto-detect |
|-------|----------|-----|-------------|
| Caddy | 100 | mkcert (trusted) | `caddy version` |
| Nginx | 80 | snakeoil cert | `nginx -v` |
| Apache | 60 | snakeoil cert | `apache2 -v` |

Set proxy manually:
```bash
orkestra register --proxy nginx
```

Or in `.orkestra.yml`:
```yaml
proxy: nginx
```

---

## SSL Certificates

Orkestra uses **mkcert** to generate locally-trusted SSL certificates:

1. mkcert installs a local Certificate Authority (CA)
2. The CA is added to your system's trust store
3. Certificates are generated for each domain
4. Browsers trust them — **no warnings**

If mkcert is not installed, Orkestra installs it automatically.

---

## Configuration

### `.orkestra.yml`

Created by `orkestra init` or automatically during `orkestra register`:

```yaml
name: my-app          # Project name
framework: nuxt       # Auto-detected
proxy: auto           # auto | caddy | nginx | apache
runtime: auto         # auto | mise | system
port: 3000            # Dev server port
domain: my-app.dev.com # Local domain
ssl: true             # Enable HTTPS
```

### State

Orkestra stores state in `~/.orkestra/state.json`:

```json
{
  "projects": {
    "/home/user/projects/my-app": {
      "name": "my-app",
      "domain": "my-app.dev.com",
      "port": 3000,
      "framework": "nuxt",
      "proxy": "caddy",
      "pid": 12345,
      "startedAt": "2026-07-24T10:00:00Z"
    }
  },
  "allocatedPorts": [3000, 8080]
}
```

---

## Platform Support

| Platform | Hosts File | Proxy | SSL |
|----------|-----------|-------|-----|
| Linux | `/etc/hosts` | Caddy/Nginx/Apache | mkcert |
| macOS | `/etc/hosts` | Caddy/Nginx/Apache | mkcert |
| Windows | `C:\Windows\System32\drivers\etc\hosts` | Caddy | mkcert |

---

## How It Works

```
orkestra up
    │
    ├── 1. Detect framework (Laravel, Next.js, Go, etc.)
    ├── 2. Find or generate SSL certificate (mkcert)
    ├── 3. Update /etc/hosts with domain
    ├── 4. Configure reverse proxy (Caddy)
    ├── 5. Start dev server in background
    └── 6. Add domain to Vite/Nuxt allowedHosts
```

---

## Troubleshooting

### "Permission denied" on hosts file

Orkestra needs sudo to modify `/etc/hosts`. You'll be prompted for your password.

### "This host is not allowed"

Orkestra auto-adds the domain to `server.allowedHosts` in your Vite/Nuxt config. If it doesn't work, add manually:

```js
// nuxt.config.ts or vite.config.ts
export default defineNuxtConfig({
  vite: {
    server: {
      allowedHosts: ["my-app.dev.com"]
    }
  }
})
```

### SSL certificate not trusted

Run:
```bash
mkcert -install
```

This installs the local CA into your system trust store.

### Port already in use

Orkestra automatically finds the next available port. You can also specify one:

```bash
orkestra up --port 4000
```

### Caddy not starting

Check the config:
```bash
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl status caddy
```

---

## Typical Workflow

```bash
# Start your day
cd ~/projects/my-app
orkestra up

# Work on your project
# Server is running at https://my-app.dev.com

# Check status
orkestra status

# Restart after config changes
orkestra restart

# Stop for the day
orkestra down

# Switch to another project
cd ~/projects/api-service
orkestra up
```

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
