// Deterministic network for the app under test.
//
// mealdrop's api/index.ts calls a live Netlify function, its restaurant photos
// come from images.pexels.com, and GlobalStyle.tsx pulls two webfont families
// from fonts.gstatic.com. Left alone, an a11y score would depend on whether the
// sandbox had internet and on whatever the live endpoint returned that day.
//
// One catch-all handler does all the dispatching. Registering several
// overlapping context.route() globs and relying on their precedence is a
// footgun; a single handler with explicit branches cannot be got wrong.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const FIXTURES = new URL('../fixtures/', import.meta.url).pathname;
const read = (name) => readFileSync(join(FIXTURES, name), 'utf8');

// 1x1 transparent PNG. Enough for layout to resolve an <img> without a network
// trip; alt-text rules do not care about pixel content.
const BLANK_PNG = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
	'base64',
);

const isLocal = (url) =>
	url.startsWith('http://127.0.0.1') || url.startsWith('http://localhost');

/**
 * Install the network stub. Returns a mutable log so a caller can assert that
 * nothing unexpected tried to leave the machine.
 *
 * `stubImages: false` lets real photos through, so the effect of image loading
 * on colour-contrast can be measured rather than assumed.
 */
export async function installMocks(context, { stubImages = true } = {}) {
	const log = { api: 0, images: 0, fonts: 0, unexpected: [] };

	await context.route('**', (route) => {
		const url = route.request().url();

		if (isLocal(url)) {
			route.continue();
			return;
		}

		// The app's own data API.
		if (url.includes('/.netlify/functions/restaurants')) {
			const params = new URL(url).searchParams;
			const id = params.get('id');
			const category = params.get('category');

			let body;
			if (id) body = read(`restaurant-${id}.json`);
			else if (category) body = read('restaurants-burgers.json');
			else body = read('restaurants.json');

			log.api++;
			route.fulfill({
				status: 200,
				contentType: 'application/json',
				headers: { 'access-control-allow-origin': '*' },
				body,
			});
			return;
		}

		// Restaurant photography.
		// Restaurant photography (pexels/unsplash) and the category tiles, which
		// come off a CloudFront distribution.
		if (
			url.includes('images.pexels.com') ||
			url.includes('images.unsplash.com') ||
			url.includes('cloudfront.net')
		) {
			log.images++;
			if (stubImages) {
				route.fulfill({ status: 200, contentType: 'image/png', body: BLANK_PNG });
			} else {
				route.continue();
			}
			return;
		}

		// Webfonts. Aborted deliberately: the fallback face changes text metrics
		// but not colour, and axe reads font-size/weight from CSS, so contrast
		// thresholds are unaffected. Recorded so the choice stays visible.
		if (url.includes('fonts.gstatic.com') || url.includes('fonts.googleapis.com')) {
			log.fonts++;
			route.abort('blockedbyclient');
			return;
		}

		log.unexpected.push(url);
		route.abort('blockedbyclient');
	});

	return log;
}
