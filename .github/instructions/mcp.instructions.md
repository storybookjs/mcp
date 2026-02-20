---
applyTo: 'packages/mcp/**'
---

# Copilot Instructions for @storybook/mcp

## Project Overview

This is a Model Context Protocol (MCP) server for Storybook that serves knowledge about components based on Storybook stories and documentation. The project is built with TypeScript and provides an HTTP transport endpoint for MCP communication.

## Architecture

### Key Components

- **MCP Server**: Built using the `tmcp` library with HTTP transport
- **Tools System**: Extensible tool registration system with optional handlers for tracking tool usage
- **Component Manifest**: Parses and formats component documentation including React prop information from react-docgen
- **Schema Validation**: Uses Valibot for JSON schema validation via `@tmcp/adapter-valibot`
- **HTTP Transport**: Provides HTTP-based MCP communication via `@tmcp/transport-http`
- **Context System**: `StorybookContext` allows passing optional handlers (`onSessionInitialize`, `onListAllDocumentation`, `onGetDocumentation`) that are called at various points when provided. The `onGetDocumentation` handler receives a single `id` input and an optional `foundDocumentation` result.

### File Structure

```
src/
  index.ts          # Main entry point - exports createStorybookMcpHandler
  serve.ts          # Development server setup
  tools/
    list-all-documentation.ts              # List all documentation tool
    get-documentation.ts      # Get component documentation tool
  utils/
    manifest-formatter/markdown.ts      # Format component/docs manifests to markdown
    parse-react-docgen.ts              # Parse react-docgen output
    get-manifest.ts                    # Fetch and validate manifest
    dedent.ts                          # Template string dedentation
    error-to-mcp-content.test.ts       # Error formatting utilities
  types.ts          # TypeScript types and Valibot schemas
```

### Key Design Patterns

1. **Factory Pattern**: `createStorybookMcpHandler()` creates configured handler instances
2. **Tool Registration**: Tools are added to the server using `server.tool()` method
3. **Async Handler**: Returns a Promise-based request handler compatible with standard HTTP servers
4. **Request-based Context**: The `Request` object is passed through context to tools, which use it to construct the manifest URL

### Manifest Provider API

The handler accepts a `StorybookContext` with the following key properties:

- **`request`**: The HTTP `Request` object being processed (automatically passed by the handler)
- **`manifestProvider`**: Optional custom function `(request: Request, path: string) => Promise<string>` to override default manifest fetching
  - **Parameters**:
    - `request`: The HTTP `Request` object to determine base URL, headers, routing, etc.
    - `path`: The manifest path (currently always `'./manifests/components.json'`)
  - **Responsibility**: The provider determines the "first part" of the URL (base URL/origin) by examining the request. The MCP server provides the path.
  - Default behavior: Constructs URL from request origin, replacing `/mcp` with the provided path
  - Return value should be the manifest JSON as a string

**Example with custom manifestProvider (local filesystem):**

```typescript
import { createStorybookMcpHandler } from '@storybook/mcp';
import { readFile } from 'node:fs/promises';

const handler = await createStorybookMcpHandler({
	manifestProvider: async (request, path) => {
		// Custom logic: read from local filesystem
		// The provider decides on the base path, MCP provides the manifest path
		const basePath = '/path/to/manifests';
		// Remove leading './' from path if present
		const normalizedPath = path.replace(/^\.\//, '');
		const fullPath = `${basePath}/${normalizedPath}`;
		return await readFile(fullPath, 'utf-8');
	},
});
```

**Example with custom manifestProvider (S3 bucket mapping):**

```typescript
import { createStorybookMcpHandler } from '@storybook/mcp';

const handler = await createStorybookMcpHandler({
	manifestProvider: async (request, path) => {
		// Map requests to different S3 buckets based on hostname
		const url = new URL(request.url);
		const bucket = url.hostname.includes('staging')
			? 'staging-bucket'
			: 'prod-bucket';
		const normalizedPath = path.replace(/^\.\, '');
		const manifestUrl = `https://${bucket}.s3.amazonaws.com/${normalizedPath}`;
		const response = await fetch(manifestUrl);
		return await response.text();
	},
});
```

### Component Manifest and ReactDocgen Support

Component manifests can include a `reactDocgen` property containing prop information parsed by [react-docgen](https://github.com/reactjs/react-docgen). This library analyzes React components to extract prop types, descriptions, default values, and other metadata.

**How it works:**

1. **Input**: A component manifest may include a `reactDocgen` field containing the raw output from react-docgen's `Documentation` type
2. **Parsing**: The `parseReactDocgen()` utility in `src/utils/parse-react-docgen.ts` converts the react-docgen output into a simplified structure:
   - Extracts prop names
   - Serializes TypeScript types into readable strings (handles unions, intersections, functions, objects, etc.)
   - Includes optional fields: `description`, `type`, `defaultValue`, `required`
3. **Formatting**: The markdown formatter in `src/utils/manifest-formatter/markdown.ts` generates markdown output for components, docs, and props (including a `## Props` section when `reactDocgen` is present)
4. **Output**: Props are rendered in markdown as TypeScript-like declarations inside fenced code blocks, including optional description/default metadata when available.

**Type serialization examples:**

- Unions: `"primary" | "secondary"`
- Functions: `(event: MouseEvent) => void`
- Objects: `{ name: string; age?: number }`
- Arrays: `string[]`
- Generics: `Promise<Data>`

