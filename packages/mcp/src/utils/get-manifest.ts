import {
	ComponentManifestMap,
	DocsManifestMap,
	type AllManifests,
	type Source,
	type SourceManifestFailure,
	type SourceManifests,
} from '../types.ts';
import {
	formatSourceManifestFailureDetail,
	formatSourceManifestFailureSummary,
} from './manifest-formatter/source-errors.ts';
import * as v from 'valibot';

/**
 * The paths to the manifest files relative to the Storybook build
 */
export const COMPONENT_MANIFEST_PATH = './manifests/components.json';
export const DOCS_MANIFEST_PATH = './manifests/docs.json';

/**
 * Error thrown when getting or parsing a manifest fails
 */
export class ManifestGetError extends Error {
	public readonly url: string;
	public override readonly cause?: Error;

	constructor(message: string, url?: string, cause?: Error) {
		super(message);
		this.name = 'ManifestGetError';
		this.url = url ?? 'No source URL provided';
		this.cause = cause;
	}
}

export class SourceManifestError extends Error {
	public readonly failure: SourceManifestFailure;
	public readonly source?: Source;

	constructor(failure: SourceManifestFailure, source?: Source) {
		super(formatSourceManifestFailureSummary(failure));
		this.name = 'SourceManifestError';
		this.failure = failure;
		this.source = source;
	}
}

/**
 * MCP tool result type for text responses
 */
type MCPTextResult = {
	content: Array<{ type: 'text'; text: string }>;
	isError?: true;
};

const sourceManifestErrorToMCPContent = (error: SourceManifestError): MCPTextResult => {
	switch (error.failure.kind) {
		case 'requires-own-mcp':
			return {
				content: [
					{
						type: 'text',
						text: formatSourceManifestFailureDetail(error.failure, error.source),
					},
				],
			};
		case 'fetch-failed':
			return {
				content: [
					{
						type: 'text',
						text: formatSourceManifestFailureDetail(error.failure, error.source),
					},
				],
				isError: true,
			};
		default:
			return assertNever(error.failure);
	}
};

/**
 * Converts an error to MCP-compatible content format.
 *
 * Source-level private-auth failures return guidance content without `isError`;
 * all other failures return error content with `isError`.
 *
 * @param error - The error to convert (can be any type)
 * @returns A tool result with guidance or error content
 */
export const errorToMCPContent = (error: unknown): MCPTextResult => {
	if (error instanceof SourceManifestError) {
		return sourceManifestErrorToMCPContent(error);
	}

	const errorPrefix =
		error instanceof ManifestGetError ? 'Error getting manifest' : 'Unexpected error';
	const errorMessage = error instanceof Error ? error.message : String(error);

	// Include cause information if available
	let fullMessage = `${errorPrefix}: ${errorMessage}`;
	if (error instanceof ManifestGetError && error.cause) {
		const causeMessage = error.cause instanceof Error ? error.cause.message : String(error.cause);
		fullMessage += `\nCaused by: ${causeMessage}`;
	}

	return {
		content: [
			{
				type: 'text',
				text: fullMessage,
			},
		],
		isError: true,
	};
};

/**
 * Parses a JSON string and validates it against a Valibot schema
 */
function parseManifest<T extends v.BaseSchema<unknown, unknown, v.BaseIssue<unknown>>>({
	jsonString,
	schema,
	name,
	url,
}: {
	jsonString: string;
	schema: T;
	name: string;
	url: string;
}): v.InferOutput<T> {
	try {
		return v.parse(v.pipe(v.string(), v.parseJson(), schema), jsonString);
	} catch (error) {
		throw new ManifestGetError(
			`Failed to parse ${name} manifest:
${error instanceof v.ValiError ? error.issues.map((i) => i.message).join('\n') : String(error)}`,
			url,
		);
	}
}

/**
 * Gets component and docs manifest from a request or using a custom provider
 *
 * @param request - The HTTP request to get the manifest for (optional when using custom manifestProvider)
 * @param manifestProvider - Optional custom function to get the manifest
 * @param source - Optional source for multi-source mode
 * @returns A promise that resolves to the parsed ComponentManifestMap
 * @throws {ManifestGetError} If getting the manifest fails or the response is invalid
 */
