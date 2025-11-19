import * as v from 'valibot';
import type { ComponentManifest, ComponentManifestMap } from '../../types.ts';

/**
 * Supported output formats for component manifest formatting.
 */
export const OutputFormat = v.picklist(['xml', 'markdown']);
export type OutputFormat = v.InferOutput<typeof OutputFormat>;

/**
 * Interface for manifest formatters.
 * Implementations must provide methods to format both single components
 * and component lists in their respective formats (XML, Markdown, etc).
 */
export interface ManifestFormatter {
	/**
	 * Format a single component manifest into the target format.
	 * @param componentManifest - The component manifest to format
	 * @returns Formatted string representation of the component
	 */
	formatComponentManifest(componentManifest: ComponentManifest): string;

	/**
	 * Format a component manifest map into a list in the target format.
	 * @param manifest - The component manifest map to format
	 * @returns Formatted string representation of the component list
	 */
	formatComponentManifestMapToList(manifest: ComponentManifestMap): string;
}
