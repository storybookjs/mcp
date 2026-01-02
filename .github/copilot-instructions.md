# Copilot Instructions for Storybook MCP Addon

## Architecture Overview

This is a **pnpm monorepo** with two MCP implementations:

- **`packages/addon-mcp`**: Storybook addon using `tmcp`, exposes MCP server at `/mcp` via Vite middleware
  - Provides addon-specific tools (story URLs, UI building instructions)
  - **Imports and reuses tools from `@storybook/mcp` package** for component manifest features
  - Extends `StorybookContext` with addon-specific configuration (`AddonContext`)
- **`packages/mcp`**: Standalone MCP library using `tmcp`, reusable outside Storybook
  - Provides reusable component manifest tools (list components, get documentation)
  - Exports tools and types for consumption by addon-mcp
- **`apps/internal-storybook`**: Test environment for addon integration

**Both packages use `tmcp`** with HTTP transport and Valibot schema validation for consistent APIs.

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
        dev: true,      // get-story-urls, get-storybook-story-instructions
        docs: true,  // list-all-components, get-component-documentation
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
- **Context-Aware**: The `getToolsets()` function in `mcp-handler.ts` parses the header and returns enabled toolsets, which are passed to tools via `AddonContext.toolsets`

### MCP Library Architecture

The `@storybook/mcp` package (in `packages/mcp`) is framework-agnostic:

- Uses `tmcp` with HTTP transport and Valibot schema validation
- Factory pattern: `createStorybookMcpHandler()` returns a request handler
- Context-based: handlers accept `StorybookContext` which includes the HTTP `Request` object and optional callbacks
- **Exports tools and types** for reuse by `addon-mcp` and other consumers
- **Request-based manifest loading**: The `request` property in context is passed to tools, which use it to determine the manifest URL (defaults to same origin, replacing `/mcp` with the manifest path)
- **Optional manifestProvider**: Custom function to override default manifest fetching behavior
  - Signature: `(request: Request, path: string) => Promise<string>`
  - Receives the `Request` object and a `path` parameter (currently always `'./manifests/components.json'`)
  - The provider determines the base URL (e.g., mapping to S3 buckets) while the MCP server handles the path
  - Returns the manifest JSON as a string
- **Optional handlers**: `StorybookContext` supports optional handlers that are called at various points, allowing consumers to track usage or collect telemetry:
  - `onSessionInitialize`: Called when an MCP session is initialized
  - `onListAllComponents`: Called when the list-all-components tool is invoked
  - `onGetComponentDocumentation`: Called when the get-component-documentation tool is invoked
- **Output Format**: The `format` property in context controls output format:
  - `'markdown'` (default): Token-efficient markdown with adaptive formatting
  - `'xml'`: Legacy XML format
  - Format is configurable via addon options or directly in `StorybookContext`
  - Formatters are implemented in `packages/mcp/src/utils/manifest-formatter/` with separate files for XML and markdown

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

- **Unit tests**: Both `packages/mcp` and `packages/addon-mcp` have unit tests (Vitest with coverage)
  - Run `pnpm test run --coverage` in individual package directories
  - Run `pnpm test:run` at root to run all unit tests
  - Prefer TDD when adding new tools
- **E2E tests**: `apps/internal-storybook/tests` contains E2E tests for the addon
  - Run `pnpm test` in `apps/internal-storybook` directory
  - Tests verify MCP endpoint works with latest Storybook prereleases
  - Uses inline snapshots for response validation
  - **When to update E2E tests**:
    - Adding or modifying MCP tools (update tool discovery snapshots)
    - Changing MCP protocol implementation (update session init tests)
    - Modifying tool responses or schemas (update tool-specific tests)
    - Adding new toolsets or changing toolset behavior (update filtering tests)
  - **Running tests**:
    - `pnpm test` in apps/internal-storybook - run E2E tests
    - `pnpm vitest run -u` - update snapshots when responses change
    - Tests start Storybook server automatically, wait for MCP endpoint, then run
  - **Test structure**:
    - `mcp-endpoint.e2e.test.ts` - MCP protocol and tool tests
    - `check-deps.e2e.test.ts` - Storybook version validation

