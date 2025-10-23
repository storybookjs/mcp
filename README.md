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

# Run unit tests
pnpm test

# Run Storybook with the addon for testing
pnpm storybook
```

The `pnpm storybook` command starts:

- The internal test Storybook instance on `http://localhost:6006`
- The addon in watch mode, so changes are reflected automatically
- MCP server available at `http://localhost:6006/mcp`

## 🛠️ Common Tasks

### Development

The `dev` command runs all packages in watch mode, automatically rebuilding when you make changes:

```bash
# Start development mode for all packages
pnpm dev
```

This runs:

- `packages/addon-mcp` in watch mode (using `tsdown --watch`)
- `packages/mcp` in watch mode (using Node's `--watch` flag)

**Note:** Running `pnpm storybook` automatically starts the addon in dev mode alongside Storybook. In this mode, making changes to `addon-mcp` will automatically restart Storybook. So you typically only need one command:

```bash
# This is usually all you need - starts Storybook AND watches addon for changes
pnpm storybook
```

For more advanced workflows, you can run dev mode for a specific package:

```bash
# Watch only the addon package
pnpm --filter @storybook/addon-mcp dev

# Watch only the mcp package
pnpm --filter @storybook/mcp dev
```

### Building

```bash
# Build all packages
pnpm build

# Build a specific package
pnpm --filter @storybook/addon-mcp build
pnpm --filter @storybook/mcp build
```

### Testing

```bash
# Watch tests
pnpm test

# Run tests
pnpm test run

# Run tests with coverage
pnpm test run --coverage
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
# start package development
pnpm dev
```

### Debugging with Storybook

You can start the Storybook with

```bash
pnpm storybook
```

```bash
# test that the server is running
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
      "name": "list-all-components",
      "arguments": {}
    }
  }'
```

This will build everything and start up Storybook with addon-mcp, and you can then connect your coding agent to it at `http://localhost:6006/mcp` and try it out.

### Formatting

```bash
# Format all files
pnpm format

# Check formatting without changing files
pnpm format --check
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
- [ ] Tests pass (`pnpm test`)
- [ ] Code is formatted (`pnpm format`)
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
