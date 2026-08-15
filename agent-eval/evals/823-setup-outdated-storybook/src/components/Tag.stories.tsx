import type { Meta, StoryObj } from '@storybook/react';
import Tag from './Tag';

const meta = {
	title: 'Components/Tag',
	component: Tag,
	args: {
		label: 'New',
	},
} satisfies Meta<typeof Tag>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Neutral: Story = {};

export const Positive: Story = {
	args: {
		tone: 'positive',
	},
};

export const Notice: Story = {
	args: {
		tone: 'notice',
	},
};
