/**
 * Auth module for handling OAuth with composed Storybooks.
 */

export {
	CompositionAuth,
	AuthenticationError,
	STORYBOOK_MCP_PROXY_HEADER,
	STORYBOOK_MCP_PROXY_HEADER_VALUE,
	extractBearerToken,
	isStorybookMcpProxyRequest,
	type ComposedRef,
	type ManifestProvider,
} from './composition-auth.ts';
