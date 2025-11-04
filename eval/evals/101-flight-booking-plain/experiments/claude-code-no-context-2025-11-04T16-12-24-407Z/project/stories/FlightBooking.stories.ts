import FlightBookingComponent from '../src/components/FlightBooking.tsx';
import { userEvent, fn, expect } from 'storybook/test';

export default {
	component: FlightBookingComponent,
	args: {
		onSubmit: fn(),
	},
};

export const Initial = {};

export const FlightPicker = {
	play: async ({ canvas }) => {
		await userEvent.click(await canvas.findByTestId('airport-from'));
		await expect(await canvas.findByTestId('MEL')).toBeInTheDocument();
	},
};

export const DatePicker = {
	play: async ({ canvas }) => {
		await userEvent.click(
			await canvas.findByTestId('datepicker-trigger-departure'),
		);
		await expect(await canvas.findByTestId('date-29')).toBeInTheDocument();
	},
};

export const ReturnDatePickerIsUnavailableWhenOneWaySelected = {
	play: async ({ canvas }) => {
		await userEvent.click(await canvas.findByTestId('one-way'));
		const returnDatepicker = await canvas.queryByTestId(
			'datepicker-trigger-return',
		);
		if (returnDatepicker) {
			await userEvent.click(returnDatepicker);
			await expect(
				await canvas.findByTestId('date-30'),
			).not.toBeInTheDocument();
		} else {
			expect(returnDatepicker).toBeNull();
		}
	},
};

export const Submitted = {
	play: async ({ canvas, args }) => {
		await userEvent.click(await canvas.findByTestId('airport-from'));
		await userEvent.click(await canvas.findByTestId('MEL'));

		await userEvent.click(await canvas.findByTestId('airport-to'));
		await userEvent.click(await canvas.findByTestId('LAX'));

		await userEvent.click(
			await canvas.findByTestId('datepicker-trigger-departure'),
		);
		await userEvent.click(await canvas.findByTestId('date-29'));

		await userEvent.click(
			await canvas.findByTestId('datepicker-trigger-return'),
		);
		await userEvent.click(await canvas.findByTestId('date-30'));

		await userEvent.click(await canvas.findByTestId('submit'));

		await expect(args.onSubmit).toHaveBeenCalledOnce();
	},
};
