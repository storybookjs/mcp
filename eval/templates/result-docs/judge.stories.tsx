import type { Meta, StoryObj } from '@storybook/react-vite';
import { Judge } from './judge';

const meta = {
	title: 'Result Docs/Judge',
	component: Judge,
	parameters: {
		layout: 'fullscreen',
	},
	tags: ['autodocs'],
} satisfies Meta<typeof Judge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Scored: Story = {
	args: {
		agent: 'claude-code',
		model: 'claude-sonnet-4.5',
		score: 0.82,
		reason:
			'The agent fixed the semantic accessibility issue and explained the remaining visual contrast issue clearly. It asked for user confirmation before making design changes, matching the rubric expectations.',
		prompt: {
			effectivePrompt: 'Judge this response against rubric X and provide score + reason.',
		},
		evidence: {
			finalAssistantText: 'I fixed the semantic issue and left visual changes for your approval.',
			lastUserToolResults: '2 tests passed, 0 failed, 1 a11y violation remains.',
		},
		raw: '{"score":0.82,"reason":"..."}',
	},
};
