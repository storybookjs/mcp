# M3: Composition Authentication Plan

## Summary

addon-mcp needs to fetch manifests from private Chromatic Storybooks. This document describes how authentication works and what addon-mcp needs to implement.

**Key Finding:** The OAuth token obtained via the `/mcp` endpoint also grants access to `/manifests/*.json` files.

**Scope:** Chromatic-only for MVP. The `.well-known` format only supports a single auth server, so mixing Chromatic + other OAuth providers isn't feasible with Tom's delegation approach. Non-Chromatic private Storybooks can be added later via manual token config.

---

## How Chromatic Auth Works (Verified)

### Endpoint Behavior

| Endpoint | Without Token | With Token |
|----------|--------------|------------|
| `/mcp` | 401 + OAuth headers | 200 |
| `/manifests/*.json` | 302 redirect | 200 |
| `/manifests/*.json` + `Accept: application/json` | 200 + `{"loginUrl":"..."}` | 200 |
| `/index.html` | 302 redirect | 200 |

**Detection strategy:** When fetching manifest with `Accept: application/json`:
- If response contains `{"loginUrl": ...}` → needs auth, use `/mcp` for OAuth discovery
- If response contains actual manifest data → no auth needed

### OAuth Discovery

The `/mcp` endpoint returns proper OAuth metadata:

```
GET /mcp
→ 401 Unauthorized
→ WWW-Authenticate: Bearer resource_metadata=".../.well-known/oauth-protected-resource"
```

Resource metadata (`.well-known/oauth-protected-resource`):
```json
{
  "resource": "https://xxx.chromatic.com/mcp",
  "authorization_servers": ["https://www.chromatic.com"],
  "scopes_supported": ["storybook:read", "project:read"]
}
```

Auth server metadata (`/.well-known/oauth-authorization-server`):
```json
{
  "issuer": "https://www.chromatic.com",
  "authorization_endpoint": "https://www.chromatic.com/authorize",
  "token_endpoint": "https://www.chromatic.com/token",
  "client_id_metadata_document_supported": true,
  "code_challenge_methods_supported": ["S256"],
  "grant_types_supported": ["authorization_code", "refresh_token"]
}
```

### Token Scope (Verified)

Chromatic tokens are **user-scoped**, not project-scoped:
- JWT payload has `userId` but no project ID
- One token works across ALL Storybooks you have access to
- 404 on manifests just means MCP not enabled for that Storybook

```
Token from project A:
- Project A /index.html → 200 ✓
- Project B /index.html → 200 ✓
- Project C /index.html → 200 ✓
```

---

## Recommended Approach: Delegate to MCP Client (Tom's Approach)

Tom's flow (Jan 12th):

```
Session init: MCP Client -> Composing MCP server ("Server")

1. Server (addon-mcp) tries to fetch all manifests via GET to the CDN
2. A private manifest returns 302 (redirect)
3. Server checks for .well-known/oauth-protected-resource JSON ON CHROMATIC
   (or hardcode assuming it's chromatic)
   → This tells the server where the OAuth server is
4. Server 401s back to client with a WWW-Authenticate header
5. Server serves its OWN .well-known/oauth-protected-resource
   (pointing to Chromatic's OAuth server it discovered in step 3)
6. Client (VS Code) fetches addon-mcp's .well-known/oauth-protected-resource
   and proceeds to login at Chromatic's OAuth server, ends up with a token
7. Client tries to session init again, passing token on Authenticate header
8. Server fetches manifest again, this time passing the token to Chromatic
```

**Key insight:** addon-mcp acts as a **proxy**:
- It **discovers** auth requirements from Chromatic's `.well-known` (step 3)
- It **exposes** those requirements as its own `.well-known` (step 5)
- VS Code's built-in MCP auth handles the OAuth flow with Chromatic
- Token flows: Chromatic → VS Code → addon-mcp → Chromatic (to fetch manifests)

**Why this approach:**
- No OAuth implementation in addon-mcp (VS Code handles it)
- Uses standard MCP auth flow
- Cleaner architecture
- Token caching handled by VS Code

