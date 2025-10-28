---
applyTo: 'packages/addon-mcp/**'
---

# Copilot Instructions for @storybook/addon-mcp

## Project Overview

This is a Storybook addon that runs an MCP (Model Context Protocol) server within Storybook's dev server to help AI agents develop UI components more efficiently. The addon exposes MCP tools via an HTTP endpoint at `/mcp` when Storybook is running.

## Architecture

### Key Components

- **MCP Server**: Built using `tmcp` library with HTTP transport
- **Vite Plugin Middleware**: Workaround to inject `/mcp` endpoint into Storybook's dev server
- **Tools System**: Extensible tool registration using `server.tool()` method
- **Toolsets Configuration**: Configurable tool groups that can be toggled via addon options or per-request headers
- **Context-Based Architecture**: AddonContext passed through to all tools containing Storybook options and runtime info
- **Schema Validation**: Uses Valibot for JSON schema validation via `@tmcp/adapter-valibot`
- **Telemetry**: Usage tracking with opt-out via Storybook's `disableTelemetry` config

### Toolsets

The addon supports two toolsets that can be enabled/disabled:

1. **`core`** (default: true)
   - `get-story-urls`: Retrieve story URLs from Storybook
   - `get-ui-building-instructions`: Provide UI development guidelines

2. **`componentDocumentation`** (default: true)
   - `list-all-components`: List all available components from manifest
   - `get-component-documentation`: Get detailed component documentation
   - Requires experimental feature flag `features.experimentalComponentsManifest`

**Configuration Methods:**

1. **Addon Options** (`.storybook/main.js`):

```typescript
{
	name: '@storybook/addon-mcp',
	options: {
		toolsets: {
			core: true,
			componentDocumentation: true,
		}
	}
}
```

2. **Per-Request Header** (`X-MCP-Toolsets`):
   - Comma-separated list of toolset names
   - Example: `X-MCP-Toolsets: core,componentDocumentation`
   - When present, overrides addon options (all toolsets default to disabled except those in header)
   - When absent, uses addon options

**Implementation:**

- `getToolsets()` function in `mcp-handler.ts` parses the header and merges with addon options
- Tools use `enabled` callback to check if their toolset is active:
  ```typescript
  server.tool(
  	{
  		name: 'my-tool',
  		enabled: () => server.ctx.custom?.toolsets?.core ?? true,
  	},
  	handler,
  );
  ```
- `AddonContext.toolsets` contains the resolved toolset configuration

### File Structure

```
src/
  preset.ts                        # Storybook preset - injects Vite middleware
  mcp-handler.ts                   # Main MCP server handler factory
  telemetry.ts                     # Telemetry collection and tracking
  types.ts                         # Valibot schemas and AddonContext type
  ui-building-instructions.md      # Template for agent UI development instructions
  tools/
    get-story-urls.ts              # Tool to retrieve story URLs from Storybook
    get-ui-building-instructions.ts # Tool to provide UI development guidelines
  utils/
    errors.ts                      # Error handling utilities
    fetch-story-index.ts           # Utility to fetch Storybook's index.json
```

### Key Design Patterns

1. **Vite Plugin Workaround**: Uses `viteFinal` preset hook to inject middleware (Storybook has no native addon API for server middleware)
2. **Factory Pattern**: `createAddonMcpHandler()` creates configured handler instances following the pattern from `@storybook/mcp`
3. **Context-Based Architecture**: AddonContext provides Storybook options, origin URL, and client info to all tools
4. **Tool Registration**: Tools are async functions that register with `server.tool()` and receive typed input
5. **Framework Detection**: Uses Storybook's preset system to detect framework and customize instructions

## Development Workflow

### Prerequisites

- Node.js 24+ (see root `.nvmrc`)
- pnpm 10.19.0+ (specified in root `packageManager` field)
- Running Storybook instance (uses `apps/internal-storybook` for testing)

### Setup

```bash
pnpm install
```

### Build

```bash
pnpm build
```

Builds the project using `tsdown` (rolldown-based bundler) with shared configuration from `../../tsdown-shared.config.ts`. Output goes to `dist/` directory.

### Development

```bash
pnpm dev
```

Runs the build in watch mode for hot reload during development.

To test the addon with Storybook:

```bash
pnpm storybook  # From root - starts internal-storybook with addon in dev mode
```

### Formatting

Use Prettier at the root level:

```bash
pnpm format  # From root
```

### Inspector Tool

```bash
pnpm inspect
```