All optional fields (`description`, `type`, `defaultValue`, `required`) are only included in the output when they have defined values.

## Development Workflow

### Prerequisites

- Node.js 24+ (see `.nvmrc`)
- pnpm 10.18.3+ (specified in `packageManager` field)

### Setup

```bash
pnpm install
```

### Build

```bash
pnpm build
```

Builds the project using `tsdown` (rolldown-based bundler). Output goes to `dist/` directory.

### Development

```bash
pnpm dev
```

Runs the development server with hot reload using Node's `--watch` flag.

### Formatting

```bash
pnpm format
```

Formats code using oxfmt.

To check formatting without applying changes:

```bash
pnpm format:check
```

### Testing

Tests can be run at the package level or from the monorepo root:

```bash
# From the package directory
pnpm test          # Run tests in watch mode
pnpm test run      # Run tests once
pnpm test run --coverage  # Run tests with coverage

# From the monorepo root (runs tests across all packages)
pnpm test          # Run all tests in watch mode
pnpm test:run      # Run all tests once
pnpm test:ci       # Run tests with coverage and CI reporters
```

**Important**: Vitest automatically clears all mocks between tests, so you should never need to call `vi.clearAllMocks()` in a `beforeEach` hook.

### Inspector Tool

```bash
pnpm inspect
```

Launches the MCP inspector for debugging the MCP server using the configuration in `.mcp.json`.

## Code Style and Conventions

### TypeScript Configuration

- Uses `@tsconfig/node24` and `@tsconfig/node-ts` as base configs
- Module system: ESM with `"type": "module"` in package.json
- Module resolution: `bundler` mode
- Module format: `preserve`

### Code Style

- Use oxfmt for formatting (config: `.oxfmtrc.json`)
- Prefer async/await over callbacks
- Export types and interfaces explicitly
- Use descriptive variable and function names
- **Always include file extensions in imports** (e.g., `import { foo } from './bar.ts'`, not `./bar`), except when importing packages.

### Naming Conventions

- Constants: SCREAMING_SNAKE_CASE (e.g., `LIST_TOOL_NAME`)
- Functions: camelCase (e.g., `createStorybookMcpHandler`, `addListTool`)
- Types/Interfaces: PascalCase (e.g., `StorybookMcpHandlerOptions`, `Handler`)

## Important Files

### Configuration Files

- `package.json` - Project metadata and scripts
- `tsconfig.json` - TypeScript configuration
- `tsdown.config.ts` - Build tool configuration
- `.mcp.json` - MCP inspector configuration
- `.nvmrc` - Node version specification

### Source Files

- `src/index.ts` - Main library entry point (exported API)
- `src/tools/list.ts` - Tool definitions
- `serve.ts` - Development server (not included in distribution)

### Build Artifacts

- `dist/` - Build output (gitignored, included in npm package)
- `pnpm-lock.yaml` - Dependency lock file

## Adding New Tools

To add a new MCP tool:

1. Create a new file in `src/tools/` (e.g., `src/tools/my-tool.ts`)
2. Export a constant for the tool name
3. Export an async function that adds the tool to the server:

   ```typescript
   export async function addMyTool(server: McpServer<any, StorybookContext>) {
   	server.tool(
   		{
   			name: 'my_tool_name',
   			description: 'Tool description',
   		},
   		async () => {
   			// Tool implementation
   			const result = 'result';

   			// Call optional handler if provided
   			await server.ctx.custom?.onMyTool?.({
   				context: server.ctx.custom,
   				// ... any relevant data
   			});

   			return {
   				content: [{ type: 'text', text: result }],
   			};
   		},
   	);
   }
   ```

4. Import and call the function in `src/index.ts` in the `createStorybookMcpHandler` function
5. If adding an optional handler:
   - Add the handler type to `StorybookContext` in `src/types.ts`
   - Document what parameters the handler receives
   - Export the handler type from `src/index.ts` if it should be usable by consumers

## MCP Protocol

This server implements the Model Context Protocol (MCP) specification:

- **Transport**: HTTP-based transport
- **Capabilities**: Supports dynamic tool listing (`tools: { listChanged: true }`)
- **Schema Validation**: Uses Valibot for request/response validation

## Dependencies

### Runtime (Production)

None - this is a library with peer/dev dependencies only.

### Development

- `tmcp` - MCP server implementation
- `@tmcp/adapter-valibot` - Valibot schema adapter for MCP
- `@tmcp/transport-http` - HTTP transport for MCP
- `valibot` - Schema validation
- `srvx` - HTTP server for development
- `tsdown` - Build tool
- `typescript` - TypeScript compiler

## Release Process

The project uses Changesets for version management:

```bash
pnpm changeset        # Create a changeset
pnpm release          # Build and publish to npm
```

Releases are automated via GitHub Actions (see `.github/workflows/release.yml`).

## Notes for AI Assistants

- Prefer test-driven development when possible, and continously use test coverage to verify test quality
- When adding features, prefer minimal changes to existing code
- Follow the established patterns for tool registration
- Use TypeScript types from the `tmcp` package
- Ensure all exports are properly typed
- Update this file when making significant architectural changes
- The project uses ESM modules exclusively
- Build artifacts in `dist/` should not be committed to git
- When modifying package.json scripts, ensure they work with pnpm
