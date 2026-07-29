#!/usr/bin/env node
// Inject known accessibility regressions into a copy of the app.
//
// This is the sensitivity test for the whole metric. A baseline number proves
// only that the harness runs; it proves nothing about whether the harness would
// notice an agent making the app worse. Each mutation below targets a different
// axe rule and a different detection mechanism:
//
//   image-alt      - static attribute, would also be caught by a linter
//   color-contrast - needs real rendering and computed style; the rule most
//                    often lost in jsdom-based setups
//   button-name    - accessible-name computation, needs the a11y tree
//
//   node make-mutant.mjs <appDir>
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const app = process.argv[2];
if (!app) throw new Error('usage: make-mutant.mjs <appDir>');

const edits = [
	{
		rule: 'image-alt',
		file: 'src/components/RestaurantCard/RestaurantCard.tsx',
		from: 'src={photoUrl} alt="restaurant"',
		to: 'src={photoUrl}',
	},
	{
		rule: 'color-contrast',
		file: 'src/components/Badge/Badge.tsx',
		from: '      color: ${color.badgeText};',
		to: '      color: #d8d8d8;',
	},
	{
		rule: 'button-name',
		file: 'src/components/Header/Header.tsx',
		from: '<Button aria-label="food cart" icon="cart"',
		to: '<Button icon="cart"',
	},
];

for (const edit of edits) {
	const path = join(app, edit.file);
	const before = readFileSync(path, 'utf8');
	if (!before.includes(edit.from)) {
		throw new Error(`anchor not found for ${edit.rule} in ${edit.file}: ${edit.from}`);
	}
	writeFileSync(path, before.replace(edit.from, edit.to));
	console.log(`applied ${edit.rule} -> ${edit.file}`);
}
