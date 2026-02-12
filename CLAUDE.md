# CLAUDE.md

## Project Overview

Monorepo for the Storybook MCP server and addon. Two published packages:

- **`@storybook/mcp`** (`packages/mcp`) — Standalone MCP server that serves component documentation from Storybook manifests. Can run via stdio or HTTP.
- **`@storybook/addon-mcp`** (`packages/addon-mcp`) — Storybook addon that runs the MCP server in-process inside the Storybook dev server.

And one internal app:

- **`apps/internal-storybook`** — Test Storybook with three configs: single-source (`.storybook`), composition (`.storybook-composition`), and composition with OAuth (`.storybook-composition-auth`). E2E tests live here.

## Architecture

```
@storybook/addon-mcp
├── src/preset.ts          — Storybook preset, registers /mcp endpoint
├── src/mcp-handler.ts     — HTTP handler, converts Node req/res ↔ Web Request/Response
├── src/auth/              — OAuth composition auth (multi-source private Storybooks)
├── src/tools/             — Addon-specific tools (preview-stories, story instructions)
└── depends on @storybook/mcp

@storybook/mcp
├── src/tools/             — Core tools (list-all-documentation, get-documentation, get-documentation-for-story)
├── src/utils/             — Manifest fetching, formatting (markdown/xml), react-docgen parsing
└── src/types.ts           — Valibot schemas for ComponentManifest, Story, Doc, Source
```

## Tech Stack

- **MCP protocol**: `tmcp` with `@tmcp/adapter-valibot` and `@tmcp/transport-http`
- **Schema validation**: `valibot` (use `v.object()`, `v.pipe()`, `v.parse()`)
- **Build**: `turbo` (monorepo orchestration) + `tsdown` (bundler)
- **Test**: `vitest` with multi-project config (each package is a vitest project)
- **Lint**: `oxlint` (type-aware)
- **Format**: `oxfmt`
- **Storybook**: v10

## Commands

```sh
turbo run build                     # Build all packages (dependency order)
turbo run typecheck                 # TypeScript check
turbo run test                      # Unit tests in watch mode (builds deps first)
turbo run test:run                  # Unit tests once
turbo run dev                       # Dev mode for all packages
turbo watch storybook               # Start internal Storybook with rebuild on change
pnpm check                          # Full CI: build, format, lint, publint, typecheck, test:run
pnpm lint                           # oxlint
pnpm format                         # oxfmt
```

## Testing

- Use `toMatchInlineSnapshot()` for assertions where possible. Inline snapshots show the full response shape and catch regressions better than individual field checks.
- E2E tests (`apps/internal-storybook/tests/`) start real Storybook servers and take 30+ seconds. Run `turbo run build` first so the addon dist is up to date.
- Unit tests and e2e tests are separate vitest projects. `turbo run test` runs all of them, including e2e.

