import { ComponentManifestMap } from '../types.ts';
import * as v from 'valibot';

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

/**
 * MCP tool result type for error responses
 */
type MCPErrorResult = {
	content: Array<{ type: 'text'; text: string }>;
	isError: true;
};

/**
 * Converts an error to MCP-compatible content format
 *
 * @param error - The error to convert (can be any type)
 * @returns A tool result with error content and isError flag
 */
export const errorToMCPContent = (error: unknown): MCPErrorResult => {
	const errorPrefix =
		error instanceof ManifestGetError
			? 'Error getting manifest'
			: 'Unexpected error';
	const errorMessage = error instanceof Error ? error.message : String(error);

	// Include cause information if available
	let fullMessage = `${errorPrefix}: ${errorMessage}`;
	if (error instanceof ManifestGetError && error.cause) {
		const causeMessage =
			error.cause instanceof Error ? error.cause.message : String(error.cause);
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
 * Gets a component manifest from a request or using a custom provider
 *
 * @param request - The HTTP request to get the manifest for
 * @param manifestProvider - Optional custom function to get the manifest
 * @returns A promise that resolves to the parsed ComponentManifestMap
 * @throws {ManifestGetError} If getting the manifest fails or the response is invalid
 */
export async function getManifest(
	request?: Request,
	manifestProvider?: (request: Request) => Promise<string>,
): Promise<ComponentManifestMap> {
	if (!request) {
		throw new ManifestGetError(
			'The request is required but was not provided in the context',
		);
	}
	try {
		// Use custom manifestProvider if provided, otherwise fallback to default
		const manifestString = await (manifestProvider ?? defaultManifestProvider)(
			request,
		);
		const manifestData: unknown = JSON.parse(manifestString);

		const manifest = v.parse(ComponentManifestMap, manifestData);

		if (Object.keys(manifest.components).length === 0) {
			const url = getManifestUrlFromRequest(request);
			throw new ManifestGetError(`No components found in the manifest`, url);
		}

		return manifest;
	} catch (error) {
		if (error instanceof ManifestGetError) {
			throw error;
		}

		// Wrap network errors and other unexpected errors
		throw new ManifestGetError(
			`Failed to get manifest: ${error instanceof Error ? error.message : String(error)}`,
			getManifestUrlFromRequest(request),
			error instanceof Error ? error : undefined,
		);
	}
}

/**
 * Constructs the manifest URL from a request by replacing /mcp with /manifests/components.json
 */
function getManifestUrlFromRequest(request: Request): string {
	const url = new URL(request.url);
	// Replace /mcp endpoint with /manifests/components.json
	url.pathname = url.pathname.replace(
		/\/mcp\/?$/,
		'/manifests/components.json',
	);
	return url.toString();
}

/**
 * Default manifest provider that fetches from the same origin as the request,
 * replacing /mcp with /manifests/components.json
 */
async function defaultManifestProvider(request: Request): Promise<string> {
	const manifestUrl = getManifestUrlFromRequest(request);
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