export async function getManifests(
	request?: Request,
	manifestProvider?: (
		request: Request | undefined,
		path: string,
		source?: Source,
	) => Promise<string>,
	source?: Source,
): Promise<AllManifests> {
	const provider = manifestProvider ?? defaultManifestProvider;

	// Fetch both component and docs manifests in parallel
	const [componentResult, docsResult] = await Promise.allSettled([
		provider(request, COMPONENT_MANIFEST_PATH, source),
		provider(request, DOCS_MANIFEST_PATH, source),
	]);

	const getUrl = (path: string) =>
		request ? getManifestUrlFromRequest(request, path) : 'Unknown manifest source';

	if (componentResult.status === 'rejected') {
		const reason = componentResult.reason;
		if (reason instanceof SourceManifestError) {
			throw reason;
		}
		const is404 = reason instanceof ManifestGetError && reason.message.includes('404');
		const hint = is404
			? `\nHint: The Storybook at this URL may not have the component manifest enabled. Add \`features: { componentsManifest: true }\` (or \`features: { experimentalComponentsManifest: true }\` for older Storybook versions) to its main.ts config.`
			: '';
		throw new ManifestGetError(
			`Failed to get component manifest: ${reason instanceof Error ? reason.message : String(reason)}${hint}`,
			getUrl(COMPONENT_MANIFEST_PATH),
			reason instanceof Error ? reason : undefined,
		);
	}

	const componentManifest = parseManifest({
		jsonString: componentResult.value,
		schema: ComponentManifestMap,
		name: 'component',
		url: getUrl(COMPONENT_MANIFEST_PATH),
	});

	if (Object.keys(componentManifest.components).length === 0) {
		throw new ManifestGetError(
			`No components found in the manifest`,
			getUrl(COMPONENT_MANIFEST_PATH),
		);
	}

	if (docsResult.status === 'rejected') {
		return { componentManifest };
	}

	// Handle docs manifest result (optional - only exists when addon-docs is used)
	const docsManifest = parseManifest({
		jsonString: docsResult.value,
		schema: DocsManifestMap,
		name: 'docs',
		url: getUrl(DOCS_MANIFEST_PATH),
	});

	return { componentManifest, docsManifest };
}

/**
 * Constructs the manifest URL from a request by replacing /mcp with the provided path
 */
function getManifestUrlFromRequest(request: Request, path: string): string {
	const url = new URL(request.url);
	// Replace /mcp endpoint with the provided path (e.g., './manifests/components.json')
	// Remove leading './' from path if present
	const normalizedPath = path.replace(/^\.\//, '');
	url.pathname = url.pathname.replace(/\/mcp\/?$/, `/${normalizedPath}`);
	return url.toString();
}

/**
 * Default manifest provider that fetches from the same origin as the request,
 * replacing /mcp with the provided path
 */
async function defaultManifestProvider(
	request: Request | undefined,
	path: string,
): Promise<string> {
	if (!request) {
		throw new ManifestGetError(
			"Request is required when using the default manifest provider. You must either pass the original request forward to the server context, or set a custom manifestProvider that doesn't need the request.",
		);
	}
	const manifestUrl = getManifestUrlFromRequest(request, path);
	const response = await fetch(manifestUrl);

	if (!response.ok) {
		throw new ManifestGetError(
			`Failed to fetch manifest: ${response.status} ${response.statusText}`,
			manifestUrl,
		);
	}

	const contentType = response.headers.get('content-type');
	if (!contentType?.includes('application/json')) {
		throw new ManifestGetError(
			`Invalid content type: expected application/json, got ${contentType}`,
			manifestUrl,
		);
	}
	return response.text();
}

/**
 * Gets manifests from multiple sources.
 * Returns an array of source manifests, each containing the source info and its manifests.
 * Failures for individual sources are captured as errors rather than failing the entire request.
 *
 * @param sources - Array of source configurations
 * @param request - The HTTP request (used for local source)
 * @param manifestProvider - Function to fetch manifests, receives source as third parameter
 * @returns Promise resolving to array of source manifests
 * @throws {ManifestGetError} If no sources could be fetched successfully
 */
export async function getMultiSourceManifests(
	sources: Source[],
	request?: Request,
	manifestProvider?: (
		request: Request | undefined,
		path: string,
		source?: Source,
	) => Promise<string>,
): Promise<SourceManifests[]> {
	// Fetch all sources in parallel
	const results = await Promise.all(
		sources.map(async (source) => {
			try {
				const manifests = await getManifests(request, manifestProvider, source);
				return {
					kind: 'manifest',
					source,
					componentManifest: manifests.componentManifest,
					docsManifest: manifests.docsManifest,
				} satisfies SourceManifests;
			} catch (error) {
				// Capture error but don't fail the entire request
				return {
					kind: 'error',
					source,
					error: sourceManifestFailureFromError(error),
				} satisfies SourceManifests;
			}
		}),
	);

	// Check if at least one source can produce useful tool output.
	const hasDisplayableResult = results.some(
		(result) => result.kind === 'manifest' || result.error.kind === 'requires-own-mcp',
	);
	if (!hasDisplayableResult) {
		throw new ManifestGetError(
			`Failed to fetch manifests from any source. Errors:\n${results.map((r) => `- ${r.source.title}: ${r.kind === 'error' ? formatSourceManifestFailureSummary(r.error) : 'unknown error'}`).join('\n')}`,
		);
	}

	return results;
}

function sourceManifestFailureFromError(error: unknown): SourceManifestFailure {
	if (error instanceof SourceManifestError) {
		return error.failure;
	}

	return {
		kind: 'fetch-failed',
		message: error instanceof Error ? error.message : String(error),
	};
}

function assertNever(value: never): never {
	throw new Error(`Unhandled source manifest failure: ${JSON.stringify(value)}`);
}
