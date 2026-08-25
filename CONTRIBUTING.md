# Contributing to Orkestra

Thank you for your interest in contributing to Orkestra! This guide will help you get started.

## Development Setup

### Prerequisites

- Node.js 22+
- pnpm (recommended)
- Git

### Clone and Install

```bash
# Clone the repository
git clone https://github.com/maruf-67/orkestra.git
cd orkestra

# Install dependencies
pnpm install

# Build the project
pnpm build

# Link for local development
npm link
```

### Project Structure

```
orkestra/
├── src/
│   ├── cli.ts              # CLI entry point
│   ├── commands/           # Command implementations
│   ├── detection/          # Framework/proxy detection
│   ├── providers/          # Provider implementations
│   ├── state/              # State management
│   ├── platform/           # Platform-specific code
│   └── utils/              # Utility functions
├── test/                   # Test files
├── docs/                   # Documentation
├── dist/                   # Built output
├── package.json
└── tsconfig.json
```

## Development Workflow

### Running in Development

```bash
# Build and watch for changes
pnpm dev

# In another terminal, test your changes
orkestra --version
```

### Running Tests

```bash
# Run all tests
pnpm test

# Run tests in watch mode
pnpm test:watch

# Run specific test file
pnpm test -- test/detection/framework.test.ts
```

### Type Checking

```bash
pnpm lint
```

## Making Changes

### Branch Strategy

- `main` — Stable releases
- `dev` — Integration branch
- `feat/*` — Feature branches
- `fix/*` — Bug fix branches

### Creating a Branch

```bash
git checkout dev
git pull origin dev
git checkout -b feat/my-feature
```

### Commit Messages

Follow conventional commits:

```
feat: add new feature
fix: fix a bug
docs: update documentation
refactor: refactor code
test: add tests
chore: maintenance tasks
```

### Submitting a PR

1. Push your branch
2. Create a PR targeting `dev`
3. Fill out the PR template
4. Wait for review

## Code Style

- TypeScript strict mode
- ESLint for linting
- Prettier for formatting

```bash
# Format code
pnpm format

# Lint code
pnpm lint
```

## Testing Guidelines

- Write tests for new features
- Ensure all tests pass before submitting
- Aim for meaningful coverage, not 100%

## Documentation

- Update README for user-facing changes
- Update docs/ for detailed documentation
- Add JSDoc comments for public APIs

## Questions?

- Open an issue for bugs
- Start a discussion for questions
- Check existing issues before creating new ones

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
