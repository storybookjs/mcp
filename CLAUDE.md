# CLAUDE.md

## Project Overview

Monorepo for the Storybook MCP server and addon. Two published packages:

- **`@storybook/mcp`** (`packages/mcp`) — Standalone MCP server that serves component documentation from Storybook manifests. Can run via stdio or HTTP.
- **`@storybook/addon-mcp`** (`packages/addon-mcp`) — Storybook addon that runs the MCP server in-process inside the Storybook dev server.

And one internal app:

- **`apps/internal-storybook`** — Test Storybook with three configs: single-source (`.storybook`), composition (`.storybook-composition`), and composition with OAuth (`.storybook-composition-auth`). E2E tests live here.

**Both packages use `tmcp`** with HTTP transport and Valibot schema validation for consistent APIs.

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

### Addon Architecture

The addon uses a **Vite plugin workaround** to inject middleware (see `packages/addon-mcp/src/preset.ts`):

- Storybook doesn't expose an API for addons to register server middleware
- Solution: Inject a Vite plugin via `viteFinal` that adds `/mcp` endpoint
- Handler in `mcp-handler.ts` creates MCP servers using `tmcp` with HTTP transport

**Toolset Configuration:**

The addon supports configuring which toolsets are enabled:

- **Addon Options**: Configure default toolsets in `.storybook/main.js`:
  ```typescript
  {
    name: '@storybook/addon-mcp',
    options: {
      toolsets: {
        dev: true,
        docs: true,
      },
      experimentalFormat: 'markdown'  // Output format: 'markdown' (default) or 'xml'
    }
  }
  ```
- **Per-Request Override**: MCP clients can override toolsets per-request using the `X-MCP-Toolsets` header:
  - Header format: comma-separated list (e.g., `dev,docs`)
  - When header is present, only specified toolsets are enabled (others are disabled)
  - When header is absent, addon options are used
- **Tool Enablement**: Tools use the `enabled` callback to check if their toolset is active:
  ```typescript
  server.tool(
  	{
  		name: 'my-tool',
  		enabled: () => server.ctx.custom?.toolsets?.dev ?? true,
  	},
  	handler,
  );
  ```

### MCP Library Architecture

The `@storybook/mcp` package (in `packages/mcp`) is framework-agnostic:

- Factory pattern: `createStorybookMcpHandler()` returns a request handler
- Context-based: handlers accept `StorybookContext` which includes the HTTP `Request` object and optional callbacks
- **Exports tools and types** for reuse by `addon-mcp` and other consumers
- **Request-based manifest loading**: The `request` property in context is passed to tools, which use it to determine the manifest URL (defaults to same origin, replacing `/mcp` with the manifest path)
- **Optional manifestProvider**: Custom function `(request: Request, path: string) => Promise<string>` to override default manifest fetching
- **Optional handlers**: `onSessionInitialize`, `onListAllDocumentation`, `onGetDocumentation` for tracking/telemetry
- **Output Format**: `'markdown'` (default) or `'xml'`, configurable via addon options or `StorybookContext.format`

## Tech Stack

- **MCP protocol**: `tmcp` with `@tmcp/adapter-valibot` and `@tmcp/transport-http`
- **Schema validation**: `valibot` (use `v.object()`, `v.pipe()`, `v.parse()`)
- **Build**: `turbo` (monorepo orchestration) + `tsdown` (bundler)
- **Test**: `vitest` with multi-project config (each package is a vitest project)
- **Lint**: `oxlint` (type-aware)
- **Format**: `oxfmt`
- **Storybook**: v10

**Prerequisites:** Node.js **24+** (`.nvmrc`), pnpm **10.19.0+** (`packageManager` in root `package.json`)

## Commands

```sh
turbo run build                     # Build all packages (dependency order)
turbo run typecheck                 # TypeScript check
turbo run test                      # All tests in watch mode (unit + e2e, builds deps first)
turbo run test:run                  # All tests once
turbo run dev                       # Dev mode for all packages
turbo watch storybook               # Start internal Storybook with rebuild on change
pnpm check                          # Full CI: build, format, lint, publint, typecheck, test:run
pnpm lint                           # oxlint
pnpm format                         # oxfmt
pnpm inspect                        # Launch MCP inspector using .mcp.inspect.json config
```

## Code Style

- **ESM-only** — all packages have `"type": "module"`. Always include `.ts` extensions in relative imports.
- **Naming** — constants: `SCREAMING_SNAKE_CASE`, functions: `camelCase`, types: `PascalCase`.
- **JSON imports** — `import pkg from '../package.json' with { type: 'json' };`
- **TypeScript** — strict mode, `@tsconfig/node24` base, `bundler` module resolution, `preserve` module format.
- **Formatting** — run `pnpm format` (oxfmt) before committing. CI enforces this.

## Testing

