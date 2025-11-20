import * as a11yAddonAnnotations from '@storybook/addon-a11y/preview';
import { setProjectAnnotations } from '@storybook/react-vite';
import * as projectAnnotations from './preview';
import { page, server } from 'vitest/browser';
import { afterEach } from 'vitest';

declare module 'vitest/browser' {
	interface BrowserCommands {
		getResultsPath: () => Promise<string>;
	}
}

/**
 * We can only get the story id and canvas element in the story annotations,
 * but Storybook's afterEach does not run on failed tests.
 * Therefore we use Storybook's beforeEach hook to store the information,
 * and then Vitest's afterEach to perform the screenshot and HTML saving,
 * because that always run.
 */
let currentStoryId: string | undefined;
let currentCanvasElement: Element | undefined;

setProjectAnnotations([
	a11yAddonAnnotations,
	projectAnnotations,
	{
		beforeEach: async ({ id, canvasElement }) => {
			currentStoryId = id;
			currentCanvasElement = canvasElement;
			return () => {
				currentStoryId = undefined;
				currentCanvasElement = undefined;
			};
		},
	},
]);

afterEach(async () => {
	if (!currentStoryId || !currentCanvasElement) {
		return;
	}
	const resultsPath = await server.commands.getResultsPath();
	await page.screenshot({ path: `${resultsPath}/${currentStoryId}.png` });
	await server.commands.writeFile(
		`${resultsPath}/${currentStoryId}.html`,
		currentCanvasElement.innerHTML,
	);
});
