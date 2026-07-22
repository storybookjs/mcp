import type { PropDescriptor, Documentation } from 'react-docgen';
import type { ComponentDoc } from 'react-docgen-typescript';

export type ParsedDocgen = {
	props: Record<
		string,
		{
			description?: string;
			type?: string;
			defaultValue?: string;
			required?: boolean;
		}
	>;
	/**
	 * Component-level JSDoc tags (e.g. `@deprecated`), normalized to string arrays.
	 * Populated from react-docgen-typescript's `ComponentDoc.tags` (and Storybook's
	 * `reactComponentMeta`), which is where the legacy path carries `@deprecated`. The
	 * docgen-server path carries these on the manifest's top-level `jsDocTags` instead.
	 */
	tags?: Record<string, string[]>;
};

// Storybook's `reactComponentMeta` payload is not the same full schema as
// `react-docgen-typescript`'s `ComponentDoc`, but `props` has the same type shape.
type ComponentDocLike = Pick<ComponentDoc, 'props'>;

/**
 * Normalize a docgen engine's component-level `tags` bag into `Record<string, string[]>`.
 * react-docgen-typescript (and Storybook's `reactComponentMeta`) expose `tags` as a
 * `Record<string, string>` — `deprecated` is a single string, `''` when the tag has no
 * message. Non-string values are ignored. Returns `undefined` when there are no string
 * tags so callers can omit the field entirely (keeping `ParsedDocgen` byte-identical when
 * nothing is tagged).
 */
function normalizeTags(raw: unknown): Record<string, string[]> | undefined {
	if (!raw || typeof raw !== 'object') {
		return undefined;
	}

	const out: Record<string, string[]> = {};
	for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
		if (typeof value === 'string') {
			out[key] = [value];
		}
	}

	return Object.keys(out).length > 0 ? out : undefined;
}

// Serialize a react-docgen tsType into a TypeScript-like string when raw is not available
function serializeTsType(tsType: PropDescriptor['tsType']): string | undefined {
	if (!tsType) return undefined;
	// Prefer raw if provided
	if ('raw' in tsType && typeof tsType.raw === 'string' && tsType.raw.trim().length > 0) {
		return tsType.raw;
	}

	if (!tsType.name) return undefined;

	if ('elements' in tsType) {
		const serializeElements = () =>
			(tsType.elements ?? []).map((el: any) => serializeTsType(el) ?? 'unknown');

		switch (tsType.name) {
			case 'union':
				return serializeElements().join(' | ');
			case 'intersection':
				return serializeElements().join(' & ');
			case 'Array': {
				const inner = serializeTsType((tsType.elements ?? [])[0]) ?? 'unknown';
				return `${inner}[]`;
			}
			case 'tuple':
				return `[${serializeElements().join(', ')}]`;
		}
	}
	if ('value' in tsType && tsType.name === 'literal') {
		return tsType.value;
	}
	if ('signature' in tsType && tsType.name === 'signature') {
		if (tsType.type === 'function') {
			const args = (tsType.signature?.arguments ?? []).map((a: any) => {
				const argType = serializeTsType(a.type) ?? 'any';
				return `${a.name}: ${argType}`;
			});
			const ret = serializeTsType(tsType.signature?.return) ?? 'void';
			return `(${args.join(', ')}) => ${ret}`;
		}
		if (tsType.type === 'object') {
			const props = (tsType.signature?.properties ?? []).map((p) => {
				const req: boolean = Boolean(p.value?.required);
				const propType = serializeTsType(p.value) ?? 'any';
				return `${p.key as string}${req ? '' : '?'}: ${propType}`;
			});
			return `{ ${props.join('; ')} }`;
		}
		return 'unknown';
	}
	// Default case (Generic like Item<TMeta>)
	if ('elements' in tsType) {
		const inner = (tsType.elements ?? []).map((el) => serializeTsType(el) ?? 'unknown');
		if (inner.length > 0) return `${tsType.name}<${inner.join(', ')}>`;
	}

	return tsType.name;
}

export const parseReactDocgen = (reactDocgen: Documentation): ParsedDocgen => {
	const props: Record<string, any> = (reactDocgen as any)?.props ?? {};
	return {
		props: Object.fromEntries(
			Object.entries(props).map(([propName, prop]) => [
				propName,
				{
					description: prop.description,
					type: serializeTsType(prop.tsType ?? prop.type),
					defaultValue: prop.defaultValue?.value,
					required: prop.required,
				},
			]),
		),
	};
};

/**
 * Parse react-docgen-typescript output into the same simplified ParsedDocgen format.
 * RDT uses flat type strings (prop.type.name / prop.type.raw) instead of react-docgen's
 * nested tsType structure, so no serialization is needed.
 */
const parseComponentDocLike = (componentDoc: ComponentDocLike): ParsedDocgen => {
	const props = componentDoc.props ?? {};
	const parsed: ParsedDocgen = {
		props: Object.fromEntries(
			Object.entries(props).map(([propName, prop]) => [
				propName,
				{
					description: prop.description || undefined,
					// RDT uses prop.type.name as a flat string (e.g. "() => void", "{ id: string }")
					// For enums, prefer prop.type.raw which has the full union
					type: prop.type?.raw ?? prop.type?.name,
					defaultValue: prop.defaultValue?.value,
					required: prop.required,
				},
			]),
		),
	};
	// RDT (and Storybook's reactComponentMeta) expose component-level JSDoc tags on
	// `.tags` — the only place the legacy path carries `@deprecated`.
	const tags = normalizeTags((componentDoc as { tags?: unknown }).tags);
	if (tags) {
		parsed.tags = tags;
	}
	return parsed;
};

export const parseReactDocgenTypescript = (reactDocgenTypescript: ComponentDoc): ParsedDocgen =>
	parseComponentDocLike(reactDocgenTypescript);

export const parseReactComponentMeta = (reactComponentMeta: ComponentDocLike): ParsedDocgen =>
	parseComponentDocLike(reactComponentMeta);
