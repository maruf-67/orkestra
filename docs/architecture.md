# Architecture

Technical overview of Orkestra's architecture and design decisions.

## System Overview

```
┌─────────────────────────────────────────────────────────────┐
│                        CLI Layer                            │
│  src/cli.ts → Commander.js parses commands                  │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                     Commands Layer                          │
│  src/commands/                                              │
│  ├── init.ts      # Project initialization                 │
│  ├── up.ts        # Start dev server                       │
│  ├── down.ts      # Stop dev server                        │
│  ├── status.ts    # Show project status                    │
│  ├── logs.ts      # View server logs                       │
│  ├── shell.ts     # Open shell with env vars               │
│  ├── remove.ts    # Remove project                         │
│  ├── doctor.ts    # Check system capabilities              │
│  ├── list.ts      # List all projects                      │
│  ├── open.ts      # Open in browser                        │
│  └── completions.ts # Shell completions                    │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                    Detection Layer                          │
│  src/detection/                                             │
│  ├── framework.ts     # Framework detection                │
│  ├── proxy.ts         # Proxy detection                    │
│  ├── runtime.ts       # Runtime manager detection          │
│  └── package-manager.ts # Package manager detection        │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                    Providers Layer                          │
│  src/providers/                                             │
│  ├── proxy/                                         │
│  │   ├── caddy.ts     # Caddy proxy                       │
│  │   ├── nginx.ts     # Nginx proxy                       │
│  │   ├── apache.ts    # Apache proxy                      │
│  │   └── traefik.ts   # Traefik proxy                     │
│  ├── hosts/                                         │
│  │   └── hosts.ts     # Hosts file management             │
│  ├── runtime/                                       │
│  │   ├── mise.ts      # mise runtime                      │
│  │   ├── nvm.ts       # nvm runtime                       │
│  │   ├── fnm.ts       # fnm runtime                       │
│  │   ├── asdf.ts      # asdf runtime                      │
│  │   ├── volta.ts     # volta runtime                     │
│  │   └── system.ts    # System runtime                    │
│  └── types.ts         # Provider interfaces               │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                    Utilities Layer                          │
│  src/utils/                                                 │
│  ├── exec.ts          # Command execution                  │
│  ├── logger.ts        # Logging and spinners               │
│  ├── logger-file.ts   # Log file capture                   │
│  ├── registration.ts  # Shared registration logic          │
│  ├── installer.ts     # Smart tool installer               │
│  ├── host-config.ts   # AllowedHosts management            │
│  └── health.ts        # Health monitoring                  │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                     State Layer                             │
│  src/state/                                                 │
│  ├── store.ts         # State persistence                  │
│  └── ports.ts         # Port allocation                    │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                    Platform Layer                           │
│  src/platform/                                              │
│  └── index.ts         # Platform detection and config      │
└─────────────────────────────────────────────────────────────┘
```

## Core Concepts

### Provider Model

Orkestra uses a provider-based architecture where each capability has an interface:

```typescript
interface ProxyProvider {
  name: string;
  priority: number;
  detect(): Promise<boolean>;
  register(config: ProxyConfig): Promise<void>;
  unregister(domain: string): Promise<void>;
  reload(): Promise<void>;
}
```

Providers are discovered and selected based on:
1. Availability (is it installed?)
2. Priority (higher = preferred)
3. User preference (config override)

### Detection Order

Framework detection checks in this order:
1. Specific frameworks (Next.js, Nuxt, Laravel, etc.)
2. Generic fallbacks (Node.js, Python, Go)

### State Management

Project state is stored in `~/.orkestra/state.json`:

```json
{
  "projects": {
    "/path/to/project": {
      "name": "my-app",
      "domain": "my-app.dev.com",
      "port": 3000,
      "framework": "nuxt",
      "proxy": "caddy",
      "pid": 12345,
      "startedAt": "2026-07-25T10:00:00.000Z"
    }
  },
  "allocatedPorts": [3000]
}
```

## Key Design Decisions

### ADR-001: Provider-Based Plugin Architecture

**Decision:** Use TypeScript interfaces for each provider type.

**Rationale:**
- Allows swapping implementations without changing core
- Enables community extensions
- Clear contract for what each provider must implement

### ADR-002: Single npm Package

**Decision:** One `npm i -g orkestra` install.

**Rationale:**
- Simple installation
- Single binary entry point
- Internal modular structure

### ADR-003: State Storage in ~/.orkestra/

**Decision:** Store state in user's home directory.

**Rationale:**
- Cross-platform compatible
- User-specific (no sudo needed for state)
- Survives project deletion

### ADR-004: SSL via mkcert

**Decision:** Use mkcert for local development certificates.

**Rationale:**
- Generates certificates trusted by system CA
- No browser warnings
- Works across all platforms

## Error Handling

### Graceful Degradation

When tools are missing:
1. Detect missing tool
2. Warn user
3. Offer to install (with permission)
4. Continue without tool if declined

### Health Monitoring

When server crashes:
1. Detect process exit
2. Log the crash
3. Attempt restart (max 3 attempts)
4. Log restart attempts
5. Stop if max attempts exceeded

## Testing

### Test Structure

```
test/
├── config/
│   └── schema.test.ts
├── detection/
│   └── framework.test.ts
├── state/
│   └── store.test.ts
└── utils/
    ├── registration.test.ts
    └── logger-file.test.ts
```

### Running Tests

```bash
# Run all tests
pnpm test

# Run in watch mode
pnpm test:watch

# Run specific test
pnpm test -- --grep "framework detection"
```
