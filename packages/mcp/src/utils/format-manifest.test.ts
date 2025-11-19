import { describe, it, expect } from 'vitest';
import {
	formatComponentManifest,
	formatComponentManifestMapToList,
} from './format-manifest';
import type { ComponentManifest, ComponentManifestMap } from '../types';
import fullManifestFixture from '../../fixtures/full-manifest.fixture.json' with { type: 'json' };
import withErrorsFixture from '../../fixtures/with-errors.fixture.json' with { type: 'json' };

describe('formatComponentManifest', () => {
	it('formats all full fixtures', () => {
		expect(
			formatComponentManifest(fullManifestFixture.components.button),
		).toMatchSnapshot();
		expect(
			formatComponentManifest(fullManifestFixture.components.card),
		).toMatchSnapshot();
		expect(
			formatComponentManifest(fullManifestFixture.components.input),
		).toMatchSnapshot();
	});

	describe('component name', () => {
		it('should include component name in component_name tag', () => {
			const manifest: ComponentManifest = {
				id: 'test-component',
				path: 'src/components/TestComponent.tsx',
				name: 'TestComponent',
			};

			const result = formatComponentManifest(manifest);

			expect(result).toMatchInlineSnapshot(`
				"# TestComponent

				ID: test-component"
			`);
		});
	});

	describe('description section', () => {
		it('should include description when provided', () => {
			const manifest: ComponentManifest = {
				id: 'button',
				path: 'src/components/Button.tsx',
				name: 'Button',
				description: 'A simple button component',
			};

			const result = formatComponentManifest(manifest);

			expect(result).toMatchInlineSnapshot(`
				"# Button

				ID: button

				A simple button component"
			`);
		});

		it('should handle multi-line descriptions', () => {
			const manifest: ComponentManifest = {
				id: 'button',
				path: 'src/components/Button.tsx',
				name: 'Button',
				description:
					'A versatile button component.\n\nSupports multiple variants and sizes.',
			};

			const result = formatComponentManifest(manifest);

			expect(result).toMatchInlineSnapshot(`
				"# Button

				ID: button

				A versatile button component.

				Supports multiple variants and sizes."
			`);
		});

		it('should omit description section when not provided', () => {
			const manifest: ComponentManifest = {
				id: 'button',
				name: 'Button',
				path: 'src/components/Button.tsx',
			};

			const result = formatComponentManifest(manifest);

			expect(result).toMatchInlineSnapshot(`
				"# Button

				ID: button"
			`);
		});
	});

	describe('stories section', () => {
		it('should format a single story', () => {
			const manifest: ComponentManifest = {
				id: 'button',
				name: 'Button',
				path: 'src/components/Button.tsx',
				import: 'import { Button } from "@/components";',
				stories: [
					{
						name: 'Primary',
						description: 'A primary button variant',
						snippet: '<Button variant="primary">Click me</Button>',
					},
				],
			};

			const result = formatComponentManifest(manifest);

			expect(result).toMatchInlineSnapshot(`
				"# Button

				ID: button

				## Stories

				### Primary

				A primary button variant

				\`\`\`
				import { Button } from "@/components";

				<Button variant="primary">Click me</Button>
				\`\`\`"
			`);
		});

		it('should format multiple stories', () => {
			const manifest: ComponentManifest = {
				id: 'button',
				name: 'Button',
				path: 'src/components/Button.tsx',
				import: 'import { Button } from "@/components";',
				stories: [
					{
						name: 'Primary',
						snippet: '<Button variant="primary">Primary</Button>',
					},
					{
						name: 'Secondary',
						snippet: '<Button variant="secondary">Secondary</Button>',
					},
				],
			};

			const result = formatComponentManifest(manifest);

			expect(result).toMatchInlineSnapshot(`
				"# Button

				ID: button

				## Stories

				### Primary

				\`\`\`
				import { Button } from "@/components";

				<Button variant="primary">Primary</Button>
				\`\`\`

				### Secondary

				\`\`\`
				import { Button } from "@/components";

				<Button variant="secondary">Secondary</Button>
				\`\`\`"
			`);
		});

		it('should format PascalCase story names correctly', () => {
			const manifest: ComponentManifest = {
				id: 'button',
				name: 'Button',
				path: 'src/components/Button.tsx',
				stories: [
					{
						name: 'WithIcon',
						snippet: '<Button icon={<Icon />}>Click me</Button>',
					},
					{
						name: 'DisabledState',
						snippet: '<Button disabled>Disabled</Button>',
					},
				],
			};

			const result = formatComponentManifest(manifest);

			expect(result).toMatchInlineSnapshot(`
				"# Button

				ID: button

				## Stories

				### With Icon

				\`\`\`
				<Button icon={<Icon />}>Click me</Button>
				\`\`\`

				### Disabled State

				\`\`\`
				<Button disabled>Disabled</Button>
				\`\`\`"
			`);
		});

		it('should handle stories without description', () => {
			const manifest: ComponentManifest = {
				id: 'button',
				name: 'Button',
				path: 'src/components/Button.tsx',
				stories: [
					{
						name: 'Simple',
						snippet: '<Button>Simple</Button>',
					},
				],
			};

			const result = formatComponentManifest(manifest);

			expect(result).toMatchInlineSnapshot(`
				"# Button

				ID: button

				## Stories

				### Simple

				\`\`\`
				<Button>Simple</Button>
				\`\`\`"
			`);
		});

		it('should handle stories without import', () => {
			const manifest: ComponentManifest = {
				id: 'button',
				name: 'Button',
				path: 'src/components/Button.tsx',
				stories: [
					{
						name: 'NoImport',
						snippet: '<Button>No Import</Button>',
					},
				],
			};

			const result = formatComponentManifest(manifest);

			expect(result).toMatchInlineSnapshot(`
				"# Button

				ID: button

				## Stories

				### No Import

				\`\`\`
				<Button>No Import</Button>
				\`\`\`"
			`);
		});

		it('should omit stories when no stories are provided', () => {
			const manifest: ComponentManifest = {
				id: 'button',
				name: 'Button',
				path: 'src/components/Button.tsx',
				description: 'A button component',
			};

			const result = formatComponentManifest(manifest);

			expect(result).toMatchInlineSnapshot(`
				"# Button

				ID: button

				A button component"
			`);
		});

		it('should omit stories when stories array is empty', () => {
			const manifest: ComponentManifest = {
				id: 'button',
				name: 'Button',
				path: 'src/components/Button.tsx',
				stories: [],
			};

			const result = formatComponentManifest(manifest);

			expect(result).toMatchInlineSnapshot(`
				"# Button

				ID: button"
			`);
		});
	});

	describe('complete component', () => {
		it('should format a complete component with description and multiple stories', () => {
			const manifest: ComponentManifest = {
				id: 'button',
				name: 'Button',
				path: 'src/components/Button.tsx',
				description:
					'A versatile button component.\n\nSupports multiple variants, sizes, and states.',
				summary: 'A button for user interactions',
				import: 'import { Button } from "@storybook/design-system";',
				stories: [
					{
						name: 'Primary',
						description: 'The primary button variant.',
						snippet:
							'const Primary = () => <Button variant="primary">Click Me</Button>',
					},
					{
						name: 'WithSizes',
						description: 'Buttons in different sizes.',
						snippet:
							'const Sizes = () => (\n  <>\n    <Button size="small">Small</Button>\n    <Button size="large">Large</Button>\n  </>\n)',
					},
				],
			};

			const result = formatComponentManifest(manifest);

			expect(result).toMatchInlineSnapshot(`
				"# Button

				ID: button

				A versatile button component.

				Supports multiple variants, sizes, and states.

				## Stories

				### Primary

				The primary button variant.

				\`\`\`
				import { Button } from "@storybook/design-system";

				const Primary = () => <Button variant="primary">Click Me</Button>
				\`\`\`

				### With Sizes

				Buttons in different sizes.

				\`\`\`
				import { Button } from "@storybook/design-system";

				const Sizes = () => (
				  <>
				    <Button size="small">Small</Button>
				    <Button size="large">Large</Button>
				  </>
				)
				\`\`\`"
			`);
		});
	});

	describe('props section', () => {
		it('should format props from reactDocgen', () => {
			const manifest: ComponentManifest = {
				id: 'button',
				name: 'Button',
				path: 'src/components/Button.tsx',
				reactDocgen: {
					props: {
						variant: {
							description: 'The visual style variant',
							required: false,
							defaultValue: { value: '"primary"', computed: false },
							tsType: {
								name: 'union',
								raw: '"primary" | "secondary"',
								elements: [
									{ name: 'literal', value: '"primary"' },
									{ name: 'literal', value: '"secondary"' },
								],
							},
						},
						disabled: {
							description: 'Whether the button is disabled',
							required: false,
							defaultValue: { value: 'false', computed: false },
							tsType: {
								name: 'boolean',
							},
						},
						onClick: {
							description: 'Click handler',
							required: true,
							tsType: {
								name: 'signature',
								type: 'function',
								signature: {
									arguments: [{ name: 'event', type: { name: 'MouseEvent' } }],
									return: { name: 'void' },
								},
							},
						},
					},
				},
			};

			const result = formatComponentManifest(manifest);

			expect(result).toMatchInlineSnapshot(`
				"# Button

				ID: button

				## Props

				| Name | Type | Description | Required | Default |
				|------|------|-------------|----------|---------|
				| variant | \`"primary" | "secondary"\` | The visual style variant | false | "primary" |
				| disabled | \`boolean\` | Whether the button is disabled | false | false |
				| onClick | \`(event: MouseEvent) => void\` | Click handler | true |  |"
			`);
		});

		it('should handle props with minimal information', () => {
			const manifest: ComponentManifest = {
				id: 'button',
				name: 'Button',
				path: 'src/components/Button.tsx',
				reactDocgen: {
					props: {
						children: {
							tsType: {
								name: 'string',
							},
						},
					},
				},
			};

			const result = formatComponentManifest(manifest);

			expect(result).toMatchInlineSnapshot(`
				"# Button

				ID: button

				## Props

				- children: string"
			`);
		});

		it('should omit props section when reactDocgen is not present', () => {
			const manifest: ComponentManifest = {
				id: 'button',
				name: 'Button',
				path: 'src/components/Button.tsx',
				description: 'A button component',
			};

			const result = formatComponentManifest(manifest);

			expect(result).toMatchInlineSnapshot(`
				"# Button

				ID: button

				A button component"
			`);
		});

		it('should omit props section when reactDocgen has no props', () => {
			const manifest: ComponentManifest = {
				id: 'button',
				name: 'Button',
				path: 'src/components/Button.tsx',
				reactDocgen: {
					props: {},
				},
			};

			const result = formatComponentManifest(manifest);

			expect(result).toMatchInlineSnapshot(`
				"# Button

				ID: button"
			`);
		});
	});
});

