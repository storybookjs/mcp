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
};

// Storybook's `reactComponentMeta` payload is not the same full schema as
// `react-docgen-typescript`'s `ComponentDoc`, but `props` has the same type shape.
type ComponentDocLike = Pick<ComponentDoc, 'props'>;

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
 * Serialize a react-docgen-typescript prop type into a TypeScript-like string.
 *
 * For enum types (which RDT uses for both string-literal unions and TS enums when
 * `shouldExtractLiteralValuesFromEnum` is enabled), `type.raw` only contains the
 * literal members when the union is written inline on the prop. When the prop
 * references a named alias (e.g. `variant?: ButtonVariant`), `type.raw` is just
 * the alias name, while the resolved literal members live in `type.value`.
 * Walking `type.value` ensures aliased unions are expanded the same as inline ones.
 */
const serializeRdtType = (
	type: ComponentDoc['props'][string]['type'] | undefined,
): string | undefined => {
	if (!type) return undefined;
	const value = (type as { value?: unknown }).value;
	if (type.name === 'enum' && Array.isArray(value)) {
		const members = value
			.map((v) => (v && typeof v === 'object' && 'value' in v ? (v as { value: unknown }).value : undefined))
			.filter((v): v is string => typeof v === 'string');
		if (members.length > 0) return members.join(' | ');
	}
	return type.raw ?? type.name;
};

/**
 * Parse react-docgen-typescript output into the same simplified ParsedDocgen format.
 * RDT uses flat type strings (prop.type.name / prop.type.raw) instead of react-docgen's
 * nested tsType structure.
 */
const parseComponentDocLike = (componentDoc: ComponentDocLike): ParsedDocgen => {
	const props = componentDoc.props ?? {};
	return {
		props: Object.fromEntries(
			Object.entries(props).map(([propName, prop]) => [
				propName,
				{
					description: prop.description || undefined,
					type: serializeRdtType(prop.type),
					defaultValue: prop.defaultValue?.value,
					required: prop.required,
				},
			]),
		),
	};
};

export const parseReactDocgenTypescript = (reactDocgenTypescript: ComponentDoc): ParsedDocgen =>
	parseComponentDocLike(reactDocgenTypescript);

export const parseReactComponentMeta = (reactComponentMeta: ComponentDocLike): ParsedDocgen =>
	parseComponentDocLike(reactComponentMeta);
