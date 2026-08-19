// Stable, hand-assigned colors for every agentic-ref case, shared by the HTML
// report and the ECDF curves (compare-results embeds them in manifest.json, so
// both renderers read the same values). Explicit per-case entries keep hues
// stable over time: adding an experiment means adding one line here
// (colors.test.ts fails otherwise) and never recolors the existing cases.
// `light` is for white and light grounds (the curves always render on white),
// `dark` for the report's dark theme.

export interface CaseColor {
	light: string;
	dark: string;
}

export const CASE_COLORS: Record<string, CaseColor> = {
	'control-none': { light: '#52606D', dark: '#9AA5B1' }, // slate
	empty: { light: '#C05621', dark: '#D4732A' }, // orange
	full: { light: '#6D5BD0', dark: '#8B79E8' }, // violet
	'basic-docs': { light: '#2B6CB0', dark: '#5B9BD9' }, // blue
	'do-dont': { light: '#B7791F', dark: '#D9A441' }, // amber
	'when-to-use': { light: '#2F855A', dark: '#52BB84' }, // green
	'history-issues': { light: '#8C5E2A', dark: '#BC8A50' }, // brown
	a11y: { light: '#0B7285', dark: '#3BC9DB' }, // cyan
	'brand-animation': { light: '#B83280', dark: '#E67AB0' }, // magenta
	'api-ref': { light: '#6B7A16', dark: '#A3B633' }, // olive
	'docs-full': { light: '#9E3B25', dark: '#C96A52' }, // rust
	'stories-api-ref': { light: '#0D8A78', dark: '#12A38E' }, // teal
	'stories-showcase': { light: '#4C63B6', dark: '#7D93E0' }, // indigo
	'stories-highlight': { light: '#CC5A71', dark: '#E88CA0' }, // rosewood
	'stories-examples': { light: '#3B7A2A', dark: '#6FBF5C' }, // forest
	'stories-full': { light: '#7A3E9D', dark: '#B07CD6' }, // plum
	'purge-jsdoc': { light: '#8B5E83', dark: '#BD8CB3' }, // mauve
};

/** Cases outside the registry fall back to a neutral gray. */
const FALLBACK: CaseColor = { light: '#6B7280', dark: '#9CA3AF' };

/** The color pair per case, keyed in input order. */
export function caseColors(shortNames: string[]): Record<string, CaseColor> {
	return Object.fromEntries(shortNames.map((name) => [name, CASE_COLORS[name] ?? FALLBACK]));
}
