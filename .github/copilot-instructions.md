# Copilot Instructions for Storybook MCP Addon

## Architecture Overview

This is a **pnpm monorepo** with two MCP implementations:

- **`packages/addon-mcp`**: Storybook addon using `tmcp`, exposes MCP server at `/mcp` via Vite middleware
- **`packages/mcp`**: Standalone MCP library using `tmcp`, reusable outside Storybook
- **`apps/internal-storybook`**: Test environment for addon integration

**Both packages use `tmcp`** with HTTP transport and Valibot schema validation for consistent APIs.

### Addon Architecture

The addon uses a **Vite plugin workaround** to inject middleware (see `packages/addon-mcp/src/preset.ts`):

- Storybook doesn't expose an API for addons to register server middleware
- Solution: Inject a Vite plugin via `viteFinal` that adds `/mcp` endpoint
- Handler in `mcp-handler.ts` creates MCP servers using `tmcp` with HTTP transport

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

**Build tools:**

- All packages use `tsdown` (rolldown-based bundler)
- Shared configuration in `tsdown-shared.config.ts` at monorepo root
- Individual packages extend shared config in their `tsdown.config.ts`

**Testing:**

- Only `packages/mcp` has tests (Vitest with coverage)
- Run `pnpm test run --coverage` in mcp package
- Prefer TDD when adding new tools

**Type checking:**

- All packages have TypeScript strict mode enabled
- Run `pnpm typecheck` at root to check all packages
- Run `pnpm typecheck` in individual packages for focused checking
- CI enforces type checking on all PRs
- Type checking uses `tsc --noEmit` (no build artifacts, just validation)

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
import type { McpServer } from 'tmcp';
import * as v from 'valibot';
import type { AddonContext } from '../types.ts';

export const MY_TOOL_NAME = 'my_tool';

const MyToolInput = v.object({
	param: v.string(),
});

type MyToolInput = v.InferOutput<typeof MyToolInput>;

export async function addMyTool(server: McpServer<any, AddonContext>) {
	server.tool(
		{
			name: MY_TOOL_NAME,
			title: 'My Tool',
			description: 'What it does',
			schema: MyToolInput,
		},
		async (input: MyToolInput) => {
			// Implementation
			return {
				content: [{ type: 'text', text: 'result' }],
			};
		},
	);
}
```

2. Import and call in `src/mcp-handler.ts` within `createAddonMcpHandler`

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

**Shared tsdown configuration:**

- `tsdown-shared.config.ts` at monorepo root contains shared build settings
- Targets Node 20.19 (minimum version supported by Storybook 10)
- Includes custom JSON tree-shaking plugin to work around rolldown bug (see [rolldown#6614](https://github.com/rolldown/rolldown/issues/6614))
- Only includes specified package.json keys in bundle (name, version, description)
- If adding new package.json properties to code, update the `jsonTreeShakePlugin` keys array in shared config
- Individual packages extend this config and specify their entry points

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

## Documentation resources

When working with the MCP server/tools related stuff, refer to the following resources:

- https://github.com/paoloricciuti/tmcp/tree/main/packages/tmcp
- https://github.com/paoloricciuti/tmcp/tree/main/packages/transport-http
- https://github.com/paoloricciuti/tmcp

When working on data validation, refer to the following resources:

- https://valibot.dev/
- https://github.com/paoloricciuti/tmcp/tree/main/packages/adapter-valibot
