/**
 * Cheap upfront check that a Storybook URL is actually serving the
 * MCP tools we need before we spawn `claude` (and pay for it). POSTs
 * `tools/list` against `<storybookUrl>/mcp`, parses the SSE response,
 * and verifies the required tool names are present.
 *
 * Without this, a wrong `--storybook-url` (e.g. user passed `:6006`
 * but Storybook is actually on `:6010`) ran the agent for a full
 * minute before the first `mcp__storybook__get-changed-stories` call
 * came back with "No such tool available" — and by then we'd already
 * burned ~$0.14 on a doomed run.
 */
const REQUIRED_TOOLS = ['get-changed-stories', 'apply-review-state'] as const;

/**
 * Top-level keys the eval's current `ReviewStateSchema` requires the
 * target's `apply-review-state` tool to accept. The agent calls that
 * tool against the *target's* addon-mcp, so the target dictates the
 * payload shape — if it's older than this list, the agent produces a
 * payload the eval then rejects post-spend. The preflight catches it.
 */
const EXPECTED_REVIEW_STATE_KEYS = ['title', 'description', 'collections'] as const;

export interface PreflightSuccess {
	ok: true;
	totalTools: number;
	toolNames: string[];
}

export interface PreflightFailure {
	ok: false;
	url: string;
	stage: 'unreachable' | 'http-error' | 'parse-error' | 'missing-tools' | 'schema-skew';
	detail: string;
	totalTools?: number;
	toolNames?: string[];
	missing?: string[];
}

export type PreflightResult = PreflightSuccess | PreflightFailure;

export async function preflightMcp(
	storybookUrl: string,
	fetchImpl: typeof fetch = fetch,
): Promise<PreflightResult> {
	const url = storybookUrl.replace(/\/$/, '') + '/mcp';

	let res: Response;
	try {
		res = await fetchImpl(url, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				accept: 'application/json, text/event-stream',
			},
			body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method: 'tools/list' }),
		});
	} catch (e) {
		return {
			ok: false,
			url,
			stage: 'unreachable',
			detail: (e as Error).message,
		};
	}

	if (!res.ok) {
		return {
			ok: false,
			url,
			stage: 'http-error',
			detail: `HTTP ${res.status} ${res.statusText}`,
		};
	}

	const body = await res.text();
	let payload: any;
	try {
		// Storybook's MCP transport returns SSE — pull the `data:` line.
		const dataLine = body.split('\n').find((l) => l.startsWith('data: '));
		const json = dataLine ? dataLine.slice('data: '.length) : body;
		payload = JSON.parse(json);
	} catch (e) {
		return {
			ok: false,
			url,
			stage: 'parse-error',
			detail: `could not parse tools/list response: ${(e as Error).message}; first 200 chars: ${body.slice(0, 200)}`,
		};
	}

	const tools = Array.isArray(payload?.result?.tools) ? payload.result.tools : [];
	const toolNames: string[] = tools
		.map((t: any) => (typeof t?.name === 'string' ? t.name : ''))
		.filter(Boolean);
	const missing = REQUIRED_TOOLS.filter((req) => !toolNames.includes(req));

	if (missing.length > 0) {
		return {
			ok: false,
			url,
			stage: 'missing-tools',
			detail: `MCP server at ${url} responded but does not expose: ${missing.join(', ')}`,
			totalTools: toolNames.length,
			toolNames,
			missing: missing.slice(),
		};
	}

	// Schema-skew guard: the agent calls apply-review-state against the
	// target's own addon-mcp, so the target dictates the payload shape.
	// If that shape predates this eval's ReviewStateSchema, the agent
	// (correctly) produces a payload the eval then rejects post-spend — a
	// confusing `agent-error`. Catch it here for free instead.
	const applyTool = tools.find((t: any) => t?.name === 'apply-review-state');
	const props = applyTool?.inputSchema?.properties;
	if (props && typeof props === 'object') {
		const skewMissing = EXPECTED_REVIEW_STATE_KEYS.filter((k) => !(k in props));
		if (skewMissing.length > 0) {
			return {
				ok: false,
				url,
				stage: 'schema-skew',
				detail:
					`apply-review-state advertises a ReviewState shape this eval no longer speaks — ` +
					`its input keys are [${Object.keys(props).join(', ')}], missing [${skewMissing.join(', ')}].`,
				totalTools: toolNames.length,
				toolNames,
				missing: skewMissing.slice(),
			};
		}
	}

	return { ok: true, totalTools: toolNames.length, toolNames };
}

/**
 * Format a failure as a multi-line human-readable error message with a
 * hint at common causes. Returned as a string so the caller can throw
 * with it, log it, or stitch it into a larger banner.
 */
export function formatPreflightFailure(failure: PreflightFailure): string {
	const lines = [
		`MCP preflight failed: ${failure.detail}`,
		`  url:   ${failure.url}`,
		`  stage: ${failure.stage}`,
	];
	if (failure.totalTools !== undefined) {
		lines.push(`  tools: ${failure.totalTools} found (${failure.toolNames?.join(', ') || 'none'})`);
	}
	if (failure.missing?.length) {
		lines.push(`  missing required: ${failure.missing.join(', ')}`);
	}
	lines.push('');
	lines.push('Common causes:');
	switch (failure.stage) {
		case 'unreachable':
			lines.push('  - Storybook is not running at that URL — start it, or pass --storybook-url with the right port.');
			lines.push('  - Storybook prints its URL on boot (`- Local: http://localhost:NNNN/`); use that port.');
			break;
		case 'http-error':
			lines.push('  - The URL responds but `/mcp` is not registered. Did you add `@storybook/addon-mcp` to the target\'s .storybook/main.ts addons array?');
			break;
		case 'parse-error':
			lines.push('  - The endpoint returned something other than an MCP SSE response.');
			lines.push('  - Confirm the URL points at a Storybook dev server, not a built output.');
			break;
		case 'missing-tools':
			lines.push('  - addon-mcp is registered but feature-gated tools are off.');
			lines.push('  - Add `features: { changeDetection: true }` to the target\'s .storybook/main.ts.');
			lines.push('  - Restart Storybook after editing main.ts.');
			break;
		case 'schema-skew':
			lines.push("  - The target's installed @storybook/addon-mcp is stale: its apply-review-state");
			lines.push('    tool expects an older ReviewState shape (e.g. narrative/clusters) than this eval.');
			lines.push('  - Rebuild + re-link the current addon-mcp into the target, then restart its Storybook:');
			lines.push('      pnpm --filter @storybook/addon-mcp build');
			lines.push('      pnpm link-addon-mcp --target <target> --storybook-repo <storybook>');
			break;
	}
	return lines.join('\n');
}