**Formatting and checks (CRITICAL):**

- **ALWAYS format code after making changes**: Run `pnpm run format` before committing
- **ALWAYS run checks after formatting**: Run `pnpm run check` to ensure all checks pass
- **Fix any failing checks**: Analyze check results and fix issues until all checks pass
- **This is mandatory for every commit** - formatting checks will fail in CI if not done
- The workflow is:
  1. Make your code changes
  2. Run `pnpm run format` to format all files
  3. Run `pnpm run check` to verify all checks pass
  4. Fix any failing checks and repeat step 3 until all pass
  5. Commit your changes

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
	server.tool(
		{ name: MY_TOOL_NAME, description: 'What it does' },
		async () => ({
			content: [{ type: 'text', text: 'result' }],
		}),
	);
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
  - Checks for `experimental_componentManifestGenerator` preset
  - Only registers `addListAllComponentsTool` and `addGetComponentDocumentationTool` when enabled
- Context includes `request` (HTTP Request object) which tools use to determine manifest location
- Default manifest URL is constructed from request origin, replacing `/mcp` with `/manifests/components.json`
- **Optional handlers for tracking**:
  - `onSessionInitialize`: Called when an MCP session is initialized, receives context
  - `onListAllComponents`: Called when list tool is invoked, receives context and manifest
  - `onGetComponentDocumentation`: Called when get tool is invoked, receives context, input with componentId, and optional foundComponent
  - Addon-mcp uses these handlers to collect telemetry on tool usage

**Storybook internals used:**

- `storybook/internal/csf` - `storyNameFromExport()` for story name conversion
- `storybook/internal/types` - TypeScript types for Options, StoryIndex
- `storybook/internal/node-logger` - Logging utilities
- Framework detection via `options.presets.apply('framework')`
- Feature flags via `options.presets.apply('features')`
- Component manifest generator via `options.presets.apply('experimental_componentManifestGenerator')`

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

**Creating Changesets (MANDATORY for user-facing changes):**

When making changes to `@storybook/mcp` or `@storybook/addon-mcp` that affect users (bug fixes, features, breaking changes, dependency updates), you **MUST** create a changeset:

1. Create a new `.md` file in `.changeset/` directory
2. Use naming convention: `<random-word>-<random-word>-<random-word>.md` (e.g., `brave-wolves-swim.md`)
3. File format:

   ```markdown
   ---
   '@storybook/mcp': patch
   '@storybook/addon-mcp': patch
   ---

   Brief description of what changed

   More details about why the change was made and any migration notes if needed.
   ```

4. Version bump types:
   - `patch`: Bug fixes, security updates, dependency updates (non-breaking)
   - `minor`: New features (backward compatible)
   - `major`: Breaking changes

5. Include in changeset description:
   - **WHAT** the change is
   - **WHY** the change was made
   - **HOW** consumers should update their code (if applicable)

6. Only include packages that have actual user-facing changes (ignore internal packages like `@storybook/mcp-internal-storybook`)

## Testing with Internal Storybook

The `apps/internal-storybook` provides a real Storybook instance:

- Runs on port 6006
- Addon MCP endpoint: `http://localhost:6006/mcp`
- Test with `.mcp.json` config pointing to localhost:6006

## Package-Specific Instructions

For detailed package-specific guidance, see:

- `packages/addon-mcp/**` → `.github/instructions/addon-mcp.instructions.md`
- `packages/mcp/**` → `.github/instructions/mcp.instructions.md`
- `eval/**` → `.github/instructions/eval.instructions.md`

## Documentation resources

When working with the MCP server/tools related stuff, refer to the following resources:

- https://github.com/paoloricciuti/tmcp/tree/main/packages/tmcp
- https://github.com/paoloricciuti/tmcp/tree/main/packages/transport-http
- https://github.com/paoloricciuti/tmcp

When working on data validation, refer to the following resources:

- https://valibot.dev/
- https://github.com/paoloricciuti/tmcp/tree/main/packages/adapter-valibot
