# Orkestra

A cross-platform development workspace manager.

Orkestra orchestrates your local development environment — reverse proxy, hosts file, runtime detection, and project registration — into a single CLI. No more manually editing Caddyfiles or `/etc/hosts`.

## Quick Start

```bash
# Install globally
npm install -g orkestra

# Check what's available on your system
orkestra doctor

# Register a project (in the project directory)
orkestra register

# List all registered projects
orkestra list

# Open a project in the browser
orkestra open

# Remove a project
orkestra remove
```

## Commands

| Command | Description |
|---------|-------------|
| `orkestra doctor` | Check system capabilities (runtimes, proxies, package managers) |
| `orkestra init` | Initialize `.orkestra.yml` config for a project |
| `orkestra register` | Register project with proxy and hosts file |
| `orkestra remove` | Remove project from proxy and hosts file |
| `orkestra list` | List all registered projects |
| `orkestra open` | Open project in browser |

## How It Works

1. **Detect** — Orkestra identifies your framework (Laravel, Next.js, Nuxt, etc.)
2. **Allocate** — Finds an available port
3. **Register** — Updates `/etc/hosts` and your reverse proxy config
4. **Done** — Your project is available at `https://your-project.test`

## Supported Languages & Frameworks

| Language | Frameworks |
|----------|------------|
| PHP | Laravel, Symfony |
| JavaScript/TypeScript | Next.js, Nuxt, Remix, Astro, SvelteKit, Vite, Express, Fastify, Node.js |
| Python | FastAPI, Flask, Django, Python (generic) |
| Go | Go |
| Rust | Rust |

## Supported Proxies

- Caddy (recommended — zero-config SSL)

## Supported Runtime Managers

- mise
- System Node.js (fallback)

## Configuration

Create `.orkestra.yml` in your project root:

```yaml
name: my-app
framework: laravel
proxy: auto
runtime: auto
port: 8000
domain: my-app.test
ssl: true
```

## Platform Support

- Linux
- macOS
- Windows

## Requirements

- Node.js >= 22
- A reverse proxy (Caddy recommended)

## License

MIT