Launches the MCP inspector for debugging the addon's MCP server using the configuration in `.mcp.inspect.json`.

### Testing

The addon has comprehensive unit tests covering all utilities and tools:

```bash
pnpm test          # Run tests in watch mode
pnpm test run      # Run tests once
pnpm test run --coverage  # Run tests with coverage report
```

**Test Infrastructure:**

- **Framework**: Vitest 3.2.4 with @vitest/coverage-v8
- **Fixtures**: JSON fixtures in `fixtures/` directory for story index data

**Test Coverage Baseline:**

- **Overall Target**: >70% statement coverage
- **src/utils**: 100% coverage (errors.ts, fetch-story-index.ts)
- **src/tools**: >90% coverage (get-story-urls.ts, get-ui-building-instructions.ts)
- **src**: Integration files (preset.ts, mcp-handler.ts, telemetry.ts) have partial coverage

**Key Testing Patterns:**

1. **Context Passing**: MCP server context must be passed per request, not at initialization:

   ```typescript
   const testContext = { options, origin, client };
   await server.receive(request, {
   	sessionId: 'test-session',
   	custom: testContext,
   });
   ```

2. **Tool Testing**: Mock external dependencies (fetch, logger, telemetry) and test tool logic:

   ```typescript
   vi.spyOn(global, 'fetch').mockResolvedValue(
   	new Response(JSON.stringify(fixture)),
   );
   const response = await server.receive(toolCallRequest, {
   	sessionId,
   	custom: context,
   });
   ```

3. **Conversion Utilities**: Test Node.js HTTP conversions with PassThrough streams:

   ```typescript
   const req = new PassThrough() as unknown as IncomingMessage;
   req.method = 'POST';
   req.end(JSON.stringify(body));
   ```

4. **Fixture-Based Testing**: Use JSON fixtures for consistent story index data across tests

**Adding New Tests:**

When adding new functionality:

1. Create corresponding `.test.ts` file alongside source
2. Follow existing test patterns (see `src/tools/*.test.ts` for examples)
3. Mock external dependencies (fetch, logger, telemetry)
4. Use fixtures for complex data structures
5. Test both success and error paths
6. Run `pnpm test run --coverage` to verify coverage

**CI Integration:**

Tests run automatically on PRs and main branch pushes via `.github/workflows/check.yml` as the `test-addon-mcp` job.

## Code Style and Conventions

### TypeScript Configuration

- Uses `bundler` module resolution with `preserve` module format
- Module system: ESM with `"type": "module"` in package.json
- Allows `.ts` file extensions in imports via `allowImportingTsExtensions`
- Imports from `storybook/internal/*` for Storybook APIs

### Code Style

- Use Prettier for formatting (inherited from root config)
- Prefer async/await over callbacks
- Export types and interfaces explicitly
- Use descriptive variable and function names
- **Always include file extensions in imports** (e.g., `import { foo } from './bar.ts'`, not `./bar`), except when importing packages

### Naming Conventions

- Constants: SCREAMING_SNAKE_CASE (e.g., `GET_STORY_URLS_TOOL_NAME`)
- Functions: camelCase (e.g., `addGetStoryUrlsTool`, `createAddonMcpHandler`)
- Types/Interfaces: PascalCase (e.g., `AddonContext`, `StoryInput`)

## Important Files

### Configuration Files

- `package.json` - Project metadata, scripts, and Storybook addon configuration
- `tsconfig.json` - TypeScript configuration
- `tsdown.config.ts` - Build tool configuration (extends shared config from monorepo root)
- `preset.js` - Entry point for Storybook preset (points to compiled `dist/preset.js`)

### Source Files

- `src/preset.ts` - Storybook preset that injects Vite middleware
- `src/mcp-handler.ts` - Main MCP server handler factory using tmcp
- `src/telemetry.ts` - Telemetry tracking for usage analytics
- `src/types.ts` - Valibot schemas and AddonContext interface
- `src/tools/get-story-urls.ts` - Tool to fetch story URLs from index.json
- `src/tools/get-ui-building-instructions.ts` - Tool to provide framework-specific UI instructions
- `src/utils/errors.ts` - Error handling utilities
- `src/utils/fetch-story-index.ts` - Utility to fetch Storybook's story index
- `src/ui-building-instructions.md` - Template for UI development instructions

### Build Artifacts

- `dist/` - Build output (gitignored, included in npm package)
- `preset.js` - Entry point that re-exports `dist/preset.js`

## Adding New Tools

To add a new MCP tool to the addon:

