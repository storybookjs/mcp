import type { AllManifests, ComponentManifest, Doc, MultiSourceManifests } from '../../types.ts';

/**
 * Maximum length for a summary before truncation.
 */
export const MAX_SUMMARY_LENGTH = 90;

/**
 * Interface for manifest formatters.
 * Implementations must provide methods to format both single components
 * and component lists in their respective formats (XML, Markdown, etc).
 */
export interface ManifestFormatter {
	/**
	 * Format a single component manifest into the target format.
	 */
	formatComponentManifest(componentManifest: ComponentManifest): string;

	/**
	 * Format a single doc manifest into the target format.
	 */
	formatDocsManifest(doc: Doc): string;

	/**
	 * Format a component manifest map into a list in the target format.
	 * @param manifest - The component manifest map to format
	 * @returns Formatted string representation of the component list
	 */
	formatManifestsToLists(manifests: AllManifests): string;

	/**
	 * Format multi-source manifests into grouped lists.
	 * Each source is displayed with a heading and its components/docs listed underneath.
	 * @param manifests - The multi-source manifests to format
	 * @returns Formatted string representation grouped by source
	 */
	formatMultiSourceManifestsToLists(manifests: MultiSourceManifests): string;
}
