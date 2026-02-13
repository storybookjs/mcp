import { describe, it, expect } from 'vitest';
import {
	formatComponentManifest,
	formatManifestsToLists,
	formatMultiSourceManifestsToLists,
	formatStoryDocumentation,
} from './format-manifest';
import type { AllManifests, ComponentManifest, SourceManifests } from '../types';

describe('formatComponentManifest', () => {
	const manifest: ComponentManifest = {
		id: 'test-component',
		path: 'src/components/TestComponent.tsx',
		name: 'TestComponent',
	};

	it('should use markdown formatter by default', () => {
		const result = formatComponentManifest(manifest);
		expect(result).toContain('# TestComponent');
	});

	it('should use markdown formatter when format is "markdown"', () => {
		const result = formatComponentManifest(manifest, 'markdown');
		expect(result).toContain('# TestComponent');
	});

	it('should use xml formatter when format is "xml"', () => {
		const result = formatComponentManifest(manifest, 'xml');
		expect(result).toContain('<component>');
		expect(result).toContain('<name>TestComponent</name>');
		expect(result).toContain('<id>test-component</id>');
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

	it('should use markdown formatter by default', () => {
		const result = formatManifestsToLists(manifests);
		expect(result).toContain('# Components');
		expect(result).toContain('- Button (button)');
	});

	it('should use markdown formatter when format is "markdown"', () => {
		const result = formatManifestsToLists(manifests, 'markdown');
		expect(result).toContain('# Components');
		expect(result).toContain('- Button (button)');
	});

	it('should use xml formatter when format is "xml"', () => {
		const result = formatManifestsToLists(manifests, 'xml');
		expect(result).toContain('<components>');
		expect(result).toContain('<name>Button</name>');
		expect(result).toContain('<id>button</id>');
	});
});

describe('formatMultiSourceManifestsToLists', () => {
	const sources: SourceManifests[] = [
		{
			source: { id: 'local', title: 'Local' },
			componentManifest: {
				v: 1,
				components: {
					button: { id: 'button', name: 'Button', path: 'src/Button.tsx', summary: 'A button' },
				},
			},
			docsManifest: {
				v: 1,
				docs: {
					'getting-started': {
						id: 'getting-started',
						name: 'Getting Started',
						title: 'Getting Started Guide',
						path: 'docs/getting-started.mdx',
						content: 'Welcome to the docs',
					},
				},
			},
		},
		{
			source: { id: 'remote', title: 'Remote', url: 'http://remote.example.com' },
			componentManifest: {
				v: 1,
				components: {
					badge: { id: 'badge', name: 'Badge', path: 'src/Badge.tsx', summary: 'A badge' },
				},
			},
		},
	];

	it('should format multi-source manifests as markdown', () => {
		const result = formatMultiSourceManifestsToLists(sources, 'markdown');
		expect(result).toContain('# Local');
		expect(result).toContain('Button (button)');
		expect(result).toContain('## Docs');
		expect(result).toContain('Getting Started Guide');
		expect(result).toContain('# Remote');
		expect(result).toContain('Badge (badge)');
	});

	it('should format multi-source manifests as xml', () => {
		const result = formatMultiSourceManifestsToLists(sources, 'xml');
		expect(result).toMatchInlineSnapshot(`
			"<sources>
			<source id="local" title="Local">
			<components>
			<component>
			<id>button</id>
			<name>Button</name>
			<summary>
			A button
			</summary>
			</component>
			</components>
			<docs>
			<doc>
			<id>getting-started</id>
			<title>Getting Started Guide</title>
			<summary>
			Welcome to the docs
			</summary>
			</doc>
			</docs>
			</source>
			<source id="remote" title="Remote">
			<components>
			<component>
			<id>badge</id>
			<name>Badge</name>
			<summary>
			A badge
			</summary>
			</component>
			</components>
			</source>
			</sources>"
		`);
	});

	it('should show errors for failed sources in xml', () => {
		const withError: SourceManifests[] = [
			{
				source: { id: 'broken', title: 'Broken', url: 'http://broken.example.com' },
				componentManifest: { v: 1, components: {} },
				error: 'Failed to fetch: 401 Unauthorized',
			},
		];
		const result = formatMultiSourceManifestsToLists(withError, 'xml');
		expect(result).toContain('<error>Failed to fetch: 401 Unauthorized</error>');
	});
});

describe('formatStoryDocumentation', () => {
	const manifest: ComponentManifest = {
		id: 'button',
		name: 'Button',
		path: 'src/Button.tsx',
		import: 'import { Button } from "@my-lib/ui";',
		stories: [
			{
				name: 'Primary',
				description: 'The primary variant',
				snippet: 'const Primary = () => <Button variant="primary" />;',
			},
		],
	};

	it('should format story as xml', () => {
		const result = formatStoryDocumentation(manifest, 'Primary', 'xml');
		expect(result).toContain('<story_documentation>');
		expect(result).toContain('<component_name>Button</component_name>');
		expect(result).toContain('<story_name>Primary</story_name>');
		expect(result).toContain('<story_description>');
		expect(result).toContain('The primary variant');
		expect(result).toContain('import { Button } from "@my-lib/ui";');
		expect(result).toContain('<Button variant="primary" />');
	});
});
