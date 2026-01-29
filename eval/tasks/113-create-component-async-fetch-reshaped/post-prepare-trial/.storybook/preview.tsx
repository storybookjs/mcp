import type { Preview } from '@storybook/react-vite';
import React from 'react';
import { Reshaped } from 'reshaped';
import 'reshaped/themes/slate/theme.css';
import { initialize, mswLoader } from 'msw-storybook-addon';

// Initialize MSW
initialize();

const preview: Preview = {
	decorators: [
		(Story) => (
			<Reshaped theme="slate">
				<Story />
			</Reshaped>
		),
	],
	// Provide the MSW addon loader globally
	loaders: [mswLoader],
	parameters: {
		options: {
			storySort: {
				order: [
					'Summary',
					'Conversation',
					'Build',
					'Typecheck',
					'Lint',
					'Source',
				],
			},
		},
	},
};

export default preview;
