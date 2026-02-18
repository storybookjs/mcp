import { describe, it, expect } from 'vitest';
import { formatComponentManifest, formatManifestsToLists } from './format-manifest';
import type { AllManifests, ComponentManifest } from '../types';

describe('formatComponentManifest', () => {
	const manifest: ComponentManifest = {
		id: 'test-component',
		path: 'src/components/TestComponent.tsx',
		name: 'TestComponent',
	};

	it('should format component using markdown', () => {
		const result = formatComponentManifest(manifest);
		expect(result).toContain('# TestComponent');
	});
});

describe('formatManifestsToLists', () => {
	const manifests: AllManifests = {
		componentManifest: {
			v: 1,
			components: {
				button: {
					id: 'button',
					name: 'Button',
					path: 'src/components/Button.tsx',
				},
			},
		},
	};

	it('should format manifests using markdown', () => {
		const result = formatManifestsToLists(manifests);
		expect(result).toContain('# Components');
		expect(result).toContain('- Button (button)');
	});
});
