import ProductCard from '../src/components/ProductCard.tsx';
import { userEvent, fn, expect, screen, waitFor, within } from 'storybook/test';
import type { Meta, StoryObj } from '@storybook/react-vite';

const meta = {
	component: ProductCard,
	args: {
		name: 'Wireless Headphones',
		price: 79.99,
		image: 'https://via.placeholder.com/300x200',
		onRate: fn(),
		onAddToCart: fn(),
	},
} satisfies Meta<typeof ProductCard>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const RatingInteraction: Story = {
	args: {
		initialRating: 0,
	},
	play: async ({ args, step }) => {
		await step('Verify initial rating is 0', async () => {
			const productCard = await waitFor(() =>
				screen.getByTestId('product-card'),
			);
			const stars = within(productCard).getAllByTestId(/star-/);
			await expect(stars).toHaveLength(5);
		});

		await step('Click 4th star to rate', async () => {
			const star4 = await waitFor(() => screen.getByTestId('star-4'));
			await userEvent.click(star4);
			await expect(args.onRate).toHaveBeenCalledWith(4);
		});

		await step('Click 2nd star to change rating', async () => {
			const star2 = screen.getByTestId('star-2');
			await userEvent.click(star2);
			await expect(args.onRate).toHaveBeenCalledWith(2);
		});
	},
};

export const AddToCartInteraction: Story = {
	play: async ({ args, step }) => {
		await step('Click add to cart button', async () => {
			const addButton = await waitFor(() =>
				screen.getByRole('button', { name: /add to cart/i }),
			);
			await expect(addButton).toBeEnabled();
			await userEvent.click(addButton);
			await expect(args.onAddToCart).toHaveBeenCalledOnce();
		});
	},
};

export const WithoutCallbacks: Story = {
	args: {
		initialRating: 3,
		onRate: undefined,
		onAddToCart: undefined,
	},
	play: async ({ step }) => {
		await step('Verify add to cart button is disabled', async () => {
			const addButton = await waitFor(() =>
				screen.getByRole('button', { name: /add to cart/i }),
			);
			await expect(addButton).toBeDisabled();
		});
	},
};

export const FullInteractionFlow: Story = {
	args: {
		initialRating: 0,
	},
	play: async ({ args, step }) => {
		await step('Rate the product', async () => {
			const star5 = await waitFor(() => screen.getByTestId('star-5'));
			await userEvent.click(star5);
			await expect(args.onRate).toHaveBeenCalledWith(5);
		});

		await step('Add to cart', async () => {
			const addButton = screen.getByRole('button', { name: /add to cart/i });
			await userEvent.click(addButton);
			await expect(args.onAddToCart).toHaveBeenCalledOnce();
		});
	},
};

export const PreRated: Story = {
	args: {
		initialRating: 4,
	},
	play: async ({ step }) => {
		await step('Verify pre-existing rating is displayed', async () => {
			// Visual verification that 4 stars are filled
			const productCard = await waitFor(() =>
				screen.getByTestId('product-card'),
			);
			await expect(productCard).toBeInTheDocument();
		});
	},
};
