import type { AllManifests, ComponentManifest, Doc, Story } from '../types.ts';
import { parseReactDocgen } from './parse-react-docgen.ts';
import { dedent } from './dedent.ts';
import { extractDocsSummary } from './manifest-formatter/extract-docs-summary.ts';

/**
 * Maximum length for a summary before truncation.
 */
const MAX_SUMMARY_LENGTH = 90;

/**
 * Maximum number of stories to show in full detail in component manifests.
 * Remaining stories will be shown as names only.
 */
export const MAX_STORIES_TO_SHOW = 3;

/**
 * Extracts a summary from an object with optional summary and description fields.
 * Prefers summary if available, otherwise truncates description to maxLength.
 */
function extractSummary(
	item: { summary?: string; description?: string },
	maxLength: number = MAX_SUMMARY_LENGTH,
): string | undefined {
	if (item.summary) {
		return item.summary;
	}
	if (item.description) {
		return item.description.length > maxLength
			? `${item.description.slice(0, maxLength)}...`
			: item.description;
	}
	return undefined;
}

/**
 * Formats a story's content (description + code snippet) into markdown.
 * Reusable helper for both formatComponentManifest and formatStoryDocumentation.
 */
function formatStoryContent(story: Story, importStatement: string | undefined): string[] {
	const parts: string[] = [];

	if (story.description) {
		parts.push(story.description);
		parts.push('');
	}

	parts.push('```');
	if (importStatement) {
		parts.push(importStatement);
		parts.push('');
	}
	parts.push(story.snippet ?? '');
	parts.push('```');

	return parts;
}

/**
 * Format a single component manifest in summary mode (optimized for token usage).
 * @param componentManifest - The component manifest to format
 * @returns Formatted markdown string representation of the component
 */
export function formatComponentManifest(componentManifest: ComponentManifest): string {
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

		const storiesWithSnippets = componentManifest.stories.filter((s) => s.snippet);

		// Check if component has props - if not, show all stories fully
		const hasProps =
			componentManifest.reactDocgen &&
			Object.keys(componentManifest.reactDocgen.props ?? {}).length > 0;

		const storiesToShow = hasProps
			? storiesWithSnippets.slice(0, MAX_STORIES_TO_SHOW)
			: storiesWithSnippets;
		const remainingStories = hasProps ? storiesWithSnippets.slice(MAX_STORIES_TO_SHOW) : [];

		// Show first X stories in full detail (or all if no props)
		for (const story of storiesToShow) {
			parts.push(`### ${story.name}`);
			parts.push('');
			parts.push(...formatStoryContent(story, componentManifest.import));
			parts.push('');
		}

		// Show remaining stories as names only
		if (remainingStories.length > 0) {
			if (storiesToShow.length > 0) {
				parts.push('### Other Stories');
			}
			parts.push('');
			for (const story of remainingStories) {
				const summary = extractSummary(story);
				const summaryPart = summary ? `: ${summary}` : '';
				parts.push(`- ${story.name}${summaryPart}`);
			}
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

	// Attached docs section
	if (componentManifest.docs && Object.keys(componentManifest.docs).length > 0) {
		const docsWithContent = Object.values(componentManifest.docs).filter(
			(doc) => doc.content.trim().length > 0,
		);

		if (docsWithContent.length > 0) {
			parts.push('## Docs');
			parts.push('');

			for (const doc of docsWithContent) {
				parts.push(`### ${doc.name}`);
				parts.push('');

				parts.push(doc.content);
				parts.push('');
			}
		}
	}

	return parts.join('\n').trim();
}

/**
 * Format a single story's documentation.
 * @param componentManifest - The component manifest containing the story
 * @param storyName - The name of the story to format
 * @returns Formatted markdown string representation of the story
 */
export function formatStoryDocumentation(
	componentManifest: ComponentManifest,
	storyName: string,
): string {
	const story = componentManifest.stories?.find((s) => s.name === storyName);

	if (!story || !story.snippet) {
		return '';
	}

	const parts: string[] = [];

	// Component name - Story name header
	parts.push(`# ${componentManifest.name} - ${story.name}`);
	parts.push('');
	parts.push(...formatStoryContent(story, componentManifest.import));

	return parts.join('\n').trim();
}

/**
 * Format a single docs manifest.
 */
export function formatDocsManifest(doc: Doc): string {
	return dedent`# ${doc.title}

		${doc.content}`;
}

/**
 * Format a component manifest and optionally a docs manifest into lists.
 */
export function formatManifestsToLists(manifests: AllManifests): string {
	const parts: string[] = [];

	parts.push('# Components');
	parts.push('');

	for (const component of Object.values(manifests.componentManifest.components)) {
		const summary = extractSummary(component);

		if (summary) {
			parts.push(`- ${component.name} (${component.id}): ${summary}`);
		} else {
			parts.push(`- ${component.name} (${component.id})`);
		}
	}

	parts.push('');

	if (!manifests.docsManifest) {
		return parts.join('\n').trim();
	}

	parts.push('# Docs');
	parts.push('');

	for (const doc of Object.values(manifests.docsManifest.docs)) {
		const summary = doc.summary ?? extractDocsSummary(doc.content);
		parts.push(`- ${doc.title} (${doc.id})${summary ? `: ${summary}` : ''}`);
	}

	return parts.join('\n').trim();
}
