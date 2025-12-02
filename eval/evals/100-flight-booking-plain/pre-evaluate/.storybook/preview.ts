import type { Preview } from '@storybook/react-vite';

const preview: Preview = {
	parameters: {
		options: {
			storySort: {
				order: ['Summary', 'Conversation', 'Build', 'Typecheck', 'Lint'],
			},
		},
	},
};

export default preview;
