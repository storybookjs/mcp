import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockScreenshot = Buffer.from('mock-screenshot');
const mockPage = {
	goto: vi.fn().mockResolvedValue(undefined),
	waitForSelector: vi.fn().mockResolvedValue(undefined),
	screenshot: vi.fn().mockResolvedValue(mockScreenshot),
	close: vi.fn().mockResolvedValue(undefined),
};
const mockBrowser = {
	newPage: vi.fn().mockResolvedValue(mockPage),
	close: vi.fn().mockResolvedValue(undefined),
	isConnected: vi.fn().mockReturnValue(true),
};

vi.mock('playwright', () => ({
	chromium: {
		launch: vi.fn().mockResolvedValue(mockBrowser),
	},
}));

describe('browser-manager', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('should take a screenshot with default options', async () => {
		// Re-import to get fresh module state
		const { takeScreenshot } = await import('./browser-manager.ts');

		const result = await takeScreenshot({
			url: 'http://localhost:6006/iframe.html?id=button--primary&viewMode=story',
		});

		expect(mockBrowser.newPage).toHaveBeenCalledWith({
			viewport: { width: 1280, height: 720 },
		});
		expect(mockPage.goto).toHaveBeenCalledWith(
			'http://localhost:6006/iframe.html?id=button--primary&viewMode=story',
			{ waitUntil: 'load' },
		);
		expect(mockPage.waitForSelector).toHaveBeenCalledWith('#storybook-root > *', {
			timeout: 10_000,
		});
		expect(mockPage.screenshot).toHaveBeenCalledWith({
			omitBackground: false,
			fullPage: false,
			type: 'png',
		});
		expect(mockPage.close).toHaveBeenCalled();
		expect(result).toEqual(Buffer.from(mockScreenshot));
	});

	it('should use custom viewport', async () => {
		const { takeScreenshot } = await import('./browser-manager.ts');

		await takeScreenshot({
			url: 'http://localhost:6006/iframe.html?id=button--primary&viewMode=story',
			viewport: { width: 800, height: 600 },
		});

		expect(mockBrowser.newPage).toHaveBeenCalledWith({
			viewport: { width: 800, height: 600 },
		});
	});

	it('should pass omitBackground and fullPage options', async () => {
		const { takeScreenshot } = await import('./browser-manager.ts');

		await takeScreenshot({
			url: 'http://localhost:6006/iframe.html?id=button--primary&viewMode=story',
			omitBackground: true,
			fullPage: true,
		});

		expect(mockPage.screenshot).toHaveBeenCalledWith({
			omitBackground: true,
			fullPage: true,
			type: 'png',
		});
	});

	it('should close the page even when navigation fails', async () => {
		const { takeScreenshot } = await import('./browser-manager.ts');

		mockPage.goto.mockRejectedValueOnce(new Error('Navigation timeout'));

		await expect(
			takeScreenshot({
				url: 'http://localhost:6006/iframe.html?id=button--primary&viewMode=story',
			}),
		).rejects.toThrow('Navigation timeout');

		expect(mockPage.close).toHaveBeenCalled();
	});

	it('should check if Playwright is available', async () => {
		const { isPlaywrightAvailable } = await import('./browser-manager.ts');

		const result = await isPlaywrightAvailable();
		expect(result).toBe(true);
	});

	it('should close browser on cleanup', async () => {
		const { closeBrowser, takeScreenshot } = await import('./browser-manager.ts');

		// Ensure browser is launched
		await takeScreenshot({
			url: 'http://localhost:6006/iframe.html?id=button--primary&viewMode=story',
		});

		await closeBrowser();
		expect(mockBrowser.close).toHaveBeenCalled();
	});
});
