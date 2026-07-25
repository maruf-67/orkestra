# Configuration Reference

Orkestra uses a `.orkestra.yml` file in your project root for configuration.

## Configuration File

### Location

```
your-project/
├── .orkestra.yml    # Orkestra configuration
├── src/
├── package.json
└── ...
```

### Creating Configuration

```bash
# Interactive setup
orkestra init

# Or create manually
touch .orkestra.yml
```

## Configuration Options

```yaml
# Project name (default: directory name)
name: my-app

# Framework (auto-detected if not specified)
framework: nuxt

# Proxy provider
# Options: auto, caddy, nginx, apache, traefik
proxy: auto

# Runtime manager
# Options: auto, mise, nvm, fnm, asdf, volta, system
runtime: auto

# Development server port
port: 3000

# Local domain name
domain: my-app.dev.com

# Enable SSL (requires proxy)
ssl: true

# Custom start command (overrides auto-detection)
startCommand: "pnpm dev"
```

## Configuration Fields

### name

Project name displayed in status and logs.

```yaml
name: my-app
```

### framework

Framework identifier for detection. Auto-detected if not specified.

**Supported frameworks:**
- **JavaScript/TypeScript**: Next.js, Nuxt, Remix, Astro, SvelteKit, Vite, Express, Fastify
- **PHP**: Laravel, Symfony
- **Python**: FastAPI, Flask, Django
- **Go**: Go
- **Rust**: Rust

```yaml
framework: nuxt
```

### proxy

Reverse proxy provider for local domains and HTTPS.

**Options:**
- `auto` — Detect and use available proxy
- `caddy` — Use Caddy (recommended)
- `nginx` — Use Nginx
- `apache` — Use Apache
- `traefik` — Use Traefik

```yaml
proxy: auto
```

### runtime

Node.js runtime manager.

**Options:**
- `auto` — Detect and use available runtime
- `mise` — Use mise
- `nvm` — Use nvm
- `fnm` — Use fnm
- `asdf` — Use asdf
- `volta` — Use volta
- `system` — Use system Node.js

```yaml
runtime: auto
```

### port

Development server port.

```yaml
port: 3000
```

### domain

Local domain name for the project.

```yaml
domain: my-app.dev.com
```

### ssl

Enable HTTPS with locally-trusted certificates.

Requires a proxy (Caddy recommended) and mkcert.

```yaml
ssl: true
```

### startCommand

Custom command to start the development server.

Overrides automatic detection from `package.json` scripts.

```yaml
startCommand: "pnpm dev"
```

## Example Configurations

### Next.js Project

```yaml
name: my-next-app
framework: next.js
port: 3000
domain: my-next-app.dev.com
ssl: true
proxy: caddy
startCommand: "pnpm dev"
```

### Laravel Project

```yaml
name: my-laravel-app
framework: laravel
port: 8000
domain: my-laravel-app.dev.com
ssl: true
proxy: caddy
startCommand: "php artisan serve --port=8000"
```

### FastAPI Project

```yaml
name: my-fastapi-app
framework: fastapi
port: 8000
domain: my-fastapi-app.dev.com
ssl: true
proxy: caddy
startCommand: "uvicorn main:app --reload --port 8000"
```

### Go Project

```yaml
name: my-go-app
framework: go
port: 8080
domain: my-go-app.dev.com
ssl: true
proxy: caddy
startCommand: "go run ."
```

## State Storage

Orkestra stores project state in `~/.orkestra/state.json`.

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
      "startedAt": "2026-07-25T10:00:00.000Z"
    }
  },
  "allocatedPorts": [3000, 8000]
}
```

## Log Storage

Logs are stored in `.orkestra/logs/` within your project.

```
your-project/
├── .orkestra/
│   └── logs/
│       └── my-app.log
├── .orkestra.yml
└── ...
```

## .gitignore Entry

Orkestra automatically adds `.orkestra` to `.gitignore` when you run `orkestra init`.

```gitignore
# Orkestra
.orkestra
```
