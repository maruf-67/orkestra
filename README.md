# Orkestra

**A cross-platform development workspace manager.**

[![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)](https://github.com/maruf-67/orkestra)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D22-brightgreen.svg)](https://nodejs.org)
[![Platform](https://img.shields.io/badge/platform-Linux%20%7C%20macOS%20%7C%20Windows-lightgrey.svg)]()

Orkestra orchestrates your local development environment — reverse proxy, hosts file, SSL certificates, runtime detection, process management, logging, and health monitoring — into a single CLI.

## Quick Start

```bash
# Install
npm install -g orkestra

# Initialize project
cd ~/projects/my-app
orkestra init

# Start server
orkestra up

# Check status
orkestra status

# View logs
orkestra logs

# Stop server
orkestra down
```

## Features

| Feature | Description |
|---------|-------------|
| **Auto-detection** | Framework, package manager, port detection |
| **Smart installer** | Offers to install Caddy/mkcert with permission |
| **Process management** | Start, stop, restart dev servers |
| **Log capture** | Capture and view server logs |
| **Health monitoring** | Auto-restart on crash |
| **Cross-platform** | Linux, macOS, Windows |
| **Shell completions** | ZSH, Bash, Fish, PowerShell |

## Commands

| Command | Description |
|---------|-------------|
| `orkestra init` | Initialize and register project |
| `orkestra up` | Start dev server |
| `orkestra down` | Stop dev server |
| `orkestra status` | Show project status |
| `orkestra logs` | View server logs |
| `orkestra shell` | Open shell with env vars |
| `orkestra remove` | Remove project completely |
| `orkestra doctor` | Check system capabilities |
| `orkestra completions` | Generate shell completions |
| `orkestra share` | Share project via tunnel |

## Platform Support

| Platform | Proxy | SSL | Completions |
|----------|-------|-----|-------------|
| Linux | Caddy/Apache/Nginx | mkcert | bash/zsh/fish |
| macOS | Caddy/Apache/Nginx | mkcert | bash/zsh/fish |
| Windows | Caddy | mkcert | PowerShell |

## Smart Installer

When tools are missing, Orkestra offers to install them:

```bash
$ orkestra init

⚠ No proxy detected
? Caddy is not installed. Install it now? (Y/n) Y
✓ Caddy installed successfully
✓ Project registered successfully!
```

## Documentation

- **[Getting Started](docs/getting-started.md)** — Installation and first steps
- **[User Guide](docs/user-guide.md)** — Complete command reference
- **[Configuration](docs/configuration.md)** — `.orkestra.yml` reference
- **[Installation](docs/installation.md)** — Platform-specific setup
- **[Troubleshooting](docs/troubleshooting.md)** — Common issues and solutions
- **[Architecture](docs/architecture.md)** — System design (for developers)

## Examples

### Next.js Project

```bash
cd ~/projects/my-next-app
orkestra init --port 3000
orkestra up
# Open https://my-next-app.dev.com
```

### Laravel Project

```bash
cd ~/projects/my-laravel-app
orkestra init --port 8000
orkestra up
# Open https://my-laravel-app.dev.com
```

### Multiple Projects

```bash
# Start all projects
orkestra up --all

# Check all status
orkestra status

# Stop all
orkestra down --all
```

## Configuration

```yaml
# .orkestra.yml
name: my-app
port: 3000
domain: my-app.dev.com
ssl: true
proxy: auto
startCommand: "pnpm dev"
```

## Requirements

- **Node.js** 22+
- **Caddy** (auto-installed if missing)
- **mkcert** (auto-installed if missing)
- **localtunnel** (auto-installed if sharing)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and guidelines.

## License

MIT © [maruf-67](https://github.com/maruf-67)
