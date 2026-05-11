import type { ParsedDocgen } from './parse-react-docgen.ts';

// ─── CEM v2.1.0 type surface ──────────────────────────────────────────────

export interface CemType {
	text: string;
}

export interface CemField {
	kind: 'field';
	name: string;
	type?: CemType;
	default?: string;
	description?: string;
	privacy?: string;
	static?: boolean;
	readonly?: boolean;
}

export interface CemAttribute {
	name: string;
	type?: CemType;
	default?: string;
	description?: string;
	fieldName?: string;
}

export interface CemEvent {
	name: string;
	type?: CemType;
	description?: string;
}

export interface CemSlot {
	name: string;
	description?: string;
}

export interface CemCssProperty {
	name: string;
	type?: CemType;
	default?: string;
	description?: string;
}

export interface CemCssPart {
	name: string;
	description?: string;
}

export interface CemClassDeclaration {
	kind: 'class';
	name: string;
	tagName?: string;
	customElement?: boolean;
	description?: string;
	members?: CemField[];
	attributes?: CemAttribute[];
	events?: CemEvent[];
	slots?: CemSlot[];
	cssProperties?: CemCssProperty[];
	cssParts?: CemCssPart[];
}

export interface CemModule {
	kind: string;
	path: string;
	declarations?: CemClassDeclaration[];
}

export interface CustomElementsManifest {
	schemaVersion: string;
	modules: CemModule[];
}

// ─── Parsed CEM — extends ParsedDocgen with web component sections ─────────

export interface ParsedCem extends ParsedDocgen {
	// props (inherited) → public reactive fields (Lit @property)
	attributes: Record<string, { description?: string; type?: string; defaultValue?: string; fieldName?: string }>;
	events: Record<string, { description?: string; type?: string }>;
	slots: Record<string, { description?: string }>; // '' → '(default)'
	cssProperties: Record<string, { description?: string; type?: string; defaultValue?: string }>;
	cssParts: Record<string, { description?: string }>;
}

// ─── Parser functions ─────────────────────────────────────────────────────

/**
 * Finds the first custom element class declaration in a CEM for a given tag name.
 * Falls back to the first declaration with customElement=true if no tagName match is found.
 */
export function findDeclarationForTag(
	manifest: CustomElementsManifest,
	tagName?: string,
): CemClassDeclaration | undefined {
	for (const mod of manifest.modules) {
		for (const decl of mod.declarations ?? []) {
			if (decl.kind !== 'class') continue;
			if (tagName && decl.tagName === tagName) return decl;
			if (!tagName && decl.customElement) return decl;
		}
	}
	return undefined;
}

/**
 * Parses a CEM class declaration into a normalized ParsedCem structure.
 *
 * Lit @property decorators appear in the CEM as both a field and an attribute entry.
 * Both sections are preserved: `props` reflects the JS property API, `attributes`
 * reflects the HTML attribute API. LLMs benefit from seeing both spellings.
 * Private fields and static fields are excluded from `props`.
 */
export function parseCemDeclaration(decl: CemClassDeclaration): ParsedCem {
	const publicFields = (decl.members ?? []).filter(
		(m) => m.kind === 'field' && !m.static && (!m.privacy || m.privacy === 'public'),
	);

	const props = Object.fromEntries(
		publicFields.map((field) => [
			field.name,
			{
				description: field.description,
				type: field.type?.text,
				defaultValue: field.default,
				required: false,
			},
		]),
	);

	const attributes = Object.fromEntries(
		(decl.attributes ?? []).map((attr) => [
			attr.name,
			{
				description: attr.description,
				type: attr.type?.text,
				defaultValue: attr.default,
				fieldName: attr.fieldName,
			},
		]),
	);

	const events = Object.fromEntries(
		(decl.events ?? []).map((ev) => [
			ev.name,
			{ description: ev.description, type: ev.type?.text },
		]),
	);

	const slots = Object.fromEntries(
		(decl.slots ?? []).map((slot) => [
			slot.name === '' ? '(default)' : slot.name,
			{ description: slot.description },
		]),
	);

	const cssProperties = Object.fromEntries(
		(decl.cssProperties ?? []).map((cp) => [
			cp.name,
			{ description: cp.description, type: cp.type?.text, defaultValue: cp.default },
		]),
	);

	const cssParts = Object.fromEntries(
		(decl.cssParts ?? []).map((part) => [part.name, { description: part.description }]),
	);

	return { props, attributes, events, slots, cssProperties, cssParts };
}

/**
 * Parses a full Custom Elements Manifest for a specific element tag name.
 * Returns undefined if no matching declaration is found.
 */
export function parseCustomElementsManifest(
	manifest: CustomElementsManifest,
	tagName?: string,
): ParsedCem | undefined {
	const decl = findDeclarationForTag(manifest, tagName);
	if (!decl) return undefined;
	return parseCemDeclaration(decl);
}