1. Create a new file in `src/tools/` (e.g., `src/tools/my-tool.ts`)
2. Export a constant for the tool name:
   ```typescript
   export const MY_TOOL_NAME = 'my_tool';
   ```
3. Define your input schema using Valibot:

   ```typescript
   import type { McpServer } from 'tmcp';
   import * as v from 'valibot';
   import type { AddonContext } from '../types.ts';
   import { errorToMCPContent } from '../utils/errors.ts';

   const MyToolInput = v.object({
   	param: v.string(),
   });

   type MyToolInput = v.InferOutput<typeof MyToolInput>;
   ```

4. Export an async registration function:

   ```typescript
   export async function addMyTool(server: McpServer<any, AddonContext>) {
   	server.tool(
   		{
   			name: MY_TOOL_NAME,
   			title: 'My Tool',
   			description: 'What this tool does',
   			schema: MyToolInput,
   			// Optional: Enable/disable based on toolset configuration
   			enabled: () => server.ctx.custom?.toolsets?.core ?? true,
   		},
   		async (input: MyToolInput) => {
   			try {
   				const { options, origin, client } = server.ctx.custom ?? {};

   				// Tool implementation
   				return {
   					content: [{ type: 'text' as const, text: 'result' }],
   				};
   			} catch (error) {
   				return errorToMCPContent(error);
   			}
   		},
   	);
   }
   ```

5. Import and register in `src/mcp-handler.ts` within `initializeMCPServer()`:

   ```typescript
   import { addMyTool } from './tools/my-tool.ts';

   // After existing tool registrations:
   await addMyTool(server);
   ```

6. If adding a new toolset, update the `AddonOptions` schema in `src/types.ts` to include the new toolset:

   ```typescript
   export const AddonOptions = v.object({
   	toolsets: v.optional(
   		v.object({
   			core: v.exactOptional(v.boolean(), true),
   			componentDocumentation: v.exactOptional(v.boolean(), true),
   			myNewToolset: v.exactOptional(v.boolean(), true), // Add your toolset
   		}),
   		{
   			core: true,
   			componentDocumentation: true,
   			myNewToolset: true,
   		},
   	),
   });
   ```

7. Add telemetry tracking if needed (see existing tools for examples)

## Storybook Integration

### Using Storybook Internal APIs

The addon uses several internal Storybook APIs:

- `storybook/internal/csf` - `storyNameFromExport()` converts export names to story names
- `storybook/internal/types` - TypeScript types for `Options`, `StoryIndex`, `CoreConfig`
- `storybook/internal/node-logger` - Server-side logging utilities

**Important**: These are internal APIs and may change between Storybook versions.

### Story Index Access

The addon fetches the story index at runtime:

```typescript
const index: StoryIndex = await fetch(
	`http://localhost:${port}/index.json`,
).then((r) => r.json());
```

Each story entry has:

- `id` - Story ID (e.g., `button--primary`)
- `importPath` - Relative path from cwd (e.g., `./stories/Button.stories.tsx`)
- `name` - Story name (e.g., `Primary`)

### Framework Detection

Framework detection uses Storybook's preset system:

```typescript
const frameworkPreset = await options.presets.apply('framework');
const framework =
	typeof frameworkPreset === 'string' ? frameworkPreset : frameworkPreset?.name;
