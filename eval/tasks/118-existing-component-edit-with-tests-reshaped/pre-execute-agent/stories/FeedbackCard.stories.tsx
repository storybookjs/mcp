import type { Meta, StoryObj } from '@storybook/react';
import FeedbackCard from '../src/components/FeedbackCard';

const meta = {
	title: 'Feedback/FeedbackCard',
	component: FeedbackCard,
	args: {
		author: 'Taylor Smith',
		sentiment: 'positive',
		feedback: 'The new feature works great and saves me a lot of time!',
	},
} satisfies Meta<typeof FeedbackCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Positive: Story = {};

export const Neutral: Story = {
	args: {
		sentiment: 'neutral',
		feedback:
			'The feature is okay, but could use some improvements in performance.',
	},
};

export const Negative: Story = {
	args: {
		author: 'Jordan Lee',
		sentiment: 'negative',
		feedback:
			'Encountered several bugs. Needs more testing before production release.',
	},
};

export const LongFeedback: Story = {
	args: {
		feedback:
			'I have been using this product for several months now, and while it has many good features, there are some areas that could benefit from improvement. The interface is intuitive, but performance could be better, especially when handling large datasets. Overall, a solid product with room for growth.',
	},
};
