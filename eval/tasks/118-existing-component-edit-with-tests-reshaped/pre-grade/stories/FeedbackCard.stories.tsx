import FeedbackCard from '../src/components/FeedbackCard.tsx';
import { userEvent, fn, expect, screen, waitFor } from 'storybook/test';
import type { Meta, StoryObj } from '@storybook/react-vite';

const meta = {
	component: FeedbackCard,
	args: {
		author: 'Taylor Smith',
		sentiment: 'positive' as const,
		feedback: 'The new feature works great and saves me a lot of time!',
	},
} satisfies Meta<typeof FeedbackCard>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithHelpfulCounter: Story = {
	args: {
		helpfulCount: 5,
		onMarkHelpful: fn(),
	},
	play: async ({ args, step }) => {
		await step('Verify helpful counter is displayed', async () => {
			const helpfulButton = await waitFor(() =>
				screen.getByRole('button', { name: /helpful/i }),
			);
			await expect(helpfulButton).toBeInTheDocument();

			// Check if count is displayed
			await expect(screen.getByText(/5/)).toBeInTheDocument();
		});

		await step('Click helpful button and verify callback', async () => {
			const helpfulButton = screen.getByRole('button', { name: /helpful/i });
			await userEvent.click(helpfulButton);
			await expect(args.onMarkHelpful).toHaveBeenCalledOnce();
		});
	},
};

export const WithoutCallback: Story = {
	args: {
		helpfulCount: 3,
		// onMarkHelpful is not provided
	},
	play: async ({ step }) => {
		await step('Verify button is disabled when no callback', async () => {
			const helpfulButton = await waitFor(() =>
				screen.getByRole('button', { name: /helpful/i }),
			);
			await expect(helpfulButton).toBeDisabled();
		});
	},
};

export const InitialState: Story = {
	args: {
		onMarkHelpful: fn(),
		// helpfulCount defaults to 0
	},
	play: async ({ step }) => {
		await step('Verify initial count is 0', async () => {
			await expect(screen.getByText(/0/)).toBeInTheDocument();
		});
	},
};
