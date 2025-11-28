import type { Preview } from '@storybook/react-vite';
import React from 'react';

import '@radix-ui/colors/gray.css';
import '@radix-ui/colors/blue.css';
import '@radix-ui/colors/green.css';
import '@radix-ui/colors/red.css';
import '@radix-ui/colors/purple.css';
import '@radix-ui/colors/gray-dark.css';
import '@radix-ui/colors/blue-dark.css';
import '@radix-ui/colors/green-dark.css';
import '@radix-ui/colors/red-dark.css';
import '@radix-ui/colors/purple-dark.css';

const preview: Preview = {
	decorators: [
		(Story) => (
			<div
				style={{
					padding: '40px',
					minHeight: '100vh',
					backgroundColor: '#f5f5f5',
				}}
			>
				<Story />
			</div>
		),
	],
	parameters: {
		options: {
			storySort: {
				order: ['Summary', 'Conversation', 'Build', 'Typecheck', 'Lint'],
			},
		},
	},
};

export default preview;
