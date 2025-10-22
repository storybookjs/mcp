# Copilot Instructions for Storybook MCP Addon

## Architecture Overview

This is a **pnpm monorepo** with two distinct MCP implementations:

- **`packages/addon-mcp`**: Storybook addon using `@modelcontextprotocol/sdk`, exposes MCP server at `/mcp` via Vite middleware
- **`packages/mcp`**: Standalone MCP library using `tmcp`, reusable outside Storybook
- **`apps/internal-storybook`**: Test environment for addon integration

**Critical distinction**: The two packages use **different MCP libraries** (`@modelcontextprotocol/sdk` vs `tmcp`). Don't confuse their APIs or patterns.

### Addon Architecture

The addon uses a **Vite plugin workaround** to inject middleware (see `packages/addon-mcp/src/preset.ts`):

- Storybook doesn't expose an API for addons to register server middleware
- Solution: Inject a Vite plugin via `viteFinal` that adds `/mcp` endpoint
- Handler in `mcp-handler.ts` creates session-based MCP servers using `StreamableHTTPServerTransport`

### MCP Library Architecture

The `@storybook/mcp` package (in `packages/mcp`) is framework-agnostic:

- Uses `tmcp` with HTTP transport and Valibot schema validation
- Factory pattern: `createStorybookMcpHandler()` returns a request handler
- Context-based: handlers accept `StorybookContext` to override source URLs

## Development Environment

**Prerequisites:**

- Node.js **24+** (enforced by `.nvmrc`)
- pnpm **10.19.0+** (strict `packageManager` in root `package.json`)

**Monorepo orchestration:**

- Turborepo manages build dependencies (see `turbo.json`)
- Run `pnpm dev` at root for parallel development
- Run `pnpm storybook` to test addon (starts internal-storybook + addon dev mode)

**Build tools differ by package:**

- `packages/mcp`: Uses `tsdown` (rolldown-based, faster builds)
- `packages/addon-mcp`: Uses `tsup` (esbuild-based)

**Testing:**

- Only `packages/mcp` has tests (Vitest with coverage)
- Run `pnpm test run --coverage` in mcp package
- Prefer TDD when adding new tools

**Debugging MCP servers:**

```bash
pnpm inspect  # Launches MCP inspector using .mcp.inspect.json config
```

## Code Style & Conventions

**ESM-only codebase:**

- All packages have `"type": "module"`
- **ALWAYS include file extensions** in imports: `import { foo } from './bar.ts'` (not `./bar`)
- Exception: Package imports don't need extensions

**JSON imports:**

```typescript
import pkgJson from '../package.json' with { type: 'json' };
```

**TypeScript config:**

- Uses `@tsconfig/node24` base
- Module resolution: `bundler`
- Module format: `preserve`

**Naming:**

- Constants: `SCREAMING_SNAKE_CASE` (e.g., `GET_STORY_URLS_TOOL_NAME`)
- Functions: `camelCase`
- Types: `PascalCase`

## Adding MCP Tools

### In addon package (`packages/addon-mcp`):

1. Create `src/tools/my-tool.ts`:

```typescript
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import z from 'zod';

export const MY_TOOL_NAME = 'my_tool';

export function registerMyTool({
	server,
	options,
}: {
	server: McpServer;
	options: Options;
}) {
	server.registerTool(
		MY_TOOL_NAME,
		{
			title: 'My Tool',
			description: 'What it does',
			inputSchema: z.object({ param: z.string() }),
		},
		async ({ param }, { sessionId }) => {
			// Implementation
			return {
				/* result */
			};
		},
	);
}
```

2. Register in `src/mcp-handler.ts` after existing tools

### In mcp package (`packages/mcp`):

1. Create `src/tools/my-tool.ts`:

```typescript
export async function addMyTool(server: McpServer<any, StorybookContext>) {
	server.tool({ name: 'my_tool', description: 'What it does' }, async () => ({
		content: [{ type: 'text', text: 'result' }],
	}));
}
```

2. Import and call in `src/index.ts` within `createStorybookMcpHandler`

## Integration Points

**Storybook internals used:**

- `storybook/internal/csf` - `storyNameFromExport()` for story name conversion
- `storybook/internal/types` - TypeScript types for Options, StoryIndex
- `storybook/internal/node-logger` - Logging utilities
- Framework detection via `options.presets.apply('framework')`

**Story URL generation:**

- Fetches `http://localhost:${port}/index.json` for story index
- Matches stories by `importPath` (relative from cwd) and `name`
- Returns URLs like `http://localhost:6006/?path=/story/button--primary`

**Telemetry:**

- Addon collects usage data (see `src/telemetry.ts`)
- Respects `disableTelemetry` from Storybook core config
- Tracks session initialization and tool usage

## Special Build Considerations

**JSON tree-shaking:**

- `packages/mcp/tsdown.config.ts` has custom plugin to work around rolldown bug
- Only includes specified package.json keys in bundle (name, version, description)
- If adding new package.json properties to code, update plugin

**Package exports:**

- Addon exports only `./preset` (Storybook convention)
- MCP package exports main module with types

## Release Process

Uses Changesets for versioning:

```bash
pnpm changeset       # Create a changeset for your changes
pnpm release         # Build and publish (CI handles this)
```

## Testing with Internal Storybook

The `apps/internal-storybook` provides a real Storybook instance:

- Runs on port 6006
- Addon MCP endpoint: `http://localhost:6006/mcp`
- Test with `.mcp.json` config pointing to localhost:6006

## Package-Specific Instructions

For detailed package-specific guidance, see:

- `packages/addon-mcp/**` → `.github/instructions/addon-mcp.instructions.md`
- `packages/mcp/**` → `.github/instructions/mcp.instructions.md`
