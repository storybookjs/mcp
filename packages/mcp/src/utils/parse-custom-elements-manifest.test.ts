import { describe, expect, test } from 'vitest';
import {
	findDeclarationForTag,
	parseCemDeclaration,
	parseCustomElementsManifest,
} from './parse-custom-elements-manifest.ts';
import type { CemClassDeclaration, CustomElementsManifest } from './parse-custom-elements-manifest.ts';

// ─── fixtures ─────────────────────────────────────────────────────────────────

const buttonDecl: CemClassDeclaration = {
	kind: 'class',
	name: 'JhButton',
	tagName: 'jh-button',
	customElement: true,
	description: 'A button web component.',
	members: [
		{
			kind: 'field',
			name: 'variant',
			type: { text: '"primary" | "secondary"' },
			default: '"primary"',
			description: 'Visual variant',
		},
		{
			kind: 'field',
			name: 'disabled',
			type: { text: 'boolean' },
			default: 'false',
		},
		// @state field — should be excluded from props
		{
			kind: 'field',
			name: '_open',
			privacy: 'private',
			type: { text: 'boolean' },
		},
		// static field — should be excluded
		{
			kind: 'field',
			name: 'observedAttributes',
			static: true,
			type: { text: 'string[]' },
		},
	],
	attributes: [
		{
			name: 'variant',
			type: { text: '"primary" | "secondary"' },
			default: '"primary"',
			description: 'Visual variant',
			fieldName: 'variant',
		},
		{
			name: 'disabled',
			type: { text: 'boolean' },
			fieldName: 'disabled',
		},
	],
	events: [
		{ name: 'jh-click', description: 'Fired when clicked', type: { text: 'CustomEvent<void>' } },
	],
	slots: [
		{ name: '', description: 'Default button content' },
		{ name: 'icon', description: 'Leading icon' },
	],
	cssProperties: [
		{
			name: '--jh-button-bg',
			type: { text: 'color' },
			default: '#0062cc',
			description: 'Background color',
		},
	],
	cssParts: [{ name: 'base', description: 'The root element' }],
};

const minimalCem: CustomElementsManifest = {
	schemaVersion: '2.1.0',
	modules: [
		{
			kind: 'javascript-module',
			path: 'src/jh-button.ts',
			declarations: [buttonDecl],
		},
	],
};

// ─── parseCemDeclaration ──────────────────────────────────────────────────────

describe('parseCemDeclaration', () => {
	test('includes public fields in props', () => {
		const result = parseCemDeclaration(buttonDecl);
		expect(Object.keys(result.props)).toEqual(['variant', 'disabled']);
	});

	test('excludes private fields from props', () => {
		const result = parseCemDeclaration(buttonDecl);
		expect(result.props).not.toHaveProperty('_open');
	});

	test('excludes static fields from props', () => {
		const result = parseCemDeclaration(buttonDecl);
		expect(result.props).not.toHaveProperty('observedAttributes');
	});

	test('maps field metadata to props entries', () => {
		const result = parseCemDeclaration(buttonDecl);
		expect(result.props['variant']).toEqual({
			description: 'Visual variant',
			type: '"primary" | "secondary"',
			defaultValue: '"primary"',
			required: false,
		});
	});

	test('maps attributes correctly', () => {
		const result = parseCemDeclaration(buttonDecl);
		expect(result.attributes['variant']).toEqual({
			description: 'Visual variant',
			type: '"primary" | "secondary"',
			defaultValue: '"primary"',
			fieldName: 'variant',
		});
	});

	test('maps events with type and description', () => {
		const result = parseCemDeclaration(buttonDecl);
		expect(result.events['jh-click']).toEqual({
			description: 'Fired when clicked',
			type: 'CustomEvent<void>',
		});
	});

	test('maps empty slot name to "(default)"', () => {
		const result = parseCemDeclaration(buttonDecl);
		expect(result.slots).toHaveProperty('(default)');
		expect(result.slots['(default)']).toEqual({ description: 'Default button content' });
	});

	test('preserves named slots', () => {
		const result = parseCemDeclaration(buttonDecl);
		expect(result.slots['icon']).toEqual({ description: 'Leading icon' });
	});

	test('maps CSS custom properties', () => {
		const result = parseCemDeclaration(buttonDecl);
		expect(result.cssProperties['--jh-button-bg']).toEqual({
			description: 'Background color',
			type: 'color',
			defaultValue: '#0062cc',
		});
	});

	test('maps CSS parts', () => {
		const result = parseCemDeclaration(buttonDecl);
		expect(result.cssParts['base']).toEqual({ description: 'The root element' });
	});

	test('handles declaration with no optional arrays gracefully', () => {
		const bare: CemClassDeclaration = { kind: 'class', name: 'Bare', customElement: true };
		const result = parseCemDeclaration(bare);
		expect(result.props).toEqual({});
		expect(result.attributes).toEqual({});
		expect(result.events).toEqual({});
		expect(result.slots).toEqual({});
		expect(result.cssProperties).toEqual({});
		expect(result.cssParts).toEqual({});
	});
});

// ─── findDeclarationForTag ────────────────────────────────────────────────────

describe('findDeclarationForTag', () => {
	test('finds declaration by exact tagName', () => {
		const decl = findDeclarationForTag(minimalCem, 'jh-button');
		expect(decl?.name).toBe('JhButton');
	});

	test('returns undefined when tagName does not match', () => {
		const decl = findDeclarationForTag(minimalCem, 'jh-input');
		expect(decl).toBeUndefined();
	});

	test('returns first customElement declaration when tagName is undefined', () => {
		const decl = findDeclarationForTag(minimalCem, undefined);
		expect(decl?.name).toBe('JhButton');
	});

	test('skips non-class declarations', () => {
		const cem: CustomElementsManifest = {
			schemaVersion: '2.1.0',
			modules: [
				{
					kind: 'javascript-module',
					path: 'src/mixins.ts',
					declarations: [
						{ kind: 'mixin' as any, name: 'Mixin', tagName: 'jh-button' } as any,
						buttonDecl,
					],
				},
			],
		};
		const decl = findDeclarationForTag(cem, 'jh-button');
		expect(decl?.name).toBe('JhButton');
	});
});

// ─── parseCustomElementsManifest ─────────────────────────────────────────────

describe('parseCustomElementsManifest', () => {
	test('returns parsed result for matching tagName', () => {
		const result = parseCustomElementsManifest(minimalCem, 'jh-button');
		expect(result).toBeDefined();
		expect(Object.keys(result!.props)).toContain('variant');
	});

	test('returns undefined when tagName does not exist in manifest', () => {
		const result = parseCustomElementsManifest(minimalCem, 'jh-does-not-exist');
		expect(result).toBeUndefined();
	});

	test('returns first custom element when no tagName provided', () => {
		const result = parseCustomElementsManifest(minimalCem);
		expect(result).toBeDefined();
		expect(Object.keys(result!.props)).toContain('variant');
	});
});
