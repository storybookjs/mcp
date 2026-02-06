# M3: MCP Composition - Implementation Plan

## Overview

Enable `@storybook/addon-mcp` to include documentation from multiple Storybook sources (local + remote) via a single MCP server, reusing Storybook's existing composition API (`refs`).

**Scope:** Public and private (Chromatic-hosted) Storybooks. Auth is core, not deferred.

**Auth Plan:** See [m3-auth-plan.md](./m3-auth-plan.md) for detailed authentication implementation.

**Lead:** Kasper

---

## Problem

Currently, if you have a Storybook for your application and a separate Storybook for your Design System, you need to set both MCP servers up in your MCP client. The app MCP being available on localhost via `addon-mcp`, and the DS being available remotely with Chromatic.

Not only is this tedious to configure, but there's a risk of bad results:

- LLM can be confused about multiple, similar tools
- Won't call both when necessary
- More MCP servers bloat context unnecessarily

## Solution

Give `addon-mcp` the ability to include MCP docs from external sources, using Storybook's existing `refs` composition config. One MCP server, one set of tools, documentation for all sources.

---

## Phase 1: Core Types & Schema Changes

### 1.1 Add source types to `@storybook/mcp`

**File:** `packages/mcp/src/types.ts`

```typescript
export type Source = {
	id: string; // e.g., 'local', 'tetra'
	title: string; // e.g., 'Local', 'Tetra Design System'
	url?: string; // Remote URL (undefined = local)
};

export type SourcesConfig = Source[];

export type MultiSourceManifests = {
	sourceId: string;
	sourceTitle: string;
	manifests: AllManifests;
	error?: string; // Capture per-source errors
}[];
```

### 1.2 Update `GetDocumentationInput` schema

**File:** `packages/mcp/src/tools/get-documentation.ts`

```typescript
const GetDocumentationInput = v.object({
	id: v.string(),
	sourceId: v.optional(v.string(), 'local'), // Backwards compatible
});
```

### 1.3 Update `StorybookContext`

**File:** `packages/mcp/src/types.ts`

```typescript
export type StorybookContext = {
	// ... existing fields ...

	/**
	 * Multiple source configuration. When provided, tools operate
	 * in multi-source mode, grouping results by source.
	 */
	sources?: SourcesConfig;

	/**
	 * Provider for fetching manifests from a specific source.
	 */
	multiSourceManifestProvider?: (source: Source, path: string) => Promise<string>;
};
```

---

## Phase 2: Multi-Source Manifest Fetching

### 2.1 Add `getMultiSourceManifests` function

**File:** `packages/mcp/src/utils/get-manifest.ts`

```typescript
export async function getMultiSourceManifests(
  sources: SourcesConfig,
  provider: (source: Source, path: string) => Promise<string>,
): Promise<MultiSourceManifests> {
  const results = await Promise.allSettled(
    sources.map(async (source) => {
      try {
        const manifests = await getManifestsForSource(source, provider);
        return {
          sourceId: source.id,
          sourceTitle: source.title,
          manifests,
        };
      } catch (error) {
        // Graceful degradation - include error info
        return {
          sourceId: source.id,
          sourceTitle: source.title,
          manifests: { componentManifest: { v: 1, components: {} } },
          error: getErrorMessage(error),
        };
      }
    })
  );

  return results
    .filter((r): r is PromiseFulfilledResult<...> => r.status === 'fulfilled')
    .map(r => r.value);
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    // Detect auth errors and provide helpful message
    if (error.message.includes('401') || error.message.includes('403')) {
      return 'Authentication required. Private Storybooks are not yet supported in composition. Set up a separate MCP server for this Storybook.';
    }
    return error.message;
  }
  return String(error);
}
```

### 2.2 Add caching for remote manifests

**File:** `packages/mcp/src/utils/manifest-cache.ts` (new)