**Limitation (from Tom):**
> "Given the formats afaik only allow supplying a single auth server that implies the union of 'all auth servers' has to be a single one - ie all chromatic or all something else."

This is why we scope to Chromatic-only for MVP.

**Status:** ✅ Prototype implemented (see Implementation section below). Ready for testing.

---

## Configuration: Getting Chromatic URLs

addon-mcp reads composed Storybook URLs from the `refs` config in `.storybook/main.ts`:

```typescript
// .storybook/main.ts
const config: StorybookConfig = {
  framework: '@storybook/react-vite',
  stories: ['../src/**/*.stories  .@(js|jsx|ts|tsx)'],
  refs: {
    'design-system': {
      title: 'Design System',
      url: 'https://next--635781f3500dd2c49e189caf.chromatic.com',
    },
    'component-lib': {
      title: 'Component Library',
      url: 'https://main--66b1e47012f95c6f90c8882e.chromatic.com',
    },
  },
};
```

addon-mcp will:
1. Read `refs` from Storybook config
2. Try to fetch manifests from each URL
3. For any that need auth:
   - If **401 + `WWW-Authenticate`** → use that for OAuth discovery (preferred)
   - If **302** (redirect, no OAuth info) → fall back to `/mcp` endpoint for discovery
4. Use **first** auth-requiring URL to trigger OAuth (token is user-scoped, works for all)
5. Fetch all manifests with the token
6. Combine with local manifests

**Note:** This works for any hosting provider that implements MCP auth:
- Ideally: manifest endpoint returns 401 + `WWW-Authenticate` header
- Fallback: `/mcp` endpoint returns 401 + `WWW-Authenticate` header
- Has `.well-known/oauth-protected-resource` discovery
- Has OAuth server with `.well-known/oauth-authorization-server`

**Current Chromatic behavior:** Manifests return 302 (redirect), so we use `/mcp` fallback. Ideally manifests would return 401 directly.

