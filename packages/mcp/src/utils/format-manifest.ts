import type { ComponentManifest, ComponentManifestMap } from '../types.ts';
import type {
	OutputFormat,
	ManifestFormatter,
} from './manifest-formatter/types.ts';
import { xmlFormatter } from './manifest-formatter/xml.ts';
import { markdownFormatter } from './manifest-formatter/markdown.ts';

// Re-export utility functions for use by formatters
export { dedent } from './dedent.ts';
export { parseReactDocgen } from './parse-react-docgen.ts';

const formatters: Record<OutputFormat, ManifestFormatter> = {
	xml: xmlFormatter,
	markdown: markdownFormatter,
};

/**
 * Format a single component manifest.
 * @param componentManifest - The component manifest to format
 * @param format - The desired output format (defaults to 'markdown')
 * @returns Formatted string representation of the component
 */
export function formatComponentManifest(
	componentManifest: ComponentManifest,
	format: OutputFormat = 'markdown',
): string {
	return formatters[format].formatComponentManifest(componentManifest);
}

/**
 * Format a component manifest map into a list.
 * @param manifest - The component manifest map to format
 * @param format - The desired output format (defaults to 'markdown')
 * @returns Formatted string representation of the component list
 */
export function formatComponentManifestMapToList(
	manifest: ComponentManifestMap,
	format: OutputFormat = 'markdown',
): string {
	return formatters[format].formatComponentManifestMapToList(manifest);
}
