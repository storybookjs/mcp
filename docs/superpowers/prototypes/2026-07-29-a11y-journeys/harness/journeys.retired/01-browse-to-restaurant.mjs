// Journey: land on the home page, pick a restaurant, read its menu.
//
// Scans at every meaningful state rather than only at the end. Scanning once at
// the end is measurably wrong: an alt-text regression on the home page is
// invisible by the time the journey has navigated away from it.
export default {
	id: 'browse-to-restaurant',
	description: 'Home page -> restaurant card -> restaurant detail page with menu rendered',

	async run(page, { baseUrl, scan }) {
		await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded' });

		// Cards only exist after the restaurants fetch resolves; before that the
		// carousel holds skeletons, and scanning skeletons measures nothing.
		await page.getByTestId('restaurant-card').first().waitFor({ state: 'visible' });
		await scan('home-loaded');

		await page.getByTestId('restaurant-card').first().click();

		// The detail page renders its menu sections last.
		await page.getByRole('heading', { name: 'To eat' }).waitFor({ state: 'visible' });
		await scan('restaurant-detail');

		return { endedAt: new URL(page.url()).pathname };
	},
};
