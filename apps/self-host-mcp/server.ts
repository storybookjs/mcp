/**
 * @storybook/mcp Self-hosting Example
 *
 * This example demonstrates how to run @storybook/mcp as a standalone HTTP server.
 * The server exposes the Storybook MCP protocol at `/mcp` endpoint, allowing any
 * MCP client (e.g., Claude, other AI tools) to interact with component documentation.
 *
 * Key APIs demonstrated:
 * - createStorybookMcpHandler: Creates an HTTP request handler for the MCP protocol
 * - manifestProvider: Custom function to load component manifests from local or remote sources
 * - serve: HTTP server from srvx for hosting the endpoint
 */

import { createStorybookMcpHandler } from '@storybook/mcp';
import { serve } from 'srvx';
import fs from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { parseArgs } from 'node:util';

const args = parseArgs({
	options: {
		port: {
			type: 'string',
			default: '13316',
		},
		manifestsDir: {
			type: 'string',
			default: './manifests',
		},
	},
});

const port = Number(args.values.port);
const manifestsPath = args.values.manifestsDir ?? './manifests';

/**
 * Create the MCP handler that processes incoming requests
 *
 * createStorybookMcpHandler returns an async function that:
 * 1. Takes an HTTP Request object
 * 2. Returns an HTTP Response with MCP protocol data (tools, resources, etc.)
 * 3. Handles tool calls from MCP clients (e.g., list-all-documentation, get-documentation)
 *
 * This handler is framework-agnostic and can be adapted to:
 * - AWS Lambda/API Gateway
 * - Vercel/Netlify Functions
 * - Cloudflare Workers/Pages
 * - Any HTTP runtime supporting Web APIs
 *
 * Configuration:
 * - manifestProvider: Custom function to load component manifests
 *   The provider can:
 *   - Load from local filesystem (./manifests)
 *   - Fetch from remote URLs (CDN, S3, etc.)
 *   - Query a database
 *   - Generate manifests dynamically
 * Providing the manifest is decoupled from the MCP server logic
 */
const storybookMcpHandler = await createStorybookMcpHandler({
	manifestProvider: async (_request: Request | undefined, path: string) => {
		const fileName = basename(path);

		/**
		 * Check if manifestsPath is a remote URL
		 * Allows deployments to serve manifests from CDN or cloud storage
		 */
		if (manifestsPath.startsWith('http://') || manifestsPath.startsWith('https://')) {
			const response = await fetch(`${manifestsPath}/${fileName}`);
			if (!response.ok) {
				throw new Error(
					`Failed to fetch manifest from ${manifestsPath}/${fileName}: ${response.status} ${response.statusText}`,
				);
			}
			return await response.text();
		}

		/**
		 * Load from local filesystem
		 * Suitable for local development or when server has direct filesystem access
		 */
		return await fs.readFile(resolve(manifestsPath, fileName), 'utf-8');
	},
});

serve({
	port,
	async fetch(request: Request) {
		if (new URL(request.url).pathname !== '/mcp') {
			return new Response('Not found', { status: 404 });
		}

		/**
		 * Pass request to MCP handler
		 *
		 * storybookMcpHandler is a Web API-compliant request handler:
		 * - Input: Request object with URL, headers, method, body
		 * - Output: Response object with status, headers, body
		 *
		 * It handles:
		 * - MCP initialization messages
		 * - Tool calls (list-all-documentation, get-documentation, preview-stories)
		 * - Resource access (component manifests)
		 * - Protocol errors and edge cases
		 */
		return await storybookMcpHandler(request);
	},
});

console.log(`@storybook/mcp example server listening on http://localhost:${port}/mcp`);
