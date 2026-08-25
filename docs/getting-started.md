# Getting Started with Orkestra

Orkestra is a cross-platform development workspace manager that simplifies local development with automatic project registration, HTTPS, and process management.

## Quick Install

```bash
# Using npm
npm install -g orkestra

# Using pnpm
pnpm add -g orkestra

# Using yarn
yarn global add orkestra
```

## First Steps

### 1. Verify Installation

```bash
orkestra --version
orkestra doctor
```

### 2. Initialize a Project

```bash
cd ~/projects/my-app
orkestra init
```

This will:
- Detect your framework (Next.js, Nuxt, Laravel, etc.)
- Create `.orkestra.yml` configuration
- Register with your proxy (Caddy)
- Add domain to `/etc/hosts`
- Add `.orkestra` to `.gitignore`

### 3. Start Development

```bash
orkestra up
```

Your server is now running with:
- Local URL: `http://localhost:3000`
- Domain URL: `https://my-app.dev.com`

### 4. Check Status

```bash
orkestra status
```

## What Orkestra Does

```
┌─────────────────────────────────────────────────────────────┐
│                      Your Project                          │
│  ~/projects/my-app                                         │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                      Orkestra                               │
│  1. Detects framework (Next.js, Nuxt, Laravel, etc.)       │
│  2. Registers project with local domain                    │
│  3. Configures reverse proxy (Caddy)                       │
│  4. Sets up SSL certificates (mkcert)                      │
│  5. Manages dev server process                             │
│  6. Captures logs                                          │
│  7. Monitors health                                        │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                      Browser                                │
│  https://my-app.dev.com                                    │
│  ✓ HTTPS enabled                                           │
│  ✓ No browser warnings                                     │
│  ✓ Local domain                                            │
└─────────────────────────────────────────────────────────────┘
```

## Example Workflow

```bash
# Start fresh
cd ~/projects/my-new-app
orkestra init --port 3000

# Start server
orkestra up

# Work on your project...

# Check logs
orkestra logs

# Stop when done
orkestra down

# Clean up completely
orkestra remove
```

## Next Steps

- Read the [User Guide](./user-guide.md) for complete command reference
- Check [Configuration](./configuration.md) for advanced options
- See [Troubleshooting](./troubleshooting.md) if you encounter issues
