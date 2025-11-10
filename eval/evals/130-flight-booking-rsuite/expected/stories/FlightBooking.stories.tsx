import FlightBookingComponent from '../src/components/FlightBooking.tsx';
import { userEvent, fn, expect, screen } from 'storybook/test';
import React from 'react';
import 'rsuite/dist/rsuite.min.css';

export default {
	component: FlightBookingComponent,
	args: {
		onSubmit: fn(),
	},
};

export const Initial = {};

export const FlightPicker = {
	play: async ({ canvas }) => {
		await userEvent.click(await canvas.findByText('From'));
		await expect(
			await screen.findByText('MEL', { exact: false }),
		).toBeInTheDocument();
	},
};

export const DatePicker = {
	play: async ({ canvas }) => {
		await userEvent.click(
			await canvas.findByRole('button', { name: 'Departure Date' }),
		);
		await expect(await screen.findByText('27')).toBeInTheDocument();
	},
};

export const ReturnDatePickerIsUnavailableWhenOneWaySelected = {
	play: async ({ canvas }) => {
		await userEvent.click(await canvas.findByText('One Way'));

		const returnDatepicker = await canvas.queryByRole('button', {
			name: 'Return Date',
		});

		// If the return datepicker exists, ensure it's disabled by trying to open it
		if (returnDatepicker) {
			await userEvent.click(returnDatepicker);
			await expect(await canvas.queryByText('28')).not.toBeInTheDocument();
		} else {
			await expect(returnDatepicker).toBeNull();
		}
	},
};

export const Submitted = {
	play: async ({ canvas, canvasElement, args }) => {
		await userEvent.click(
			await canvas.findByRole('button', { name: 'Return' }),
		);
		await userEvent.click(await canvas.findByText('From'));
		await userEvent.click(await screen.findByText('MEL', { exact: false }));

		await userEvent.click(await canvas.findByText('To'));
		await userEvent.click(await screen.findByText('LAX', { exact: false }));

		await userEvent.click(
			await canvas.findByRole('button', { name: 'Departure Date' }),
		);
		await userEvent.click(await screen.findByText('27'));
		await userEvent.click(canvasElement); // dismiss datepicker popover

		await userEvent.click(
			await canvas.findByRole('button', { name: 'Return Date' }),
		);
		await userEvent.click(await screen.findByText('28'));
		await userEvent.click(canvasElement); // dismiss datepicker popover

		await userEvent.click(await canvas.findByText('Search Flights'));
		await expect(args.onSubmit).toHaveBeenCalledOnce();
	},
};
