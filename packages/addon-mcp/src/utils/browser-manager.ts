import type { Browser, Page } from 'playwright';

let browser: Browser | undefined;
let launchPromise: Promise<Browser> | undefined;

export interface ScreenshotOptions {
	url: string;
	viewport?: { width: number; height: number };
	omitBackground?: boolean;
	fullPage?: boolean;
}

async function getBrowser(): Promise<Browser> {
	if (browser?.isConnected()) {
		return browser;
	}

	// Concurrent-launch protection: reuse the same launch promise
	if (launchPromise) {
		return launchPromise;
	}

	launchPromise = (async () => {
		const { chromium } = await import('playwright');
		browser = await chromium.launch();
		return browser;
	})();

	try {
		return await launchPromise;
	} finally {
		launchPromise = undefined;
	}
}

export async function takeScreenshot({
	url,
	viewport = { width: 1280, height: 720 },
	omitBackground = false,
	fullPage = false,
}: ScreenshotOptions): Promise<Buffer> {
	const browserInstance = await getBrowser();
	let page: Page | undefined;

	try {
		page = await browserInstance.newPage({ viewport });
		await page.goto(url, { waitUntil: 'load' });

		// Wait for story content to render
		await page.waitForSelector('#storybook-root > *', { timeout: 10_000 });

		const screenshot = await page.screenshot({
			omitBackground,
			fullPage,
			type: 'png',
		});

		return Buffer.from(screenshot);
	} finally {
		await page?.close();
	}
}

export async function closeBrowser(): Promise<void> {
	if (browser) {
		await browser.close();
		browser = undefined;
	}
}

/**
 * Check if Playwright is available by attempting a dynamic import.
 */
export async function isPlaywrightAvailable(): Promise<boolean> {
	try {
		await import('playwright');
		return true;
	} catch {
		return false;
	}
}

process.on('exit', () => {
	browser?.close().catch(() => {});
});
