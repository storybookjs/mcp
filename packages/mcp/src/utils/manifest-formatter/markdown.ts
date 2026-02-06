import type { ComponentManifest, Doc } from '../../types.ts';
import { MAX_SUMMARY_LENGTH, type ManifestFormatter } from './types.ts';
import { parseReactDocgen } from '../parse-react-docgen.ts';
import { dedent } from '../dedent.ts';
import { extractDocsSummary } from './extract-docs-summary.ts';

function formatComponentLine(component: ComponentManifest): string {
	const summary =
		component.summary ??
		(component.description
			? component.description.length > MAX_SUMMARY_LENGTH
				? `${component.description.slice(0, MAX_SUMMARY_LENGTH)}...`
				: component.description
			: undefined);

	if (summary) {
		return `- ${component.name} (${component.id}): ${summary}`;
	}
	return `- ${component.name} (${component.id})`;
}

function formatDocLine(doc: Doc): string {
	const summary = doc.summary ?? extractDocsSummary(doc.content);
	return `- ${doc.title} (${doc.id})${summary ? `: ${summary}` : ''}`;
}

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
				parts.push('```');
				parts.push('export type Props = {');

				for (const [propName, propInfo] of propEntries) {
					const type = propInfo.type ?? 'any';
					const isRequired = propInfo.required ?? true;
					const hasDefault = propInfo.defaultValue !== undefined;
					const hasDescription = propInfo.description !== undefined;

					// Add description as JSDoc comment if present
					if (hasDescription) {
						parts.push('  /**');
						parts.push(`    ${propInfo.description}`);
						parts.push('  */');
					}

					// Build the prop line
					let propLine = `  ${propName}`;

					// Add ? for optional props
					if (!isRequired) {
						propLine += '?';
					}

					propLine += `: ${type}`;

					// Add default value if present
					if (hasDefault) {
						propLine += ` = ${propInfo.defaultValue}`;
					}

					propLine += ';';
					parts.push(propLine);
				}

				parts.push('}');
				parts.push('```');
				parts.push('');
			}
		}

		return parts.join('\n').trim();
	},

	formatDocsManifest(doc) {
		return dedent`# ${doc.title}

			${doc.content}`;
	},

	formatManifestsToLists(manifests) {
		const parts: string[] = [];

		parts.push('# Components');
		parts.push('');
		for (const component of Object.values(manifests.componentManifest.components)) {
			parts.push(formatComponentLine(component));
		}
		parts.push('');

		if (!manifests.docsManifest) {
			return parts.join('\n').trim();
		}

		parts.push('# Docs');
		parts.push('');
		for (const doc of Object.values(manifests.docsManifest.docs)) {
			parts.push(formatDocLine(doc));
		}

		return parts.join('\n').trim();
	},

	formatMultiSourceManifestsToLists(manifests) {
		const parts: string[] = [];

		for (const { source, componentManifest, docsManifest, error } of manifests) {
			parts.push(`# ${source.title}`);
			parts.push(`id: ${source.id}`);
			parts.push('');

			if (error) {
				parts.push(`error: ${error}`);
				parts.push('');
				continue;
			}

			const components = Object.values(componentManifest.components);
			if (components.length > 0) {
				parts.push('## Components');
				parts.push('');
				for (const component of components) {
					parts.push(formatComponentLine(component));
				}
				parts.push('');
			}

			if (docsManifest && Object.keys(docsManifest.docs).length > 0) {
				parts.push('## Docs');
				parts.push('');
				for (const doc of Object.values(docsManifest.docs)) {
					parts.push(formatDocLine(doc));
				}
				parts.push('');
			}
		}

		return parts.join('\n').trim();
	},
};
