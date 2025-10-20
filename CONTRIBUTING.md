# Contributing to Storybook MCP Addon

Thank you for your interest in contributing! This repository uses a monorepo structure to organize multiple related packages.

## Repository Structure

This is a monorepo managed with [pnpm workspaces](https://pnpm.io/workspaces) and [Turborepo](https://turborepo.com):

```
addon-mcp/
├── packages/
│   └── addon-mcp/         # The main Storybook MCP addon
├── pnpm-workspace.yaml    # Workspace configuration
├── turbo.json             # Turborepo pipeline configuration
└── package.json           # Root package.json with workspace scripts
```

## Development Setup

### Prerequisites

- Node.js >= 20.0.0
- pnpm >= 10.15.0 (automatically installed via packageManager field)

### Getting Started

1. **Clone the repository**:
   ```bash
   git clone https://github.com/storybookjs/addon-mcp.git
   cd addon-mcp
   ```

2. **Install dependencies**:
   ```bash
   pnpm install
   ```
   This installs dependencies for all packages in the workspace.

3. **Build packages**:
   ```bash
   pnpm build
   ```
   Turborepo will orchestrate the build process across all packages.

4. **Start development**:
   ```bash
   pnpm start
   ```
   This starts the development server for the addon package.

## Available Commands

### Root-level commands

These commands are available from the repository root:

- `pnpm build` - Build all packages using Turborepo
- `pnpm build-storybook` - Build Storybook for the addon package
- `pnpm test` - Run tests across all packages
- `pnpm start` - Start development mode for the addon package
- `pnpm storybook` - Start Storybook dev server for the addon package
- `pnpm inspect` - Run the MCP inspector
- `pnpm changeset` - Create a new changeset for releases

### Package-specific commands

To run commands for a specific package, use pnpm filtering:

```bash
pnpm --filter @storybook/addon-mcp <command>
```

For example:
```bash
pnpm --filter @storybook/addon-mcp build
pnpm --filter @storybook/addon-mcp test
```

## Turborepo

We use [Turborepo](https://turborepo.com) as our task runner for better performance through:

- **Caching**: Tasks are cached based on inputs, so unchanged code doesn't need to be rebuilt
- **Parallelization**: Independent tasks run in parallel
- **Dependency ordering**: Tasks respect package dependencies automatically

The Turborepo configuration is in `turbo.json`.

## Making Changes

1. Create a new branch from `main`
2. Make your changes
3. Run `pnpm build` to ensure everything builds correctly
4. Create a changeset if your changes should be published:
   ```bash
   pnpm changeset
   ```
5. Submit a pull request

## Adding a New Package

To add a new package to the monorepo:

1. Create a new directory in `packages/`
2. Add a `package.json` with a unique name
3. The package will automatically be included in the workspace
4. Update `turbo.json` if the package needs specific build tasks

## Questions?

Feel free to [open a discussion](https://github.com/storybookjs/addon-mcp/discussions) if you have questions about contributing!
