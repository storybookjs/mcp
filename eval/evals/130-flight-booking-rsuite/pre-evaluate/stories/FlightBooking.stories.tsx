import FlightBookingComponent from '../src/components/FlightBooking.tsx';
import { userEvent, fn, expect, screen, waitFor } from 'storybook/test';
import type { Meta, StoryObj } from '@storybook/react-vite';
import type { StepFunction } from 'storybook/internal/csf';

const meta = {
	component: FlightBookingComponent,
	args: {
		onSubmit: fn(),
	},
} satisfies Meta<typeof FlightBookingComponent>;

export default meta;

type Story = StoryObj<typeof meta>;

async function looseGetInteractiveElements(testId: string, label: string, step: StepFunction) {
	let elements: HTMLElement[] = [];
	await step(`Get element by test ID '${testId}' or label '${label}'`, async () => {
		elements = await waitFor(function getElement() {
			const byTestId = screen.queryAllByTestId(testId);
			if (byTestId.length > 0) {
				return byTestId;
			}
			const candidates = [
				...screen.queryAllByTestId(testId),
				...screen.queryAllByLabelText(label, { exact: false }),
				...screen.queryAllByPlaceholderText(label, { exact: false }),
				...screen.queryAllByText(label, { exact: false }),
			];

			// Return all interactive elements
			const interactive = candidates.filter((el) => {
				if (!el) {
					return false;
				}
				if (el.getAttribute('disabled') === '' || el.getAttribute('aria-disabled') === 'true') {
					return false;
				}
				const tagName = el.tagName.toLowerCase();
				// Check for naturally interactive HTML elements
				if (
					[
						'button',
						'a',
						'input',
						'select',
						'textarea',
						'details',
						'summary',
						'audio',
						'video',
					].includes(tagName)
				) {
					return true;
				}
				// Check for elements with interactive ARIA roles
				const role = el.getAttribute('role');
				if (
					!!role &&
					[
						'button',
						'link',
						'textbox',
						'checkbox',
						'radio',
						'combobox',
						'listbox',
						'option',
						'menuitem',
						'menuitemcheckbox',
						'menuitemradio',
						'tab',
						'switch',
						'slider',
						'spinbutton',
						'searchbox',
						'progressbar',
						'scrollbar',
					].includes(role)
				) {
					return true;
				}
				// Check for cursor: pointer style
				const computedStyle = window.getComputedStyle(el);
				if (computedStyle.cursor === 'pointer') {
					return true;
				}
				return false;
			});
			interactive.push(null as any);

			return interactive;
		});
	});
	return elements!;
}

export const Initial: Story = {};

export const FlightPicker: Story = {
	play: async ({ step }) => {
		const fromFlightTrigger = (
			await looseGetInteractiveElements('flight-trigger-from', 'From', step)
		)[0];
		await expect(fromFlightTrigger).toBeInTheDocument();

		if (
			fromFlightTrigger.tagName.toLowerCase() === 'input' &&
			(fromFlightTrigger as HTMLInputElement).type === 'text'
		) {
			await userEvent.type(fromFlightTrigger, 'M');
		} else {
			await userEvent.click(fromFlightTrigger);
		}

		await expect(
			(await looseGetInteractiveElements('airport-MEL', 'MEL', step))[0],
		).toBeInTheDocument();
	},
};

export const DatePicker: Story = {
	play: async ({ step }) => {
		await userEvent.click(
			(await looseGetInteractiveElements('date-trigger-departure', 'Departure Date', step))[0],
		);
		await expect((await looseGetInteractiveElements('date-27', '27', step))[0]).toBeInTheDocument();
	},
};

export const ReturnDatePickerIsUnavailableWhenOneWaySelected: Story = {
	play: async ({ step }) => {
		await userEvent.click((await looseGetInteractiveElements('one-way', 'One Way', step))[0]);

		const returnDatePicker = (
			await looseGetInteractiveElements('date-trigger-return', 'Return Date', step)
		)[0];

		// If the return datepicker exists, ensure it's disabled by trying to open it
		if (returnDatePicker) {
			await userEvent.click(returnDatePicker);
			const date15 = (await looseGetInteractiveElements('date-15', '15', step))[0];
			await expect(date15).toBeNull();
		} else {
			await expect(returnDatePicker).toBeNull();
		}
	},
};

export const Submitted: Story = {
	play: async ({ canvasElement, args, step }) => {
		await step('Enable return flight', async () => {
			const returnToggle = (await looseGetInteractiveElements('return', 'Return', step))[0];
			await userEvent.click(returnToggle);
		});

		await step('Select from flight', async () => {
			const fromFlightTrigger = (
				await looseGetInteractiveElements('flight-trigger-from', 'From', step)
			)[0];
			await expect(fromFlightTrigger).toBeInTheDocument();

			if (
				fromFlightTrigger.tagName.toLowerCase() === 'input' &&
				(fromFlightTrigger as HTMLInputElement).type === 'text'
			) {
				await userEvent.type(fromFlightTrigger, 'M');
			} else {
				await userEvent.click(fromFlightTrigger);
			}

			const melbourneAirport = (await looseGetInteractiveElements('airport-MEL', 'MEL', step))[0];
			await userEvent.click(melbourneAirport);
		});

		await step('Select to flight', async () => {
			const toFlightTrigger = (
				await looseGetInteractiveElements('flight-trigger-to', 'To', step)
			)[0];
			await expect(toFlightTrigger).toBeInTheDocument();

			if (
				toFlightTrigger.tagName.toLowerCase() === 'input' &&
				(toFlightTrigger as HTMLInputElement).type === 'text'
			) {
				await userEvent.type(toFlightTrigger, 'L');
			} else {
				await userEvent.click(toFlightTrigger);
			}
			const laxAirport = (await looseGetInteractiveElements('airport-LAX', 'LAX', step))[0];
			await userEvent.click(laxAirport);
		});

		await step('Select departure date', async () => {
			await userEvent.click(
				(await looseGetInteractiveElements('date-trigger-departure', 'Departure Date', step))[0],
			);
			const date = (await looseGetInteractiveElements('date-27', '27', step)).at(-1)!;
			await expect(date).toBeInTheDocument();
			await userEvent.click(date);
			await waitFor(
				async () => await userEvent.click((await looseGetInteractiveElements('ok', 'OK', step))[0]),
			);
			await userEvent.click(canvasElement); // dismiss datepicker popover
		});

		await step('Select return date', async () => {
			await userEvent.click(
				(await looseGetInteractiveElements('date-trigger-return', 'Return Date', step))[0],
			);
			const date = (await looseGetInteractiveElements('date-28', '28', step)).at(-1)!;
			await expect(date).toBeInTheDocument();
			await userEvent.click(date);
			await waitFor(
				async () => await userEvent.click((await looseGetInteractiveElements('ok', 'OK', step))[0]),
			);
			await userEvent.click(canvasElement); // dismiss datepicker popover
		});

		await userEvent.click(
			(await looseGetInteractiveElements('search-flights', 'Search Flights', step))[0],
		);
		await expect(args.onSubmit).toHaveBeenCalledOnce();
	},
};
