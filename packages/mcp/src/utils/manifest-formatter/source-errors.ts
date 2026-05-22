import type { Source, SourceManifestFailure } from '../../types.ts';

type RequiresOwnMcpFailure = Extract<SourceManifestFailure, { kind: 'requires-own-mcp' }>;

export function formatSourceManifestFailureDetail(
	failure: SourceManifestFailure,
	source?: Source,
): string {
	switch (failure.kind) {
		case 'requires-own-mcp':
			return `# ${source?.title ?? 'Private Storybook'}

${formatRequiresOwnMcpMessage(failure)}

To access documentation from this source, register or use its MCP endpoint:
${failure.endpoint}`;
		case 'fetch-failed':
			return `Error getting manifest: ${failure.message}`;
		default:
			return assertNeverSourceFailure(failure);
	}
}

export function formatSourceManifestFailureSummary(failure: SourceManifestFailure): string {
	switch (failure.kind) {
		case 'requires-own-mcp':
			return `${formatRequiresOwnMcpMessage(failure)} Use its MCP endpoint: ${failure.endpoint}`;
		case 'fetch-failed':
			return `error: ${failure.message}`;
		default:
			return assertNeverSourceFailure(failure);
	}
}

function formatRequiresOwnMcpMessage(failure: RequiresOwnMcpFailure): string {
	switch (failure.authProvider) {
		case 'chromatic':
			return 'This composed Storybook is private and requires Chromatic authentication.';
		case 'unknown':
			return 'This composed Storybook requires authentication.';
		default:
			return assertNeverAuthProvider(failure.authProvider);
	}
}

function assertNeverSourceFailure(value: never): never {
	throw new Error(`Unhandled source manifest failure: ${JSON.stringify(value)}`);
}

function assertNeverAuthProvider(value: never): never {
	throw new Error(`Unhandled source auth provider: ${JSON.stringify(value)}`);
}
