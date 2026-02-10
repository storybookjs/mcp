import FlightBookingComponent from '../src/components/FlightBooking.tsx';
import { fn } from 'storybook/test';
import type { Meta, StoryObj } from '@storybook/react-vite';

const meta = {
	component: FlightBookingComponent,
	args: {
		onSubmit: fn(),
	},
} satisfies Meta<typeof FlightBookingComponent>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Initial: Story = {};
