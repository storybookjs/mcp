import type { ComponentManifest, ComponentManifestMap } from '../../types.ts';
import type { ManifestFormatter } from './types.ts';
import { parseReactDocgen } from '../parse-react-docgen.ts';

const MAX_SUMMARY_LENGTH = 90;

/**
 * Markdown formatter for component manifests.
 * Formats component data into token-efficient markdown with headers, lists, and tables.
 * Uses adaptive formatting based on prop complexity to optimize token usage.
 */
export const markdownFormatter: ManifestFormatter = {
	formatComponentManifest(componentManifest: ComponentManifest): string {
		const parts: string[] = [];

		// Component header
		parts.push(`# ${componentManifest.name}`);
		parts.push('');
		parts.push(`ID: ${componentManifest.id}`);
		parts.push('');

		// Description section
		if (componentManifest.description) {
			parts.push(componentManifest.description);
			parts.push('');
		}

		// Stories section
		if (componentManifest.stories && componentManifest.stories.length > 0) {
			parts.push('## Stories');
			parts.push('');

			for (const story of componentManifest.stories) {
				if (!story.snippet) {
					continue;
				}

				// Convert PascalCase to Human Readable Case
				const storyName = story.name.replace(/([A-Z])/g, ' $1').trim();
				parts.push(`### ${storyName}`);

				if (story.description) {
					parts.push('');
					parts.push(story.description);
				}

				parts.push('');
				parts.push('```');
				if (componentManifest.import) {
					parts.push(componentManifest.import);
					parts.push('');
				}
				parts.push(story.snippet);
				parts.push('```');
				parts.push('');
			}
		}

		// Props section
		if (componentManifest.reactDocgen) {
			const parsedDocgen = parseReactDocgen(componentManifest.reactDocgen);
			const propEntries = Object.entries(parsedDocgen.props);

			if (propEntries.length > 0) {
				parts.push('## Props');
				parts.push('');

				// Determine if we should use table format or bullet list
				// Use table if any prop has description, required, or defaultValue
				const hasRichMetadata = propEntries.some(
					([, propInfo]) =>
						propInfo.required !== undefined ||
						propInfo.defaultValue !== undefined,
				);

				if (hasRichMetadata) {
					// Use table format for props with rich metadata
					parts.push('| Name | Type | Description | Required | Default |');
					parts.push('|------|------|-------------|----------|---------|');

					for (const [propName, propInfo] of propEntries) {
						const type = propInfo.type ?? '';
						const description = propInfo.description ?? '';
						const required =
							propInfo.required !== undefined
								? propInfo.required
									? 'true'
									: 'false'
								: '';
						const defaultValue = propInfo.defaultValue ?? '';

						parts.push(
							`| ${propName} | \`${type}\` | ${description} | ${required} | ${defaultValue} |`,
						);
					}
				} else {
					// Use bullet list format for simple props (name + type only)
					for (const [propName, propInfo] of propEntries) {
						const type = propInfo.type ?? '';
						let propString = `- ${propName}: ${type}`;
						if (propInfo.description) {
							propString += ` - ${propInfo.description}`;
						}
						parts.push(propString);
					}
				}

				parts.push('');
			}
		}

		return parts.join('\n').trim();
	},

	formatComponentManifestMapToList(manifest: ComponentManifestMap): string {
		const parts: string[] = [];

		parts.push('# Components');
		parts.push('');

		for (const component of Object.values(manifest.components)) {
			const summary =
				component.summary ??
				(component.description
					? component.description.length > MAX_SUMMARY_LENGTH
						? `${component.description.slice(0, MAX_SUMMARY_LENGTH)}...`
						: component.description
					: undefined);

			if (summary) {
				parts.push(`- ${component.name} (${component.id}): ${summary}`);
			} else {
				parts.push(`- ${component.name} (${component.id})`);
			}
		}

		parts.push('');

		return parts.join('\n').trim();
	},
};
