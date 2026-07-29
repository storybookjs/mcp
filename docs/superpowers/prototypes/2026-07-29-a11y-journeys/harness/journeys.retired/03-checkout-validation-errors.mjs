// Journey: fill the cart, reach checkout, and force the form into its error state.
//
// Form error messaging is the thing a cold scan cannot reach: the association
// between an input and its error text (aria-describedby, aria-invalid,
// role=alert) only exists after a failed submit.
//
// Locators here deliberately avoid accessible names for the *cart* control.
// Driving by accessible name is normally good practice, but a journey that
// locates by accessible name cannot survive an accessible-name regression --
// the defect deletes the locator measuring it, the journey fails, and the run
// silently reports fewer violations than the healthy app. Structural hooks
// (data-testid, DOM position) keep the journey alive so the scan can record the
// defect.
export default {
	id: 'checkout-validation-errors',
	description: 'Add item to cart -> cart menu -> checkout -> submit empty form -> scan errors',

	async run(page, { baseUrl, scan }) {
		await page.goto(`${baseUrl}/restaurants/1`, { waitUntil: 'domcontentloaded' });
		await page.getByRole('heading', { name: 'To eat' }).waitFor({ state: 'visible' });

		// Put something in the cart, otherwise Checkout stays disabled.
		await page.getByRole('heading', { name: 'Cheeseburger' }).click();
		await page.getByRole('button', { name: 'confirm' }).click();

		// The cart toggle is the last button in the header; located structurally
		// so a missing aria-label does not break the journey.
		await page.getByTestId('header').getByRole('button').last().click();
		await scan('cart-open');

		await page.getByRole('button', { name: 'Checkout' }).click();
		await page.getByLabel('First name').waitFor({ state: 'visible' });
		await scan('checkout-empty');

		// Submit empty to render every field's error message.
		await page.getByRole('button', { name: 'Next' }).click();
		await page.getByText('Required').first().waitFor({ state: 'visible' });
		await scan('checkout-errors');

		return {
			endedAt: new URL(page.url()).pathname,
			errorsShown: await page.getByText('Required').count(),
		};
	},
};