describe('formatComponentManifestMapToList', () => {
	it('formats the full manifest fixture', () => {
		const result = formatComponentManifestMapToList(fullManifestFixture);
		expect(result).toMatchSnapshot();
	});

	describe('component list structure', () => {
		it('should format a single component', () => {
			const manifest: ComponentManifestMap = {
				v: 1,
				components: {
					button: {
						id: 'button',
						name: 'Button',
						path: 'src/components/Button.tsx',
					},
				},
			};

			const result = formatComponentManifestMapToList(manifest);

			expect(result).toMatchInlineSnapshot(`
				"# Components

				- Button (button)"
			`);
		});

		it('should format multiple components', () => {
			const manifest: ComponentManifestMap = {
				v: 1,
				components: {
					button: {
						id: 'button',
						name: 'Button',
						path: 'src/components/Button.tsx',
					},
					card: {
						id: 'card',
						name: 'Card',
						path: 'src/components/Card.tsx',
					},
					input: {
						id: 'input',
						name: 'Input',
						path: 'src/components/Input.tsx',
					},
				},
			};

			const result = formatComponentManifestMapToList(manifest);

			expect(result).toMatchInlineSnapshot(`
				"# Components

				- Button (button)
				- Card (card)
				- Input (input)"
			`);
		});
	});

	describe('summary section', () => {
		it('should include summary when provided', () => {
			const manifest: ComponentManifestMap = {
				v: 1,
				components: {
					button: {
						id: 'button',
						name: 'Button',
						path: 'src/components/Button.tsx',
						summary: 'A versatile button component',
					},
				},
			};

			const result = formatComponentManifestMapToList(manifest);

			expect(result).toMatchInlineSnapshot(`
				"# Components

				- Button (button): A versatile button component"
			`);
		});

		it('should prefer summary over description', () => {
			const manifest: ComponentManifestMap = {
				v: 1,
				components: {
					button: {
						id: 'button',
						name: 'Button',
						path: 'src/components/Button.tsx',
						summary: 'Short summary',
						description: 'This is a longer description that should be ignored',
					},
				},
			};

			const result = formatComponentManifestMapToList(manifest);

			expect(result).toContain('Short summary');
			expect(result).not.toContain('longer description');
		});

		it('should use description when summary is not provided', () => {
			const manifest: ComponentManifestMap = {
				v: 1,
				components: {
					button: {
						id: 'button',
						name: 'Button',
						path: 'src/components/Button.tsx',
						description: 'A simple button component',
					},
				},
			};

			const result = formatComponentManifestMapToList(manifest);

			expect(result).toMatchInlineSnapshot(`
				"# Components

				- Button (button): A simple button component"
			`);
		});

		it('should truncate long descriptions to 90 characters', () => {
			const manifest: ComponentManifestMap = {
				v: 1,
				components: {
					button: {
						id: 'button',
						name: 'Button',
						path: 'src/components/Button.tsx',
						description:
							'This is a very long description that exceeds ninety characters and should be truncated with ellipsis',
					},
				},
			};

			const result = formatComponentManifestMapToList(manifest);

			expect(result).toMatchInlineSnapshot(`
				"# Components

				- Button (button): This is a very long description that exceeds ninety characters and should be truncated wit..."
			`);
		});

		it('should not truncate descriptions under 90 characters', () => {
			const manifest: ComponentManifestMap = {
				v: 1,
				components: {
					button: {
						id: 'button',
						name: 'Button',
						path: 'src/components/Button.tsx',
						description:
							'A description with exactly eighty characters is fine and should not be truncated',
					},
				},
			};

			const result = formatComponentManifestMapToList(manifest);

			expect(result).toContain(
				'A description with exactly eighty characters is fine and should not be truncated',
			);
			expect(result).not.toContain('...');
		});

		it('should omit summary section when neither summary nor description provided', () => {
			const manifest: ComponentManifestMap = {
				v: 1,
				components: {
					button: {
						id: 'button',
						name: 'Button',
						path: 'src/components/Button.tsx',
					},
				},
			};

			const result = formatComponentManifestMapToList(manifest);

			expect(result).not.toContain('<summary>');
			expect(result).toMatchInlineSnapshot(`
				"# Components

				- Button (button)"
			`);
		});
	});

	describe('complete manifest', () => {
		it('should format a complete manifest with varied components', () => {
			const manifest: ComponentManifestMap = {
				v: 1,
				components: {
					button: {
						id: 'button',
						name: 'Button',
						path: 'src/components/Button.tsx',
						summary: 'A versatile button component',
					},
					card: {
						id: 'card',
						name: 'Card',
						path: 'src/components/Card.tsx',
						description: 'A flexible container for grouping content',
					},
					input: {
						id: 'input',
						name: 'Input',
						path: 'src/components/Input.tsx',
						summary: 'Text input with validation',
						description:
							'A comprehensive input component with validation, error states, and accessibility features',
					},
					modal: {
						id: 'modal',
						name: 'Modal',
						path: 'src/components/Modal.tsx',
					},
				},
			};

			const result = formatComponentManifestMapToList(manifest);

			expect(result).toMatchInlineSnapshot(`
				"# Components

				- Button (button): A versatile button component
				- Card (card): A flexible container for grouping content
				- Input (input): Text input with validation
				- Modal (modal)"
			`);
		});
	});

	describe('with-errors fixture', () => {
		it('should format success component with mixed stories (only successful ones)', () => {
			const component =
				withErrorsFixture.components['success-component-with-mixed-stories'];
			const result = formatComponentManifest(component);
			expect(result).toMatchInlineSnapshot(`
				"# SuccessWithMixedStories

				ID: success-component-with-mixed-stories

				A component that loaded successfully but has some stories that failed to generate.

				## Stories

				### Working

				This story generated successfully.

				\`\`\`
				import { SuccessWithMixedStories } from '@storybook/design-system';

				const Working = () => <SuccessWithMixedStories text="Hello" />
				\`\`\`

				## Props

				| Name | Type | Description | Required | Default |
				|------|------|-------------|----------|---------|
				| text | \`string\` | The text to display | true |  |
				| variant | \`"primary" | "secondary"\` | The visual variant | false | "primary" |"
			`);
		});

		it('should format error component with success stories', () => {
			const component =
				withErrorsFixture.components['error-component-with-success-stories'];
			const result = formatComponentManifest(component);
			expect(result).toMatchInlineSnapshot(`
				"# ErrorWithSuccessStories

				ID: error-component-with-success-stories

				## Stories

				### Basic

				Even though the component parsing failed, this story's code snippet was generated.

				\`\`\`
				const Basic = () => <ErrorWithSuccessStories>Content</ErrorWithSuccessStories>
				\`\`\`

				### Advanced

				Another successfully generated story despite component-level errors.

				\`\`\`
				const Advanced = () => (
				  <ErrorWithSuccessStories disabled>
				    Advanced Content
				  </ErrorWithSuccessStories>
				)
				\`\`\`"
			`);
		});

		it('should format partial success component (skips failed story)', () => {
			const component = withErrorsFixture.components['partial-success'];
			const result = formatComponentManifest(component);
			expect(result).toMatchInlineSnapshot(`
				"# PartialSuccess

				ID: partial-success

				A component where everything worked except one story.

				## Stories

				### Default

				Default usage of the component.

				\`\`\`
				import { PartialSuccess } from '@storybook/design-system';

				const Default = () => <PartialSuccess title="Hello" />
				\`\`\`

				### With Subtitle

				Component with both title and subtitle.

				\`\`\`
				import { PartialSuccess } from '@storybook/design-system';

				const WithSubtitle = () => <PartialSuccess title="Hello" subtitle="World" />
				\`\`\`

				## Props

				| Name | Type | Description | Required | Default |
				|------|------|-------------|----------|---------|
				| title | \`string\` | The title text | true |  |
				| subtitle | \`string\` | Optional subtitle | false |  |"
			`);
		});

		it('should format list of components with errors', () => {
			const result = formatComponentManifestMapToList(
				withErrorsFixture as ComponentManifestMap,
			);
			expect(result).toMatchInlineSnapshot(`
				"# Components

				- SuccessWithMixedStories (success-component-with-mixed-stories): Success component with both working and failing stories
				- ErrorWithSuccessStories (error-component-with-success-stories)
				- ErrorWithErrorStories (error-component-with-error-stories)
				- CompleteError (complete-error-component)
				- PartialSuccess (partial-success): Mostly working component with one failing story"
			`);
		});
	});
});
