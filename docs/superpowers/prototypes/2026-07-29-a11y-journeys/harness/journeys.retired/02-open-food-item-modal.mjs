// Journey: open the food-item modal and scan while it is open.
//
// This is the journey that justifies the whole approach. A modal's
// accessibility -- dialog role, accessible name, focus containment, whether the
// page behind it is hidden from the a11y tree -- exists only while it is open,
// and a cold page-load scan can never see it.
export default {
	id: 'open-food-item-modal',
	description: 'Restaurant detail -> click a menu item -> scan with the modal open',

	async run(page, { baseUrl, scan }) {
		await page.goto(`${baseUrl}/restaurants/1`, { waitUntil: 'domcontentloaded' });

		await page.getByRole('heading', { name: 'To eat' }).waitFor({ state: 'visible' });
		await scan('menu-closed');

		await page.getByRole('heading', { name: 'Cheeseburger' }).click();

		// The confirm button is the last thing the modal renders.
		await page.getByRole('button', { name: 'confirm' }).waitFor({ state: 'visible' });
		await scan('modal-open');

		// Exercise the modal's own controls so quantity state is non-default.
		await page.getByRole('button', { name: 'increase quantity by one' }).click();
		await scan('modal-quantity-changed');

		return {
			endedAt: new URL(page.url()).pathname,
			modalOpen: await page.getByRole('button', { name: 'confirm' }).isVisible(),
		};
	},
};
