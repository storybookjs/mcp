import FlightBookingComponent from '../src/components/FlightBooking.tsx';
import { userEvent, fn, expect, screen, waitFor } from 'storybook/test';
import type { Meta, StoryObj } from '@storybook/react-vite';
import type { StepFunction } from 'storybook/internal/types';

const meta = {
	component: FlightBookingComponent,
	args: {
		onSubmit: fn(),
	},
} satisfies Meta<typeof FlightBookingComponent>;

export default meta;

type Story = StoryObj<typeof meta>;

async function looseGetInteractiveElement(
	testId: string,
	label: string,
	step: StepFunction,
) {
	let element: HTMLElement | null = null;
	await step(
		`Get element by test ID '${testId}' or label '${label}'`,
		async () => {
			element = await waitFor(function getElement() {
				const candidates = [
					screen.queryByTestId(testId),
					...screen.queryAllByLabelText(label, { exact: false }),
					...screen.queryAllByPlaceholderText(label, { exact: false }),
					...screen.queryAllByText(label, { exact: false }),
				];

				// Return the first interactive element
				const interactive = candidates.find((el) => {
					if (!el) {
						return false;
					}
					if (
						el.getAttribute('disabled') === '' ||
						el.getAttribute('aria-disabled') === 'true'
					) {
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

				return interactive ?? null;
			});
		},
	);
	return element!;
}

export const Initial: Story = {};

export const FlightPicker: Story = {
	play: async ({ step }) => {
		const fromFlightTrigger = await looseGetInteractiveElement(
			'flight-trigger-from',
			'From',
			step,
		);
		await expect(fromFlightTrigger).toBeInTheDocument();

		await userEvent.click(fromFlightTrigger);
		await expect(
			await looseGetInteractiveElement('MEL', 'MEL', step),
		).toBeInTheDocument();
	},
};

export const DatePicker: Story = {
	play: async ({ step }) => {
		await userEvent.click(
			await looseGetInteractiveElement(
				'date-trigger-departure',
				'Departure Date',
				step,
			),
		);
		await expect(
			await looseGetInteractiveElement('date-27', '27', step),
		).toBeInTheDocument();
	},
};

export const ReturnDatePickerIsUnavailableWhenOneWaySelected: Story = {
	play: async ({ step }) => {
		await userEvent.click(
			await looseGetInteractiveElement('one-way', 'One Way', step),
		);

		const returnDatePicker = await looseGetInteractiveElement(
			'date-trigger-return',
			'Return Date',
			step,
		);

		// If the return datepicker exists, ensure it's disabled by trying to open it
		if (returnDatePicker) {
			await userEvent.click(returnDatePicker);
			const date15 = await looseGetInteractiveElement('date-15', '15', step);
			await expect(date15).toBeNull();
		} else {
			await expect(returnDatePicker).toBeNull();
		}
	},
};

export const Submitted: Story = {
	play: async ({ canvasElement, args, step }) => {
		await step('Enable return flight', async () => {
			const returnToggle = await looseGetInteractiveElement(
				'return',
				'Return',
				step,
			);
			await userEvent.click(returnToggle);
		});

		await step('Select fromt flight', async () => {
			const fromFlightTrigger = await looseGetInteractiveElement(
				'flight-trigger-from',
				'From',
				step,
			);
			await expect(fromFlightTrigger).toBeInTheDocument();

			await userEvent.click(fromFlightTrigger);

			const melbourneAirport = await looseGetInteractiveElement(
				'airport-MEL',
				'MEL',
				step,
			);
			await userEvent.click(melbourneAirport);
		});

		await step('Select to flight', async () => {
			const toFlightTrigger = await looseGetInteractiveElement(
				'flight-trigger-to',
				'To',
				step,
			);
			await expect(toFlightTrigger).toBeInTheDocument();

			await userEvent.click(toFlightTrigger);

			const laxAirport = await looseGetInteractiveElement(
				'airport-LAX',
				'LAX',
				step,
			);
			await userEvent.click(laxAirport);
		});

		await step('Select departure date', async () => {
			await userEvent.click(
				await looseGetInteractiveElement(
					'date-trigger-departure',
					'Departure Date',
					step,
				),
			);
			const date = await looseGetInteractiveElement('date-27', '27', step);
			await expect(date).toBeInTheDocument();
			await userEvent.click(date);
			await userEvent.click(canvasElement); // dismiss datepicker popover
		});

		await step('Select return date', async () => {
			await userEvent.click(
				await looseGetInteractiveElement(
					'date-trigger-return',
					'Return Date',
					step,
				),
			);
			const date = await looseGetInteractiveElement('date-28', '28', step);
			await expect(date).toBeInTheDocument();
			await userEvent.click(date);
			await userEvent.click(canvasElement); // dismiss datepicker popover
		});

		await userEvent.click(
			await looseGetInteractiveElement(
				'search-flights',
				'Search Flights',
				step,
			),
		);
		await expect(args.onSubmit).toHaveBeenCalledOnce();
	},
};
