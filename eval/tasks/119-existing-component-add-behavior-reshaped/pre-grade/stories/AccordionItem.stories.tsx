import AccordionItem from '../src/components/AccordionItem.tsx';
import { userEvent, expect, screen, waitFor } from 'storybook/test';
import type { Meta, StoryObj } from '@storybook/react-vite';

const meta = {
	component: AccordionItem,
	args: {
		title: 'What is this product?',
		children:
			'This is a comprehensive solution for managing your workflow efficiently.',
	},
} satisfies Meta<typeof AccordionItem>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const ToggleExpands: Story = {
	play: async ({ step }) => {
		await step('Verify accordion is initially collapsed', async () => {
			const content = screen.queryByTestId('accordion-content');
			await expect(content).not.toBeInTheDocument();
		});

		await step('Click to expand', async () => {
			const header = await waitFor(() =>
				screen.getByTestId('accordion-header'),
			);
			await userEvent.click(header);

			// Content should now be visible
			const content = await waitFor(() =>
				screen.getByTestId('accordion-content'),
			);
			await expect(content).toBeInTheDocument();
		});

		await step('Click again to collapse', async () => {
			const header = screen.getByTestId('accordion-header');
			await userEvent.click(header);

			// Content should be hidden again
			await waitFor(() => {
				const content = screen.queryByTestId('accordion-content');
				expect(content).not.toBeInTheDocument();
			});
		});
	},
};

export const DefaultExpanded: Story = {
	args: {
		defaultExpanded: true,
	},
	play: async ({ step }) => {
		await step('Verify accordion starts expanded', async () => {
			const content = await waitFor(() =>
				screen.getByTestId('accordion-content'),
			);
			await expect(content).toBeInTheDocument();
		});

		await step('Click to collapse', async () => {
			const header = screen.getByTestId('accordion-header');
			await userEvent.click(header);

			// Content should now be hidden
			await waitFor(() => {
				const content = screen.queryByTestId('accordion-content');
				expect(content).not.toBeInTheDocument();
			});
		});
	},
};

export const MultipleToggles: Story = {
	play: async ({ step }) => {
		await step('Perform multiple toggle cycles', async () => {
			const header = await waitFor(() =>
				screen.getByTestId('accordion-header'),
			);

			// First expand
			await userEvent.click(header);
			await expect(
				await waitFor(() => screen.getByTestId('accordion-content')),
			).toBeInTheDocument();

			// First collapse
			await userEvent.click(header);
			await waitFor(() => {
				expect(
					screen.queryByTestId('accordion-content'),
				).not.toBeInTheDocument();
			});

			// Second expand
			await userEvent.click(header);
			await expect(
				await waitFor(() => screen.getByTestId('accordion-content')),
			).toBeInTheDocument();

			// Second collapse
			await userEvent.click(header);
			await waitFor(() => {
				expect(
					screen.queryByTestId('accordion-content'),
				).not.toBeInTheDocument();
			});
		});
	},
};
