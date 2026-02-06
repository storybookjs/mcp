# MCP Composition: Private Storybooks

## Problem

Developers with multiple Storybooks (local app + remote Design System) must configure separate MCP servers. This confuses AI agents and bloats context.

**Solution:** addon-mcp reads Storybook's `refs` config and fetches manifests from all sources, combining them into one MCP endpoint.

## Key Principle

Works with **any host implementing CIMD** (the OAuth standard MCP uses) — not just Chromatic.

Requirement: `/manifests/components.json` returns `401` with `WWW-Authenticate: Bearer resource_metadata=".../.well-known/oauth-protected-resource"` for unauthenticated requests.

## Configuration

```typescript
// .storybook/main.ts
export default {
	refs: {
		'design-system': {
			title: 'Design System',
			url: 'https://design-system--abc123.chromatic.com',
		},
	},
};
```

| Scenario                                        | Works?      |
| ----------------------------------------------- | ----------- |
| Public Storybooks                               | ✅          |
| Private Storybooks with CIMD                    | ✅          |
| Multiple private refs (same OAuth server)       | ✅          |
| Multiple private refs (different OAuth servers) | ❓ Untested |

**Multiple private refs:** User authenticates once. Token is user-scoped, so one token covers all Storybooks on the same OAuth server.

## Auth Flow

We **delegate auth to the MCP client** (VS Code) instead of implementing OAuth ourselves.

```
STARTUP
1. addon-mcp reads refs, fetches manifest → gets 401
2. addon-mcp discovers OAuth server from remote's .well-known
3. addon-mcp stores auth requirement

CLIENT CONNECTS
4. VS Code calls addon-mcp → gets 401
5. VS Code fetches addon-mcp's .well-known (which proxies remote's OAuth info)
6. VS Code does OAuth with remote's server, gets token
7. VS Code retries with token
8. addon-mcp uses token to fetch remote manifests, combines with local
```

**Why proxy .well-known?** MCP spec requires the `WWW-Authenticate` header to point to the server's own `.well-known`. VS Code authenticates with "addon-mcp" without knowing about Chromatic.

## Chromatic Requirements

**PR:** [Header-based client detection](https://github.com/chromaui/chromatic/pull/10764)

Currently `/manifests/*.json` returns `{"loginUrl":"..."}` (legacy format). PR changes this to return `401 + WWW-Authenticate` for programmatic clients, enabling direct OAuth discovery.

## Hosting Provider Requirements

1. `401 + WWW-Authenticate` on manifest endpoints
2. `/.well-known/oauth-protected-resource` with OAuth server info
3. OAuth server with `/.well-known/oauth-authorization-server`
4. CIMD support (dynamic client registration)

HTTP localhost is fine — RFC 8252 allows it for native apps.

## Open Question

Can MCP clients handle multiple OAuth providers? We only serve one `.well-known`, so mixing providers (e.g., Chromatic + enterprise OAuth) may not work. Needs testing.
