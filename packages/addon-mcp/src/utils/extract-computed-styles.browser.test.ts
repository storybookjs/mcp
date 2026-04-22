import { afterEach, describe, expect, it } from 'vitest';

import {
	COMPUTED_STYLES_BASELINE_IFRAME_ID,
	extractComputedStyles,
	setupComputedStylesBaseline,
	teardownComputedStylesBaseline,
} from './extract-computed-styles.ts';

afterEach(() => {
	teardownComputedStylesBaseline(document);
	document.head.innerHTML = '';
	document.body.innerHTML = '';
});

describe('extractComputedStyles', () => {
	it('captures inherited and hidden computed styles for the full story subtree', () => {
		const style = document.createElement('style');
		style.textContent = `
			#story-root {
				color: rgb(255, 0, 0);
			}

			#story-root [data-testid="cta"] {
				background-color: rgb(0, 128, 0);
				display: flex;
				gap: 8px;
			}

			#story-root .hidden {
				display: none;
			}
		`;
		document.head.appendChild(style);

		const root = document.createElement('div');
		root.id = 'story-root';
		root.innerHTML = `
			<button data-testid="cta" data-variant="primary">
				<span>Save</span>
			</button>
			<p aria-label="inherited-copy">Inherited</p>
			<div class="hidden">Hidden</div>
		`;
		document.body.appendChild(root);

		const styles = extractComputedStyles(root);

		expect(styles.map((entry) => entry.selector)).toEqual([
			'div#story-root > button[data-testid="cta"][data-variant="primary"]',
			'div#story-root > button[data-testid="cta"][data-variant="primary"] > span',
			'div#story-root > p[aria-label="inherited-copy"]',
			'div#story-root > div.hidden',
		]);
		expect(styles[0]?.styles['background-color']).toBe('rgb(0, 128, 0)');
		expect(styles[0]?.styles.display).toBe('flex');
		expect(styles[2]?.styles.color).toBe('rgb(255, 0, 0)');
		expect(styles[3]?.styles.display).toBe('none');
	});

	it('drops elements with no meaningful non-default computed styles after filtering', () => {
		const root = document.createElement('span');
		root.id = 'story-root';
		root.innerHTML = `
			<em></em>
		`;
		document.body.appendChild(root);

		const styles = extractComputedStyles(root);

		expect(styles).toEqual([]);
	});

	it('uses a same-tag baseline so intrinsic control styles are not reported as story styling', () => {
		const root = document.createElement('div');
		root.id = 'story-root';
		root.innerHTML = '<input type="checkbox">';
		document.body.appendChild(root);

		const styles = extractComputedStyles(root);

		expect(styles).toEqual([]);
	});

	it('uses non-internal classes in selectors and compresses noisy longhands', () => {
		const style = document.createElement('style');
		style.textContent = `
			.storybook-button {
				font-family: 'Nunito Sans', 'Helvetica Neue', Helvetica, Arial, sans-serif;
				font-weight: 700;
				border: 0;
				border-radius: 3em;
				cursor: pointer;
				display: inline-block;
				line-height: 1;
			}

			.storybook-button--secondary {
				color: rgb(51, 51, 51);
				background-color: transparent;
				box-shadow: rgba(0, 0, 0, 0.15) 0px 0px 0px 1px inset;
			}

			.storybook-button--medium {
				font-size: 14px;
				padding: 11px 20px;
			}
		`;
		document.head.appendChild(style);

		const root = document.createElement('div');
		root.innerHTML = `
			<div class="sb-show-main">
				<div>
					<button type="button" class="storybook-button storybook-button--medium storybook-button--secondary">
						Button
					</button>
				</div>
			</div>
		`;
		document.body.appendChild(root);

		const styles = extractComputedStyles(root);

		expect(styles).toHaveLength(1);
		expect(styles[0]).toEqual({
			selector:
				'button.storybook-button.storybook-button--medium.storybook-button--secondary[type="button"]',
			tagName: 'button',
			styles: expect.objectContaining({
				'background-color': 'rgba(0, 0, 0, 0)',
				border: '0',
				'border-radius': '42px',
				'box-shadow': 'rgba(0, 0, 0, 0.15) 0px 0px 0px 1px inset',
				color: 'rgb(51, 51, 51)',
				cursor: 'pointer',
				'font-family': '"Nunito Sans", "Helvetica Neue", Helvetica, Arial, sans-serif',
				'font-size': '14px',
				'font-weight': '700',
				'line-height': '14px',
				padding: '11px 20px',
			}),
		});
		expect(styles[0]?.styles).not.toHaveProperty('width');
		expect(styles[0]?.styles).not.toHaveProperty('inline-size');
		expect(styles[0]?.styles).not.toHaveProperty('padding-top');
		expect(styles[0]?.styles).not.toHaveProperty('border-top-left-radius');
		expect(styles[0]?.styles).not.toHaveProperty('border-top-width');
		expect(styles[0]?.styles).not.toHaveProperty('animation-direction');
	});

	it('uses a same-tag baseline so intrinsic control styles are not reported as story styling', () => {
		const root = document.createElement('div');
		root.id = 'story-root';
		root.innerHTML = '<input type="checkbox">';
		document.body.appendChild(root);

		const styles = extractComputedStyles(root);

		expect(styles).toEqual([]);
	});

	it('creates and tears down a baseline iframe when called without prior setup', () => {
		const root = document.createElement('div');
		root.id = 'story-root';
		root.style.color = 'rgb(255, 0, 0)';
		document.body.appendChild(root);

		expect(document.getElementById(COMPUTED_STYLES_BASELINE_IFRAME_ID)).toBeNull();

		extractComputedStyles(root);

		expect(document.getElementById(COMPUTED_STYLES_BASELINE_IFRAME_ID)).toBeNull();
	});

	it('reuses a prepared baseline iframe when setup ran beforehand', () => {
		const cleanup = setupComputedStylesBaseline(document);
		const baselineIframe = document.getElementById(COMPUTED_STYLES_BASELINE_IFRAME_ID);

		const root = document.createElement('div');
		root.id = 'story-root';
		root.style.color = 'rgb(255, 0, 0)';
		document.body.appendChild(root);

		extractComputedStyles(root);

		expect(document.getElementById(COMPUTED_STYLES_BASELINE_IFRAME_ID)).toBe(baselineIframe);

		cleanup();
		expect(document.getElementById(COMPUTED_STYLES_BASELINE_IFRAME_ID)).toBeNull();
	});
});
