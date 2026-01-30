# Storybook MCP - Contributor Guide

Welcome to the Storybook MCP Addon monorepo! This project enables AI agents to work more efficiently with Storybook by providing an MCP (Model Context Protocol) server that exposes UI component information and development workflows.

## 📦 Packages

This monorepo contains two main packages:

- **[@storybook/mcp](./packages/mcp)** - Standalone MCP library for serving Storybook component knowledge (can be used independently)
- **[@storybook/addon-mcp](./packages/addon-mcp)** - Storybook addon that runs an MCP server within your Storybook dev server, and includes the functionality of **[@storybook/mcp](./packages/mcp)** from your local Storybook

Each package has its own README with user-facing documentation. This document is for **contributors** looking to develop, test, or contribute to these packages.

## 🚀 Quick Start

### Prerequisites

- **Node.js 24+** - The project requires Node.js 24 or higher (see `.nvmrc`)
- **pnpm 10.19.0+** - Strict package manager requirement (enforced in `package.json`)

```bash
# Use the correct Node version
nvm use

# Install pnpm if you don't have it
npm install -g pnpm@10.19.0
```

### Installation

```bash
# Clone the repository
git clone https://github.com/storybookjs/mcp.git
cd addon-mcp

# Install all dependencies (for all packages in the monorepo)
pnpm install
```

### Development Workflow

```bash
# Build all packages
pnpm build

# Start development mode (watches for changes in all packages)
pnpm dev

# Run unit tests in watch mode
pnpm test

# Run unit tests once
pnpm test:run

# Run Storybook with the addon for testing
pnpm --filter internal-storybook storybook
```

The Storybook command starts:

- The internal test Storybook instance on `http://localhost:6006`
- The addon in watch mode, so changes are reflected automatically
- MCP server available at `http://localhost:6006/mcp`

## 🛠️ Common Tasks

### Development

The `turbo watch build` command runs all packages in watch mode, automatically rebuilding when you make changes:

```bash
# Start development mode for all packages
pnpm turbo watch build
```

```bash
# This is usually all you need - starts Storybook AND watches addon for changes
pnpm storybook
```

### Building

```bash
# Build all packages
pnpm build
```

### Testing

The monorepo uses a centralized Vitest configuration at the root level with projects configured for each package:

```bash
# Watch tests across all packages
pnpm test

# Run tests once across all packages
pnpm test:run

# Run tests with coverage and CI reporters
pnpm test:ci
```

### Debugging MCP Servers

Use the MCP Inspector to debug and test MCP server functionality:

```bash
# Launches the MCP inspector (requires Storybook to be running)
pnpm inspect
```

This uses the configuration in `.mcp.inspect.json` to connect to your local MCP servers.

Alternatively, you can also use these `curl` comamnds to check that everything works:

```bash
# test that the mcp server is running
# use port 6006 to test the addon-mcp server instead
curl -X POST \
  http://localhost:13316/mcp      \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/list",
    "params": {}
  }'

# test a specific tool call
curl -X POST http://localhost:13316/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "tools/call",
    "params": {
      "name": "list-all-documentation",
      "arguments": {}
    }
  }'
```

### Debugging with Storybook

You can start Storybook with:

```bash
pnpm storybook
```

This will build everything and start up Storybook with addon-mcp, and you can then connect your coding agent to it at `http://localhost:6006/mcp` and try it out.

### Working with the MCP App

To work with and debug the MCP app that is rendered as part of the preview-stories tool, you can:

1. Use the Insiders build of VSCode
2. Ensure the [chat.mcp.apps.enabled](vscode-insiders://settings/chat.mcp.apps.enabled) setting is enabled
3. Start up the repo's Storybook in watch mode by running `pnpm storybook` in the root
4. Restart VSCode and, open the [`.vscode/mcp.json`](./.vscode/mcp.json) file and ensure the Storybook MCP is marked as Running, otherwise click Start.
5. Open up a chat in VSCode and write a prompt like this:

> Show me how all the button stories look, using the Storybook MCP

6. After this first prompt, whenever you make changes, Storybook automatically restarts. Wait for it to be fully ready, then you can prompt _"Run the tool again"_.

You can also use [the inspector from MCPJam](https://docs.mcpjam.com/getting-started) to have more low level control of the tool calls.

### Formatting & Linting

```bash
# Format all files with Prettier
pnpm format

# Check formatting without changing files
pnpm format:check

# Lint code with oxlint
pnpm lint

# Lint with GitHub Actions format (for CI)
pnpm lint:ci

# Check package exports with publint
pnpm publint
```

## 🔍 Quality Checks

The monorepo includes several quality checks that run in CI:

```bash
# Run all checks (build, test, lint, format, typecheck, publint)
pnpm check

# Run checks in watch mode (experimental)
pnpm check:watch

# Type checking (uses tsc directly, not turbo)
pnpm typecheck

# Type checking with turbo (for individual packages)
pnpm turbo:typecheck

# Testing with turbo (for individual packages)
pnpm turbo:test
```

## 📝 Code Conventions

### TypeScript & Imports

**Always include file extensions** in relative imports:

```typescript
// ✅ Correct
import { foo } from './bar.ts';

// ❌ Wrong
import { foo } from './bar';
```

- **JSON imports** use the import attributes syntax:

```typescript
import pkg from '../package.json' with { type: 'json' };
```

## 🚢 Release Process

This project uses [Changesets](https://github.com/changesets/changesets) for version management:

```bash
# 1. Create a changeset describing your changes
pnpm changeset
```

When you create a PR, add a changeset if your changes should trigger a release:

- Patch: Bug fixes, documentation updates
- Minor: New features, backward-compatible changes
- Major: Breaking changes

## 🤝 Contributing

We welcome contributions! Here's how to get started:

1. **Fork the repository** and create a feature branch
2. **Make your changes** following the code conventions above
3. **Test your changes** using the internal Storybook instance
4. **Create a changeset** if your changes warrant a release
5. **Submit a pull request** with a clear description

### Before Submitting

- [ ] Code builds without errors (`pnpm build`)
- [ ] Tests pass (`pnpm test:run`)
- [ ] Code is formatted (`pnpm format`)
- [ ] Code is linted (`pnpm lint`)
- [ ] Type checking passes (`pnpm typecheck`)
- [ ] Changes tested with MCP inspector or internal Storybook
- [ ] Changeset created if necessary (`pnpm changeset`)

### Getting Help

- **Ideas & Feature Requests**: [Start a discussion](https://github.com/storybookjs/mcp/discussions/new?category=ideas)
- **Bug Reports**: [Open an issue](https://github.com/storybookjs/mcp/issues/new)
- **Questions**: Ask in [GitHub Discussions](https://github.com/storybookjs/mcp/discussions)

## 📄 License

MIT - See [LICENSE](./LICENSE) for details

---

**Note**: This project is experimental and under active development. APIs and architecture may change as we explore the best ways to integrate AI agents with Storybook.