```typescript
type CacheEntry = {
	data: string;
	fetchedAt: number;
};

const cache = new Map<string, CacheEntry>();
const TTL_MS = 5 * 60 * 1000; // 5 minutes

export async function fetchWithCache(
	url: string,
	fetcher: () => Promise<Response>,
): Promise<Response> {
	const cached = cache.get(url);

	if (cached && Date.now() - cached.fetchedAt < TTL_MS) {
		return new Response(cached.data, { status: 200 });
	}

	const response = await fetcher();

	if (response.ok) {
		const text = await response.text();
		cache.set(url, { data: text, fetchedAt: Date.now() });
		return new Response(text, { status: 200 });
	}

	return response;
}

export function clearCache(): void {
	cache.clear();
}
```

---

## Phase 3: Update Tools for Multi-Source

### 3.1 Update `list-all-documentation` tool

**File:** `packages/mcp/src/tools/list-all-documentation.ts`

When `sources` is configured, output grouped by source:

```typescript
export async function addListAllDocumentationTool(
  server: McpServer<any, StorybookContext>,
  enabled?: ...,
) {
  server.tool(
    { name: LIST_TOOL_NAME, ... },
    async () => {
      const { sources, multiSourceManifestProvider } = server.ctx.custom ?? {};

      if (sources && multiSourceManifestProvider) {
        // Multi-source mode
        const multiManifests = await getMultiSourceManifests(
          sources,
          multiSourceManifestProvider,
        );
        const format = server.ctx.custom?.format ?? 'markdown';
        const lists = formatMultiSourceManifestsToLists(multiManifests, format);
        return { content: [{ type: 'text', text: lists }] };
      }

      // Single-source mode (existing behavior)
      // ...
    },
  );
}
```

**Output format:**

```markdown
# Local

source-id: local

## Components

- Page (page): A versatile page component

## Docs

- Getting Started (getting-started): Everything you need to know

---

# Tetra Design System

source-id: tetra

## Components

- Button (button): A versatile button component
- Card (card): A flexible container component

---

# Acme Components

source-id: acme
error: Authentication required. Private Storybooks are not yet supported...
```

### 3.2 Update `get-documentation` tool

**File:** `packages/mcp/src/tools/get-documentation.ts`

```typescript
const GetDocumentationInput = v.object({
  id: v.string(),
  sourceId: v.optional(v.string(), 'local'),
});

export async function addGetDocumentationTool(...) {
  server.tool(
    { name: GET_TOOL_NAME, schema: GetDocumentationInput, ... },
    async (input) => {
      const { sources, multiSourceManifestProvider } = server.ctx.custom ?? {};

      if (sources && multiSourceManifestProvider) {
        // Multi-source mode
        const source = sources.find(s => s.id === input.sourceId);
        if (!source) {
          return errorResult(`Unknown source: "${input.sourceId}". Use ${LIST_TOOL_NAME} to see available sources.`);
        }

        const manifests = await getManifestsForSource(source, multiSourceManifestProvider);
        // ... lookup component/doc in manifests
      }

      // Single-source mode (existing behavior, sourceId ignored)
      // ...
    },
  );
}
```

### 3.3 Update formatters

**File:** `packages/mcp/src/utils/manifest-formatter/markdown.ts`

```typescript
export function formatMultiSourceManifestsToLists(
	multiManifests: MultiSourceManifests,
	format: OutputFormat = 'markdown',
): string {
	return multiManifests
		.map(({ sourceId, sourceTitle, manifests, error }) => {
			const parts: string[] = [];
			parts.push(`# ${sourceTitle}`);
			parts.push(`source-id: ${sourceId}`);
			parts.push('');

			if (error) {
				parts.push(`error: ${error}`);
				return parts.join('\n');
			}

			// Format components and docs using existing logic
			parts.push(formatManifestsToLists(manifests, format));
			return parts.join('\n');
		})
		.join('\n\n---\n\n');
}
```

---

## Phase 4: Composition Config in addon-mcp

### 4.1 Read Storybook `refs` configuration

**File:** `packages/addon-mcp/src/composition.ts` (new)

```typescript
import type { Options } from 'storybook/internal/types';
import type { Source, SourcesConfig } from '@storybook/mcp';

type Ref = {
	title: string;
	url: string;
	expanded?: boolean;
	sourceUrl?: string;
};

type RefsConfig = Record<string, Ref>;
type RefsFn = (config: any, options: { configType: string }) => RefsConfig;