- Use `toMatchInlineSnapshot()` for assertions where possible. Inline snapshots show the full response shape and catch regressions better than individual field checks.
- E2E tests (`apps/internal-storybook/tests/`) start real Storybook servers and take 30+ seconds. Run `turbo run build` first so the addon dist is up to date.
- Unit tests and e2e tests are separate vitest projects. `turbo run test` runs all of them, including e2e.
- Prefer TDD when adding new tools.
- **When to update E2E tests**: adding/modifying MCP tools, changing protocol implementation, modifying tool responses/schemas, adding toolsets.

## Adding MCP Tools

### In addon package (`packages/addon-mcp`):

**Option 1: Addon-specific tools** (for tools that require Storybook addon context):

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

2. Import and call in `src/mcp-handler.ts` within `initializeMCPServer`

**Option 2: Reuse tools from `@storybook/mcp`** (for component manifest features):

1. Import the tool from `@storybook/mcp` in `src/mcp-handler.ts`:

```typescript
import { addMyTool, MY_TOOL_NAME } from '@storybook/mcp';
```

2. Call it conditionally based on feature flags (see component manifest tools example)
3. Ensure `AddonContext` extends `StorybookContext` for compatibility
4. Pass the `source` URL in context for manifest-based tools

### In mcp package (`packages/mcp`):

1. Create `src/tools/my-tool.ts`:

```typescript
export const MY_TOOL_NAME = 'my-tool';

export async function addMyTool(server: McpServer<any, StorybookContext>) {
	server.tool({ name: MY_TOOL_NAME, description: 'What it does' }, async () => ({
		content: [{ type: 'text', text: 'result' }],
	}));
}
```

2. Import and call in `src/index.ts` within `createStorybookMcpHandler`

3. **Export for reuse** in `src/index.ts`:

```typescript
export { addMyTool, MY_TOOL_NAME } from './tools/my-tool.ts';
```

## Integration Points

**Tool Reuse Between Packages:**

- `addon-mcp` depends on `@storybook/mcp` (workspace dependency)
- `AddonContext` extends `StorybookContext` to ensure type compatibility
- Component manifest tools are conditionally registered based on feature flags:
  - Checks `features.experimentalComponentsManifest` flag
  - Checks for `experimental_manifests` preset
  - Only registers `addListAllDocumentationTool` and `addGetDocumentationTool` when enabled
- Context includes `request` (HTTP Request object) which tools use to determine manifest location
- Default manifest URL is constructed from request origin, replacing `/mcp` with `/manifests/components.json`
- **Optional handlers for tracking**:
  - `onSessionInitialize`: Called when an MCP session is initialized, receives context
  - `onListAllDocumentation`: Called when list tool is invoked, receives context and manifest
  - `onGetDocumentation`: Called when get tool is invoked, receives context, input with id, and optional foundDocumentation
  - Addon-mcp uses these handlers to collect telemetry on tool usage

**Storybook internals used:**

- `storybook/internal/csf` - `storyNameFromExport()` for story name conversion
- `storybook/internal/types` - TypeScript types for Options, StoryIndex
- `storybook/internal/node-logger` - Logging utilities
- Framework detection via `options.presets.apply('framework')`
- Feature flags via `options.presets.apply('features')`
- Component manifest generator via `options.presets.apply('experimental_manifests')`

**Telemetry:**

- Addon collects usage data (see `src/telemetry.ts`)
- Respects `disableTelemetry` from Storybook core config
- Tracks session initialization and tool usage

## Special Build Considerations

- `tsdown-shared.config.ts` at monorepo root contains shared build settings
- Targets Node 20.19 (minimum version supported by Storybook 10)
- Includes custom JSON tree-shaking plugin to work around rolldown bug (see [rolldown#6614](https://github.com/rolldown/rolldown/issues/6614))
- If adding new package.json properties to code, update the `jsonTreeShakePlugin` keys array in shared config
- **Package exports**: Addon exports only `./preset` (Storybook convention), MCP package exports main module with types

## Changesets

User-facing changes to `@storybook/mcp` or `@storybook/addon-mcp` require a changeset in `.changeset/`. Use `patch` for fixes, `minor` for features, `major` for breaking changes. Only include packages with actual user-facing changes.

## Testing with Internal Storybook

The `apps/internal-storybook` provides a real Storybook instance:

- Runs on port 6006
- Addon MCP endpoint: `http://localhost:6006/mcp`
- Test with `.mcp.json` config pointing to localhost:6006

## Documentation Resources

When working with MCP server/tools:

- https://github.com/paoloricciuti/tmcp/tree/main/packages/tmcp
- https://github.com/paoloricciuti/tmcp/tree/main/packages/transport-http

When working on data validation:

- https://valibot.dev/
- https://github.com/paoloricciuti/tmcp/tree/main/packages/adapter-valibot

When working with MCP Apps and/or `preview-stories.ts`:

- https://raw.githubusercontent.com/modelcontextprotocol/ext-apps/refs/heads/main/specification/draft/apps.mdx
