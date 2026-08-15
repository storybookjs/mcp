import type { Meta, StoryObj } from '@storybook/react-vite';
import Button from './Button';

const meta = {
	title: 'Components/Button',
	component: Button,
	args: {
		label: 'Click me',
	},
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {};

export const Secondary: Story = {
	args: {
		variant: 'secondary',
	},
};

export const Disabled: Story = {
	args: {
		disabled: true,
	},
};
