// 👇 Import the generated component
import FlightBookingComponent from '../src/components/FlightBooking.tsx';
import { fn } from 'storybook/test';

export default {
	component: FlightBookingComponent,
	args: {
		// 👇 Add any required arg values here
		onSubmit: fn(),
	},
};

export const Initial = {};
