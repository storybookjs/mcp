import * as a11yAddonAnnotations from "@storybook/addon-a11y/preview";
import { setProjectAnnotations } from '@storybook/react-vite';
import * as projectAnnotations from './preview';
import { page, server } from 'vitest/browser';

declare module 'vitest/browser' {
  interface BrowserCommands {
    getResultsPath: () => Promise<string>
  }
}

// This is an important step to apply the right configuration when testing your stories.
// More info at: https://storybook.js.org/docs/api/portable-stories/portable-stories-vitest#setprojectannotations
setProjectAnnotations([a11yAddonAnnotations, projectAnnotations, {
  afterEach: async ({ id, canvasElement }) => {
    const resultsPath = await server.commands.getResultsPath();
    await page.screenshot({ path: `${resultsPath}/${id}.png` });
    await server.commands.writeFile(`${resultsPath}/${id}.html`, canvasElement.innerHTML);
  }
}]);