```

## MCP Protocol

This addon implements MCP using `tmcp`:

- **Transport**: HTTP transport via `@tmcp/transport-http`
- **Schema Validation**: Uses Valibot via `@tmcp/adapter-valibot` for input/output schema validation
- **Context-Based**: AddonContext passed through to all tools containing Storybook options and runtime info
- **Tool Registration**: Tools are added using `server.tool()` method with schema definitions

## Dependencies

### Runtime (Production)

- `tmcp` - Core MCP server implementation
- `@tmcp/adapter-valibot` - Valibot schema adapter for MCP
- `@tmcp/transport-http` - HTTP transport for MCP
- `valibot` - Schema validation library

### Development

- `storybook` - Peer dependency (Storybook framework)
- `valibot` - Schema validation for tool inputs/outputs
- `ts-dedent` - Template string formatting
- `tsdown` - Build tool (rolldown-based)
- `vite` - Peer dependency for middleware injection

## Telemetry

The addon collects anonymous usage data:

- Session initialization events
- Tool usage events (which tools are called and how often)
- Client information (MCP client name)

**For addon-specific tools**: Telemetry is collected directly in the tool implementation using `collectTelemetry()`.

**For reused tools from `@storybook/mcp`**: The addon uses optional handlers (`onListAllComponents`, `onGetComponentDocumentation`) provided by the `StorybookContext` to track usage. These handlers are passed in the context when calling `transport.respond()` in `mcp-handler.ts`:

```typescript
const addonContext: AddonContext = {
	// ... other context properties
	onListAllComponents: async ({ manifest }) => {
		if (!disableTelemetry && server) {
			await collectTelemetry({
				event: 'tool:listAllComponents',
				server,
				componentCount: Object.keys(manifest.components).length,
			});
		}
	},
	onGetComponentDocumentation: async ({
		input,
		foundComponents,
		notFoundIds,
	}) => {
		if (!disableTelemetry && server) {
			await collectTelemetry({
				event: 'tool:getComponentDocumentation',
				server,
				inputComponentCount: input.componentIds.length,
				foundCount: foundComponents.length,
				notFoundCount: notFoundIds.length,
			});
		}
	},
};
```

Telemetry respects Storybook's `disableTelemetry` config:

```typescript
const { disableTelemetry } = await options.presets.apply<CoreConfig>(
	'core',
	{},
);
```

Users can opt out by setting `disableTelemetry: true` in their Storybook config.

## Testing

The addon has comprehensive unit tests for all utilities and tools:

### Running Tests

```bash
pnpm test           # Run in watch mode
pnpm test run       # Run once
pnpm test run --coverage  # With coverage report
```

### Test Files

- `src/utils/errors.test.ts` - Tests error handling utilities
- `src/utils/fetch-story-index.test.ts` - Tests story index fetching
- `src/tools/get-story-urls.test.ts` - Tests story URL resolution tool
- `src/tools/get-ui-building-instructions.test.ts` - Tests UI instructions tool
- `src/mcp-handler.test.ts` - Tests HTTP conversion utilities

### Integration Testing

Manual integration testing using `apps/internal-storybook`:

1. Run `pnpm storybook` from root
2. Storybook starts on port 6006
3. MCP endpoint available at `http://localhost:6006/mcp`
4. Use MCP inspector or configure MCP client to connect

### Coverage Expectations

- **Overall**: >70% statement coverage
- **Utils**: 100% coverage target
- **Tools**: >90% coverage target
- CI enforces test passes (coverage is tracked but not blocking)

## Release Process

The addon is released as part of the monorepo using Changesets:

```bash
pnpm changeset        # Create a changeset
pnpm release          # Build and publish to npm (from root)
```

Published to npm as `@storybook/addon-mcp`.

## Package Configuration

The addon follows Storybook's addon conventions:

```json
{
	"exports": {
		"./preset": "./dist/preset.js",
		"./package.json": "./package.json"
	},
	"storybook": {
		"displayName": "Addon MCP",
		"supportedFrameworks": [
			"react",
			"vue3",
			"angular",
			"web-components",
			"html",
			"svelte",
			"preact",
			"react-native"
		]
	}
}
```

The `preset.js` file at the root re-exports the compiled preset from `dist/`.

## Dependencies

### Runtime Dependencies

- `tmcp` - Core MCP server implementation
- `@tmcp/adapter-valibot` - Valibot schema adapter for MCP
- `@tmcp/transport-http` - HTTP transport for MCP
- `valibot` - Schema validation library

### Development Dependencies

- `tsdown` - Build tool (rolldown-based bundler, uses shared config from monorepo root)
- `typescript` - TypeScript compiler
- `vite` - Dev server (peer dependency via Storybook)
- `storybook` - Storybook core (peer dependency)

**Note**: This addon shares the same MCP architecture as `@storybook/mcp` package but is specifically designed to run within a Storybook dev server environment. The main difference is the integration layer - this addon uses Vite middleware while the standalone package provides a pure HTTP handler.

## Documentation Resources

When working with Storybook internals, refer to:

- https://github.com/storybookjs/storybook
- https://storybook.js.org/docs/

## Notes for AI Assistants

- The Vite middleware injection is a workaround - Storybook doesn't provide a native API for addons to add server routes
- Always test changes with `apps/internal-storybook` before publishing
- Session management is critical - don't break the session ID tracking or transports will leak
- When modifying `ui-building-instructions.md`, ensure template variables (`{{FRAMEWORK}}`, etc.) remain intact
- The addon has no automated tests - rely on manual testing with the inspector
- Follow Storybook addon conventions for package structure and exports
- The project uses ESM modules exclusively
- Build artifacts in `dist/` should not be committed to git
- When modifying package.json scripts, ensure they work with pnpm
