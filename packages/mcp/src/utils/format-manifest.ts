import type { AllManifests, ComponentManifest, Doc } from '../types.ts';
import { markdownFormatter } from './manifest-formatter/markdown.ts';

/**
 * Format a single component manifest in summary mode (optimized for token usage).
 * @param componentManifest - The component manifest to format
 * @returns Formatted markdown string representation of the component
 */
export function formatComponentManifest(componentManifest: ComponentManifest): string {
	return markdownFormatter.formatComponentManifest(componentManifest);
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
	return markdownFormatter.formatStoryDocumentation(componentManifest, storyName);
}

/**
 * Format a single docs manifest.
 */
export function formatDocsManifest(doc: Doc): string {
	return markdownFormatter.formatDocsManifest(doc);
}

/**
 * Format a component manifest and optionally a docs manifest into lists.
 */
export function formatManifestsToLists(manifests: AllManifests): string {
	return markdownFormatter.formatManifestsToLists(manifests);
}
