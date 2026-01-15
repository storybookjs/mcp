import type { Preview } from '@storybook/react-vite';
import React from 'react';

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