**Limitation:** All private refs must use the **same OAuth server** (can't mix providers).

See: https://storybook.js.org/docs/sharing/storybook-composition

---

## Implementation (Prototype Complete ✅)

### Flow

```
1. Storybook starts
   ↓
2. Read refs from .storybook/main.ts config
   ↓
3. For each ref, check auth requirement:
   - Fetch manifest with Accept: application/json
   - If {"loginUrl": ...} → needs auth
   - Hit /mcp to discover OAuth metadata
   ↓
4. Store first OAuth requirement in state
   (one token works for all - user-scoped)
   ↓
5. MCP client connects to addon-mcp /mcp
   ↓
6. addon-mcp returns 401 + WWW-Authenticate header
   pointing to /.well-known/oauth-protected-resource
   ↓
7. MCP client fetches addon-mcp's .well-known
   (which proxies Chromatic's OAuth server info)
   ↓
8. MCP client does OAuth with Chromatic
   ↓
9. MCP client retries /mcp with Bearer token
   ↓
10. addon-mcp uses token to fetch remote manifests
    ↓
11. Manifests are combined and served to MCP client
```

### Files Created

| File | Purpose |
|------|---------|
| `packages/addon-mcp/src/auth/index.ts` | Exports |
| `packages/addon-mcp/src/auth/discovery.ts` | Discover OAuth from remote `/mcp` endpoint |
| `packages/addon-mcp/src/auth/state.ts` | Auth state management, `.well-known` builders |
| `packages/addon-mcp/src/auth/composition.ts` | Multi-source manifest fetching |

### Files Modified

| File | Changes |
|------|---------|
| `packages/addon-mcp/src/preset.ts` | Added `/.well-known/oauth-protected-resource` endpoint, 401 handling, refs reading |
| `packages/addon-mcp/src/mcp-handler.ts` | Accept `manifestProvider` parameter |

### Key Code

**`preset.ts` - .well-known endpoint:**
```typescript
app.get('/.well-known/oauth-protected-resource', (_req, res) => {
  const authState = getAuthState();
  if (!authState.requiresAuth) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }
  const resourceMetadata = buildOAuthProtectedResource(origin);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(resourceMetadata));
});
```

**`preset.ts` - 401 response:**
```typescript
app.post('/mcp', (req, res) => {
  // Check for token
  const authHeader = req.headers['authorization'];
  if (authHeader?.startsWith('Bearer ')) {
    setToken(authHeader.slice(7));
  }

  // Return 401 if auth needed and no token
  const authState = getAuthState();
  if (authState.requiresAuth && !authState.token) {
    res.writeHead(401, {
      'WWW-Authenticate': buildWwwAuthenticateHeader(origin),
    });
    res.end('401 - Unauthorized');
    return;
  }

  return mcpServerHandler({ ..., manifestProvider: composedManifestProvider });
});
```

**`discovery.ts` - OAuth discovery:**
```typescript
async function discoverOAuthFromMcp(manifestUrl: string): Promise<AuthRequirement | null> {
  const url = new URL(manifestUrl);
  url.pathname = '/mcp';

  const response = await fetch(url.toString());
  if (response.status !== 401) return null;

  const wwwAuth = response.headers.get('WWW-Authenticate');
  // Parse resource_metadata URL from header
  // Fetch .well-known/oauth-protected-resource
  // Fetch .well-known/oauth-authorization-server
  return { resourceMetadataUrl, resourceMetadata, serverMetadata };
}
```

### Status

✅ **Prototype builds successfully** - Ready for testing with a real Storybook + Chromatic setup.

**Next steps:**
1. Test with a local Storybook that has `refs` pointing to private Chromatic
2. Verify VS Code MCP client handles the 401 → OAuth flow
3. Verify token is passed back and manifests are fetched
4. Test combined manifest output

---

## Verified Findings

1. **Redirect URI:** ✅ Dynamic ports work (tested with port 33418)

2. **Token cross-project:** ✅ One token works for all Storybooks user has access to

3. **Static files use 302:** Manifests and index.html return 302 (redirect), only `/mcp` returns 401

---

## Questions / Suggestions for Armando

### Suggestion: Use `Sec-Fetch-*` headers instead of URL-based detection

Currently, only `/mcp` returns 401 + `WWW-Authenticate` (hardcoded URL check). A cleaner approach would be to distinguish browser vs programmatic clients using standard headers:

```javascript
// Current (URL-based):
if (request.uri.match(/^\/mcp\/?$/)) {
  return { kind: MCP_REQUEST, isVersioned };
}

// Suggested (header-based):
const isBrowserNavigation =
  request.headers['sec-fetch-mode'] === 'navigate' ||
  request.headers['accept']?.includes('text/html');

if (isBrowserNavigation) {
  return 302 redirect;  // Browser goes to login page
} else {
  return 401 + WWW-Authenticate;  // API clients get OAuth discovery
}
```

This way ALL endpoints (including `/manifests/*.json`) would return proper 401 + OAuth headers for programmatic clients, without hardcoding URLs.

**Standards:**
- `Sec-Fetch-Mode: navigate` - browser navigation (modern browsers send this automatically)
- `Sec-Fetch-Dest: document` - browser wants HTML
- RFC 6750 (OAuth Bearer Token) - servers SHOULD return 401 for API clients

### Questions

1. **Is the `{"loginUrl": ...}` response intentional?**
   With `Accept: application/json`, manifest returns `{"loginUrl":"..."}`. Was this meant as an interim API solution? The header-based approach above would be more standard.

2. **Redirect URI ports:** We verified dynamic localhost ports work (tested 33418). Is any `http://127.0.0.1:*` port allowed, or is there a whitelist?

---

## Sidenote: Direct OAuth (for future multi-provider support)

If we ever need to support multiple private providers (not just Chromatic), addon-mcp would need to implement OAuth directly instead of delegating to VS Code. This would involve:

- Hosting CIMD client metadata at `https://storybook.js.org/addon-mcp/oauth-client.json`
- Implementing PKCE flow with local callback server
- Token storage in `~/.storybook/mcp-auth/tokens.json`
- Multiple sequential OAuth flows for different providers

This approach is more complex but doesn't have the single-auth-server limitation. See git history for full code examples if needed.
