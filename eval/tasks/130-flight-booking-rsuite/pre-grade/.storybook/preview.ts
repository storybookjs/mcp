import type { Preview } from '@storybook/react-vite';
import 'rsuite/dist/rsuite.min.css';

const preview: Preview = {
	parameters: {
		options: {
			storySort: {
				order: ['Summary', 'Conversation', 'Build', 'Typecheck', 'Lint', 'Source'],
			},
		},
	},
};

export default preview;
