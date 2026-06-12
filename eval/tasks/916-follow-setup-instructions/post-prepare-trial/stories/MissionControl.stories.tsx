import type { Meta, StoryObj } from '@storybook/react';
import { expect } from 'storybook/test';
import MissionControl from '../src/components/MissionControl';

const meta = {
	title: 'Example/MissionControl',
	component: MissionControl,
	tags: ['test'],
} satisfies Meta<typeof MissionControl>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
	play: async ({ canvas }) => {
		await expect(canvas.getByText('Mission control')).toBeInTheDocument();
		await expect(canvas.getByRole('button', { name: 'Open dashboard' })).toBeInTheDocument();
	},
};
