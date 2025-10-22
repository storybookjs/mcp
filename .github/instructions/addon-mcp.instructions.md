---
applyTo: 'packages/addon-mcp/**'
---

# Copilot Instructions for @storybook/addon-mcp

## Project Overview

This is a Storybook addon that runs an MCP (Model Context Protocol) server within Storybook's dev server to help AI agents develop UI components more efficiently. The addon exposes MCP tools via an HTTP endpoint at `/mcp` when Storybook is running.

## Architecture

### Key Components

- **MCP Server**: Built using `@modelcontextprotocol/sdk` with StreamableHTTP transport
- **Vite Plugin Middleware**: Workaround to inject `/mcp` endpoint into Storybook's dev server
- **Tools System**: Extensible tool registration for MCP capabilities
- **Session Management**: Per-client session tracking with unique session IDs
- **Telemetry**: Usage tracking with opt-out via Storybook's `disableTelemetry` config

### File Structure

```
src/
  preset.ts                        # Storybook preset - injects Vite middleware
  mcp-handler.ts                   # Main MCP server handler with session management
  telemetry.ts                     # Telemetry collection and tracking
  ui-building-instructions.md      # Template for agent UI development instructions
  tools/
    get-story-urls.ts              # Tool to retrieve story URLs from Storybook
    get-ui-building-instructions.ts # Tool to provide UI development guidelines
```

### Key Design Patterns

1. **Vite Plugin Workaround**: Uses `viteFinal` preset hook to inject middleware (Storybook has no native addon API for server middleware)
2. **Session-Based Transport**: Each MCP client gets a `StreamableHTTPServerTransport` instance keyed by session ID
3. **Tool Registration**: Tools are registered functions that accept `server` and `options` parameters
4. **Framework Detection**: Uses Storybook's preset system to detect framework and customize instructions

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

Builds the project using `tsup` (esbuild-based bundler). Output goes to `dist/` directory.

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

## Code Style and Conventions

### TypeScript Configuration

- Uses Storybook's TypeScript conventions
- Module system: ESM with `"type": "module"` in package.json
- Module resolution: `bundler` mode
- Imports from `storybook/internal/*` for Storybook APIs

### Code Style

- Use Prettier for formatting (inherited from root config)
- Prefer async/await over callbacks
- Export types and interfaces explicitly
- Use descriptive variable and function names
- **Always include file extensions in imports** (e.g., `import { foo } from './bar.ts'`, not `./bar`), except when importing packages

### Naming Conventions

- Constants: SCREAMING_SNAKE_CASE (e.g., `GET_STORY_URLS_TOOL_NAME`)
- Functions: camelCase (e.g., `registerStoryUrlsTool`, `mcpServerHandler`)
- Types/Interfaces: PascalCase (e.g., `Options`, `StoryIndex`)

## Important Files

### Configuration Files

- `package.json` - Project metadata, scripts, and Storybook addon configuration
- `tsconfig.json` - TypeScript configuration
- `tsup.config.ts` - Build tool configuration
- `preset.js` - Entry point for Storybook preset (points to compiled `dist/preset.js`)

### Source Files

- `src/preset.ts` - Storybook preset that injects Vite middleware
- `src/mcp-handler.ts` - Main MCP server handler with session management
- `src/telemetry.ts` - Telemetry tracking for usage analytics
- `src/tools/get-story-urls.ts` - Tool to fetch story URLs from index.json
- `src/tools/get-ui-building-instructions.ts` - Tool to provide framework-specific UI instructions
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
3. Export a registration function:

   ```typescript
   import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
   import type { Options } from 'storybook/internal/types';
   import z from 'zod';

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
   			description: 'What this tool does',
   			inputSchema: z.object({
   				param: z.string(),
   			}),
   		},
   		async ({ param }, { sessionId }) => {
   			// Tool implementation
   			return { result: 'value' };
   		},
   	);
   }
   ```

4. Import and register in `src/mcp-handler.ts` within `createMcpServer()`:

   ```typescript
   import { registerMyTool } from './tools/my-tool';

   // After existing tool registrations:
   registerMyTool({ server, options });
   ```

5. Add telemetry tracking if needed (see existing tools for examples)

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

This addon implements MCP using the official SDK:

- **Transport**: StreamableHTTP (`@modelcontextprotocol/sdk/server/streamableHttp.js`)
- **Session Management**: Each client gets a unique session ID via `randomUUID()`
- **Tool Schema**: Uses Zod for input/output schema validation
- **Lifecycle Hooks**: `onsessioninitialized` and `onclose` for session tracking

## Dependencies

### Runtime (Production)

- `@modelcontextprotocol/sdk` - Official MCP SDK for server implementation

### Development

- `storybook` - Peer dependency (Storybook framework)
- `zod` - Schema validation for tool inputs/outputs
- `ts-dedent` - Template string formatting
- `tsup` - Build tool (esbuild-based)
- `vite` - Peer dependency for middleware injection

## Telemetry

The addon collects anonymous usage data:

- Session initialization events
- Tool usage events (which tools are called and how often)
- Client information (MCP client name)

Telemetry respects Storybook's `disableTelemetry` config:

```typescript
const { disableTelemetry } = await options.presets.apply<CoreConfig>(
	'core',
	{},
);
```

Users can opt out by setting `disableTelemetry: true` in their Storybook config.

## Testing

The addon is tested manually using `apps/internal-storybook`:

1. Run `pnpm storybook` from root
2. Storybook starts on port 6006
3. MCP endpoint available at `http://localhost:6006/mcp`
4. Use MCP inspector or configure MCP client to connect

Currently no automated tests exist for this package.

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

## Documentation Resources

When working with the MCP SDK, refer to:

- https://github.com/modelcontextprotocol/typescript-sdk
- https://modelcontextprotocol.io/

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
