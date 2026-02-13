import type { Preview } from '@storybook/react-vite';

const preview: Preview = {
	parameters: {
		options: {
			storySort: {
				order: ['Example', 'Summary', 'Conversation', 'Build', 'Typecheck', 'Lint', 'Source'],
			},
		},
	},
};

export default preview;
