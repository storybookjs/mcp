import {
	ARIA_SNAPSHOT_COMMAND_NAME,
	ARIA_SNAPSHOT_REPORT_TYPE,
	COMPUTED_STYLES_REPORT_TYPE,
	HTML_REPORT_TYPE,
	MCP_APP_PARAM,
	MCP_APP_SIZE_CHANGED_EVENT,
	SCREENSHOT_REPORT_TYPE,
} from './constants';
import {
	extractComputedStyles,
	setupComputedStylesBaseline,
} from './utils/extract-computed-styles.ts';

const PNG_MIME_TYPE = 'image/png';

declare module 'vitest/browser' {
	interface BrowserCommands {
		[ARIA_SNAPSHOT_COMMAND_NAME]: () => Promise<string>;
	}
}

export async function beforeAll() {
	return setupComputedStylesBaseline(document);
}

export async function afterEach({
	canvasElement,
	globals,
	reporting,
}: {
	canvasElement: Element;
	globals: unknown;
	reporting: {
		addReport: (report: {
			type: string;
			status: 'failed' | 'passed' | 'warning';
			result: unknown;
		}) => Promise<void> | void;
	};
}) {
	const runConfig = getRunConfig(globals);
	if (
		!runConfig.screenshot &&
		!runConfig.html &&
		!runConfig.ariaSnapshot &&
		!runConfig.computedStyles
	) {
		return;
	}

	if (runConfig.html) {
		try {
			await reporting.addReport({
				type: HTML_REPORT_TYPE,
				status: 'passed',
				result: {
					html: canvasElement.innerHTML,
				},
			});
		} catch (error) {
			await reporting.addReport({
				type: HTML_REPORT_TYPE,
				status: 'failed',
				result: {
					message: error instanceof Error ? error.message : String(error),
				},
			});
		}
	}

	if (runConfig.computedStyles) {
		try {
			await reporting.addReport({
				type: COMPUTED_STYLES_REPORT_TYPE,
				status: 'passed',
				result: {
					elements: extractComputedStyles(canvasElement),
				},
			});
		} catch (error) {
			await reporting.addReport({
				type: COMPUTED_STYLES_REPORT_TYPE,
				status: 'failed',
				result: {
					message: error instanceof Error ? error.message : String(error),
				},
			});
		}
	}

	if (runConfig.screenshot) {
		try {
			const { page } = await import('vitest/browser');
			const base64 = await page.screenshot({
				save: false,
				element: canvasElement,
			});

			await reporting.addReport({
				type: SCREENSHOT_REPORT_TYPE,
				status: 'passed',
				result: {
					data: base64,
					mimeType: PNG_MIME_TYPE,
				},
			});
		} catch (error) {
			await reporting.addReport({
				type: SCREENSHOT_REPORT_TYPE,
				status: 'failed',
				result: {
					message: error instanceof Error ? error.message : String(error),
				},
			});
		}
	}

	if (runConfig.ariaSnapshot) {
		try {
			const ariaSnapshot = await captureAriaSnapshot();

			await reporting.addReport({
				type: ARIA_SNAPSHOT_REPORT_TYPE,
				status: 'passed',
				result: {
					ariaSnapshot,
				},
			});
		} catch (error) {
			await reporting.addReport({
				type: ARIA_SNAPSHOT_REPORT_TYPE,
				status: 'failed',
				result: {
					message: error instanceof Error ? error.message : String(error),
				},
			});
		}
	}
}

async function captureAriaSnapshot(): Promise<string> {
	const { commands } = await import('vitest/browser');
	const ariaSnapshotCommand = commands[ARIA_SNAPSHOT_COMMAND_NAME];

	if (typeof ariaSnapshotCommand !== 'function') {
		throw new Error(
			'ARIA snapshots require Playwright support. The @storybook/addon-mcp preset should register the required Vitest browser command automatically through viteFinal.',
		);
	}

	return ariaSnapshotCommand();
}

function getRunConfig(globals: unknown): {
	screenshot: boolean;
	html: boolean;
	ariaSnapshot: boolean;
	computedStyles: boolean;
} {
	const sbConfig = (
		globals as
			| {
					sbConfig?: {
						screenshot?: boolean;
						html?: boolean;
						ariaSnapshot?: boolean;
						computedStyles?: boolean;
					};
			  }
			| undefined
	)?.sbConfig;

	return {
		screenshot: sbConfig?.screenshot === true,
		html: sbConfig?.html === true,
		ariaSnapshot: sbConfig?.ariaSnapshot === true,
		computedStyles: sbConfig?.computedStyles === true,
	};
}

/**
 * Storybook MCP App Script
 *
 * This script runs inside Storybook's iframe and communicates dimensions
 * to the parent preview.html frame via postMessage (cross-origin safe).
 *
 * Only activates when the iframe is loaded with `mcp-app=true` query parameter,
 * which is set by the MCP Apps preview.html wrapper.
 */

// Only run if we're in the special MCP App iframe context
const isMcpApp = new URLSearchParams(window.location.search).has(MCP_APP_PARAM);

if (isMcpApp) {
	const SIZE_CHANGE_THRESHOLD = 2; // Only report changes > 2px to avoid oscillation

	let debounceTimer: ReturnType<typeof setTimeout> | null = null;
	let lastSentHeight = 0;
	const DEBOUNCE_MS = 100;

	function sendSizeToParent() {
		const height = document.body.scrollHeight;

		// Only send if the change exceeds the threshold
		if (Math.abs(height - lastSentHeight) <= SIZE_CHANGE_THRESHOLD) {
			return;
		}

		lastSentHeight = height;
		window.parent.postMessage(
			{
				type: MCP_APP_SIZE_CHANGED_EVENT,
				height,
			},
			'*',
		);
	}

	function debouncedSendSize() {
		if (debounceTimer) {
			clearTimeout(debounceTimer);
		}
		debounceTimer = setTimeout(sendSizeToParent, DEBOUNCE_MS);
	}

	// Send initial size after DOM is ready
	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', sendSizeToParent);
	} else {
		sendSizeToParent();
	}

	// Also send after full load (images, fonts, etc.)
	window.addEventListener('load', sendSizeToParent);

	// Observe body for size changes using ResizeObserver
	const resizeObserver = new ResizeObserver(debouncedSendSize);
	resizeObserver.observe(document.body);

	// Also observe for DOM mutations that might affect size
	const mutationObserver = new MutationObserver(debouncedSendSize);
	mutationObserver.observe(document.body, {
		childList: true,
		subtree: true,
		attributes: true,
	});
}
