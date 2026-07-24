# Orkestra

**A cross-platform development workspace manager.**

Orkestra orchestrates your local development environment — reverse proxy, hosts file, SSL certificates, runtime detection, process management, and project registration — into a single CLI.

---

## Installation

```bash
npm install -g orkestra
# or
pnpm install -g orkestra
```

### Verify

```bash
orkestra --version
orkestra doctor
```

---

## Quick Start

```bash
cd ~/projects/my-app
orkestra up           # register + start server
orkestra open         # open in browser
orkestra down         # stop server
orkestra remove       # clean everything
```

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
| `orkestra db` | Database management |
| `orkestra env` | Environment variable management |
| `orkestra docker` | Docker compose management |

---

## Detailed Usage

### `orkestra up`

Starts your dev server. Auto-detects framework and command.

```bash
orkestra up
orkestra up --port 3000
```

### `orkestra down`

```bash
orkestra down          # stop current project
orkestra down --all    # stop all running servers
```

### `orkestra status`

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

  ○ api-service
  Status     stopped
  Domain     api.dev.com
  Port       8080
  Framework  go
```

### `orkestra db`

```bash
orkestra db                    # show database status
orkestra db create mydb        # create database
orkestra db drop mydb          # drop database
orkestra db list               # list detected databases
```

### `orkestra env`

```bash
orkestra env                          # list all env vars
orkestra env --get DATABASE_URL       # get a variable
orkestra env --set PORT=3000          # set a variable
```

Sensitive values (passwords, tokens) are auto-masked in output.

### `orkestra docker`

```bash
orkestra docker              # show docker services
orkestra docker up           # start all services
orkestra docker down         # stop all services
orkestra docker status       # show running containers
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

```bash
orkestra register --proxy nginx
```

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

## Configuration

### `.orkestra.yml`

```yaml
name: my-app
framework: nuxt
proxy: auto          # auto | caddy | nginx | apache | traefik
runtime: auto        # auto | mise | nvm | fnm | asdf | volta | system
port: 3000
domain: my-app.dev.com
ssl: true
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
      "pid": 12345
    }
  }
}
```

---

## Platform Support

| Platform | Hosts File | Proxies |
|----------|-----------|---------|
| Linux | `/etc/hosts` | Caddy, Nginx, Apache, Traefik |
| macOS | `/etc/hosts` | Caddy, Nginx, Apache, Traefik |
| Windows | `C:\Windows\System32\drivers\etc\hosts` | Caddy |

---

## Plugin SDK

Create custom providers:

```js
// ~/.orkestra/plugins/my-proxy/index.js
module.exports = {
  proxy: {
    name: "my-proxy",
    priority: 50,
    detect: async () => true,
    register: async (config) => { /* ... */ },
    unregister: async (domain) => { /* ... */ },
    reload: async () => { /* ... */ }
  }
}
```

---

## Troubleshooting

**Permission denied on hosts file** — Orkestra needs sudo. You'll be prompted.

**Host not allowed** — Add to `server.allowedHosts` in vite.config or nuxt.config.

**SSL not trusted** — Run `mkcert -install`.

**Port in use** — Orkestra auto-finds next available port, or specify `--port`.

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