export async function getComposedSources(options: Options): Promise<SourcesConfig> {
	// refs can be an object or a function
	const refsInput = await options.presets.apply('refs', {});

	let refs: RefsConfig;
	if (typeof refsInput === 'function') {
		// For addon-mcp, we're always in development context
		refs = (refsInput as RefsFn)({}, { configType: 'DEVELOPMENT' });
	} else {
		refs = refsInput as RefsConfig;
	}

	const sources: SourcesConfig = [{ id: 'local', title: 'Local' }];

	for (const [id, ref] of Object.entries(refs)) {
		sources.push({
			id,
			title: ref.title || id,
			url: ref.url,
		});
	}

	return sources;
}
```

### 4.2 Create multi-source manifest provider

**File:** `packages/addon-mcp/src/utils/multi-source-provider.ts` (new)

```typescript
import type { Source } from '@storybook/mcp';
import { fetchWithCache } from '@storybook/mcp/manifest-cache';

export function createMultiSourceProvider(
	localOrigin: string,
): (source: Source, path: string) => Promise<string> {
	return async (source, path) => {
		const baseUrl = source.url || localOrigin;
		const normalizedPath = path.replace(/^\.\//, '/');
		const manifestUrl = new URL(normalizedPath, baseUrl).toString();

		const response = await fetchWithCache(manifestUrl, () => fetch(manifestUrl));

		if (!response.ok) {
			throw new Error(`Failed to fetch manifest: ${response.status} ${response.statusText}`);
		}

		return response.text();
	};
}
```

### 4.3 Update `mcpServerHandler`

**File:** `packages/addon-mcp/src/mcp-handler.ts`

```typescript
import { getComposedSources } from './composition.ts';
import { createMultiSourceProvider } from './utils/multi-source-provider.ts';

let sources: SourcesConfig | undefined;

const initializeMCPServer = async (options: Options) => {
	// ... existing init code ...

	// Get composed sources from refs config
	sources = await getComposedSources(options);

	if (sources.length > 1) {
		logger.info(
			`MCP composition enabled with ${sources.length} sources: ${sources.map((s) => s.id).join(', ')}`,
		);
	}

	// ... rest of init
};

export const mcpServerHandler = async ({ req, res, options, addonOptions }) => {
	// ... existing code ...

	const addonContext: AddonContext = {
		// ... existing fields ...

		// Multi-source support
		...(sources &&
			sources.length > 1 && {
				sources,
				multiSourceManifestProvider: createMultiSourceProvider(origin),
			}),
	};

	// ... rest of handler
};
```

---

## Phase 5: Preview Stories Tool Update

### 5.1 Add `sourceId` support

**File:** `packages/addon-mcp/src/tools/preview-stories.ts`

For remote sources, construct URLs from the source config:

```typescript
// In tool input schema
const PreviewStoriesInput = v.object({
	// ... existing fields ...
	sourceId: v.optional(v.string(), 'local'),
});

// In tool handler
function getPreviewUrl(
	sourceId: string,
	componentId: string,
	storyId: string,
	sources: SourcesConfig,
	localOrigin: string,
): string {
	const source = sources.find((s) => s.id === sourceId);
	const baseUrl = source?.url || localOrigin;
	return `${baseUrl}/?path=/story/${componentId}--${storyId}`;
}
```

### 5.2 Include story IDs in list-all output (optional enhancement)

```markdown
- Button (button): A versatile button...
  Stories: primary, secondary, disabled
```

This allows agents to construct preview URLs for remote components without needing file access.

---

## Phase 6: Testing

### 6.1 Unit tests

**New test files:**

- `packages/mcp/src/utils/get-manifest.test.ts` — add multi-source tests
- `packages/mcp/src/utils/manifest-cache.test.ts` — cache TTL, concurrent requests
- `packages/mcp/src/utils/manifest-formatter/markdown.test.ts` — multi-source formatting

**Test cases:**

- `getMultiSourceManifests` with all sources succeeding
- `getMultiSourceManifests` with one source failing (graceful degradation)
- `getMultiSourceManifests` with auth error (401/403 detection)
- `GetDocumentationInput` backwards compatibility (no sourceId = 'local')
- Cache TTL expiry and refresh
- Multi-source list formatting with errors

### 6.2 Integration tests

**File:** `apps/internal-storybook/tests/mcp-composition.e2e.test.ts` (new)

- Local-only (no refs) — existing behavior preserved
- Local + 1 public remote — both listed, both queryable
- Local + unavailable remote — graceful error in output
- Local + 401 remote — helpful error message

### 6.3 Eval: Agent uses multiple sources

**Scenario:**

1. Local Storybook has `Page`, `Layout` components
2. Remote (public) has `Button`, `Card`, `Input` from design system
3. Task: "Build a settings page using Button and Card from the design system"

**Expected behavior:**

1. Agent calls `list-all-documentation`
2. Agent sees both sources with their components
3. Agent calls `get-documentation` with `sourceId: 'tetra'` for Button
4. Agent calls `get-documentation` with `sourceId: 'tetra'` for Card
5. Agent builds the page using both

---

## Implementation Order

| Phase | Tasks                                                                |
| ----- | -------------------------------------------------------------------- |
| 1     | **Auth client** — OAuth flow, discovery, registration, token storage |
| 2     | Types & schemas in `@storybook/mcp`                                  |
| 3     | Multi-source fetching + cache (with auth integration)                |
| 4     | Update tools (list-all, get-documentation)                           |
| 5     | addon-mcp composition config (read refs, create provider)            |
| 6     | Preview stories sourceId support                                     |
| 7     | Tests + eval                                                         |

**Auth is Phase 1** — it's the foundation for private Storybook composition.

---

## Files Summary

**New files (auth):**

- `packages/addon-mcp/src/auth/types.ts`
- `packages/addon-mcp/src/auth/store.ts`
- `packages/addon-mcp/src/auth/oauth.ts`
- `packages/addon-mcp/src/auth/discovery.ts`
- `packages/addon-mcp/src/auth/registration.ts`
- `packages/addon-mcp/src/auth/index.ts`

**New files (composition):**

- `packages/mcp/src/utils/manifest-cache.ts`
- `packages/addon-mcp/src/composition.ts`
- `packages/addon-mcp/src/utils/multi-source-provider.ts`
- `apps/internal-storybook/tests/mcp-composition.e2e.test.ts`

**Modified files:**

- `packages/mcp/src/types.ts`
- `packages/mcp/src/tools/list-all-documentation.ts`
- `packages/mcp/src/tools/get-documentation.ts`
- `packages/mcp/src/utils/get-manifest.ts`
- `packages/mcp/src/utils/format-manifest.ts`
- `packages/mcp/src/utils/manifest-formatter/markdown.ts`
- `packages/addon-mcp/src/mcp-handler.ts`
- `packages/addon-mcp/src/types.ts`
- `packages/addon-mcp/src/tools/preview-stories.ts`
- `packages/addon-mcp/package.json` (add `open` dependency)

---

## Authentication

Authentication for private Chromatic Storybooks is **in scope** and a priority.

Chromatic's authenticated MCP server is already deployed. addon-mcp needs to implement the OAuth client side to authenticate when composing private Storybooks.

**See [m3-auth-plan.md](./m3-auth-plan.md) for full auth implementation details.**

Summary:

- Detect 401 from private Chromatic Storybook
- Discover auth server via RFC 9728
- Dynamic Client Registration (RFC 7591) — no pre-registration needed
- OAuth 2.1 flow with PKCE, browser redirect
- Token storage in `~/.storybook/mcp-auth/tokens.json`

---

## Open Questions

1. **ID conflicts:** If both local and remote have `button`, they're disambiguated by `sourceId`. Sufficient?

2. **Cache invalidation:** 5-minute TTL reasonable? Should we expose config option?

3. **Error verbosity:** How much detail to show in list-all when a source fails?

4. **Story IDs in list-all:** Worth the extra output size for enabling remote preview URLs?

---

## References

- [Storybook Composition Docs](https://storybook.js.org/docs/sharing/storybook-composition)
- [MCP Authorization Spec](https://modelcontextprotocol.io/specification/draft/basic/authorization)
- [CIMD Specification](https://datatracker.ietf.org/doc/html/draft-ietf-oauth-client-id-metadata-document-00)
