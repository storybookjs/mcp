const HTML_NAMESPACE = 'http://www.w3.org/1999/xhtml';
const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
export const COMPUTED_STYLES_BASELINE_IFRAME_ID = 'storybook-addon-mcp-computed-styles-baseline';

const COMMON_BASELINE_ATTRIBUTES = ['dir', 'lang'] as const;

const BASELINE_ATTRIBUTES_BY_TAG = {
	button: ['type'],
	input: ['type', 'size'],
	li: ['value'],
	ol: ['start', 'reversed', 'type'],
	select: ['multiple', 'size'],
	textarea: ['rows', 'cols', 'wrap'],
} as const satisfies Record<string, readonly string[]>;

const INTERNAL_SELECTOR_CLASS_PATTERNS = [
	/^sb-/,
	/^sbdocs/,
	/^docs-/,
	/^docblock-/,
	/^innerZoomElementWrapper$/,
];
const INTERNAL_SELECTOR_ID_PATTERNS = [/^storybook-/, /^anchor--/];
const OMITTED_COMPUTED_STYLE_PROPERTIES = new Set([
	'animation-direction',
	'animation-play-state',
	'block-size',
	'caret-color',
	'column-rule-color',
	'height',
	'inline-size',
	'outline-color',
	'perspective-origin',
	'text-decoration-color',
	'text-emphasis-color',
	'transform-origin',
	'width',
	'-webkit-text-fill-color',
	'-webkit-text-stroke-color',
]);

const baselineStyleCaches = new WeakMap<Document, Map<string, Record<string, string>>>();
const baselineEnvironmentSignatures = new WeakMap<Document, string>();

export interface ElementComputedStyles {
	selector: string;
	tagName: string;
	styles: Record<string, string>;
}

/**
 * Extract the per-element computed style differences for a rendered story subtree.
 *
 * The core idea is:
 * - walk every rendered DOM element under the story root in tree order
 * - compute the element's final browser styles with getComputedStyle()
 * - compare them against a "baseline" element of the same tag rendered in an isolated iframe
 * - keep only the properties whose computed values differ from that isolated baseline
 *
 * The baseline is intentionally not the CSS spec's raw "initial" value. Instead, it is the
 * browser's own computed result for the same tag in a blank document, with only a small set of
 * intrinsic attributes copied over (for example input type="checkbox"). That removes UA/default
 * noise while still preserving meaningful inherited/layout/theme differences from the real story.
 *
 * The baseline iframe can be prepared once up front, for example from Storybook's preview-level
 * beforeAll hook. If it was not prepared, extractComputedStyles() will create it on demand and
 * tear it down when finished.
 */
export function extractComputedStyles(canvasElement: Element): ElementComputedStyles[] {
	const { baselineDocument, baselineCache, cleanup } = ensureBaselineDocument(
		canvasElement.ownerDocument,
	);

	try {
		return getElementsInTreeOrder(canvasElement)
			.map((element) => {
				const baselineStyles = getBaselineStyles(element, baselineDocument, baselineCache);
				const styles = diffComputedStyles(getComputedStyle(element), baselineStyles);

				return {
					selector: buildElementSelector(element, canvasElement),
					tagName: element.localName,
					styles,
				};
			})
			.filter((element) => Object.keys(element.styles).length > 0);
	} finally {
		cleanup?.();
	}
}

export function setupComputedStylesBaseline(ownerDocument: Document = document): () => void {
	ensureBaselineDocument(ownerDocument);
	return () => teardownComputedStylesBaseline(ownerDocument);
}

export function teardownComputedStylesBaseline(ownerDocument: Document = document) {
	const baselineIframe = findBaselineIframe(ownerDocument);
	if (!baselineIframe) {
		return;
	}

	const baselineDocument = baselineIframe.contentDocument;
	if (baselineDocument) {
		baselineStyleCaches.delete(baselineDocument);
		baselineEnvironmentSignatures.delete(baselineDocument);
	}

	baselineIframe.remove();
}

function ensureBaselineDocument(ownerDocument: Document): {
	baselineDocument: Document;
	baselineCache: Map<string, Record<string, string>>;
	cleanup?: () => void;
} {
	let iframe = findBaselineIframe(ownerDocument);
	const createdForCall = !iframe;

	if (!iframe) {
		iframe = ownerDocument.createElement('iframe');
		iframe.id = COMPUTED_STYLES_BASELINE_IFRAME_ID;
		iframe.setAttribute('aria-hidden', 'true');
		iframe.tabIndex = -1;
		Object.assign(iframe.style, {
			border: '0',
			height: '0',
			left: '-10000px',
			opacity: '0',
			pointerEvents: 'none',
			position: 'fixed',
			top: '-10000px',
			width: '0',
		});

		const mountTarget = ownerDocument.body ?? ownerDocument.documentElement;
		if (!mountTarget) {
			throw new Error('Unable to create a baseline document without a mount target.');
		}

		mountTarget.appendChild(iframe);
	}

	const baselineDocument = iframe.contentDocument;
	if (!baselineDocument?.documentElement || !baselineDocument.head || !baselineDocument.body) {
		if (createdForCall) {
			iframe.remove();
		}
		throw new Error('Unable to access the baseline iframe document.');
	}

	baselineDocument.head.replaceChildren();
	baselineDocument.body.replaceChildren();

	const ownerDocumentElement = ownerDocument.documentElement;
	baselineDocument.documentElement.lang = ownerDocumentElement.lang;

	const direction = ownerDocumentElement.getAttribute('dir');
	if (direction) {
		baselineDocument.documentElement.setAttribute('dir', direction);
	} else {
		baselineDocument.documentElement.removeAttribute('dir');
	}

	const environmentSignature = `${baselineDocument.documentElement.lang}|${direction ?? ''}`;
	let baselineCache = baselineStyleCaches.get(baselineDocument);
	if (
		!baselineCache ||
		baselineEnvironmentSignatures.get(baselineDocument) !== environmentSignature
	) {
		baselineCache = new Map<string, Record<string, string>>();
		baselineStyleCaches.set(baselineDocument, baselineCache);
		baselineEnvironmentSignatures.set(baselineDocument, environmentSignature);
	}

	return {
		baselineDocument,
		baselineCache,
		cleanup: createdForCall ? () => teardownComputedStylesBaseline(ownerDocument) : undefined,
	};
}

function findBaselineIframe(ownerDocument: Document): HTMLIFrameElement | null {
	const baselineElement = ownerDocument.getElementById(COMPUTED_STYLES_BASELINE_IFRAME_ID);
	return baselineElement instanceof HTMLIFrameElement ? baselineElement : null;
}

function getElementsInTreeOrder(root: Element): Element[] {
	const elements: Element[] = [];
	const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);

	// skip the root canvasElement itself, as we're only interested in its descendants
	let current = walker.nextNode();

	while(current){
		if(current instanceof Element){
			elements.push(current);
		}
		current = walker.nextNode();
	}

	return elements;
}

function getBaselineStyles(
	element: Element,
	baselineDocument: Document,
	baselineCache: Map<string, Record<string, string>>,
): Record<string, string> {
	const signature = getBaselineSignature(element);
	const cachedStyles = baselineCache.get(signature);
	if (cachedStyles) {
		return cachedStyles;
	}

	const { baselineElement, mountNode } = createBaselineElement(element, baselineDocument);
	baselineDocument.body.appendChild(mountNode);

	const styles = toStyleRecord(baselineDocument.defaultView!.getComputedStyle(baselineElement));
	baselineCache.set(signature, styles);
	mountNode.remove();

	return styles;
}

function createBaselineElement(
	sourceElement: Element,
	baselineDocument: Document,
): { baselineElement: Element; mountNode: Element } {
	const namespace = sourceElement.namespaceURI;
	const tagName = sourceElement.localName;
	const baselineElement =
		namespace && namespace !== HTML_NAMESPACE
			? baselineDocument.createElementNS(namespace, tagName)
			: baselineDocument.createElement(tagName);

	copyBaselineAttributes(sourceElement, baselineElement);

	if (namespace === SVG_NAMESPACE && tagName !== 'svg') {
		const svgRoot = baselineDocument.createElementNS(SVG_NAMESPACE, 'svg');
		svgRoot.appendChild(baselineElement);
		return {
			baselineElement,
			mountNode: svgRoot,
		};
	}

	return {
		baselineElement,
		mountNode: baselineElement,
	};
}

function copyBaselineAttributes(sourceElement: Element, targetElement: Element) {
	for (const attributeName of COMMON_BASELINE_ATTRIBUTES) {
		const value = sourceElement.getAttribute(attributeName);
		if (value !== null) {
			targetElement.setAttribute(attributeName, value);
		}
	}

	const tagSpecificAttributes =
		BASELINE_ATTRIBUTES_BY_TAG[
			sourceElement.localName as keyof typeof BASELINE_ATTRIBUTES_BY_TAG
		] ?? [];
	for (const attributeName of tagSpecificAttributes) {
		const value = sourceElement.getAttribute(attributeName);
		if (value !== null) {
			targetElement.setAttribute(attributeName, value);
		}
	}
}

function getBaselineSignature(element: Element): string {
	const tagSpecificAttributes =
		BASELINE_ATTRIBUTES_BY_TAG[element.localName as keyof typeof BASELINE_ATTRIBUTES_BY_TAG] ?? [];
	const attributes = [...COMMON_BASELINE_ATTRIBUTES, ...tagSpecificAttributes]
		.map((attributeName) => `${attributeName}=${element.getAttribute(attributeName) ?? ''}`)
		.join('|');

	return `${element.namespaceURI ?? HTML_NAMESPACE}|${element.localName}|${attributes}`;
}

function toStyleRecord(styleDeclaration: CSSStyleDeclaration): Record<string, string> {
	const styles: Record<string, string> = {};

	for (const propertyName of Array.from(styleDeclaration)) {
		if (!propertyName || propertyName.startsWith('--')) {
			continue;
		}

		styles[propertyName] = styleDeclaration.getPropertyValue(propertyName).trim();
	}

	return styles;
}

function diffComputedStyles(
	styleDeclaration: CSSStyleDeclaration,
	baselineStyles: Record<string, string>,
): Record<string, string> {
	const differences = new Map<string, string>();

	for (const propertyName of Array.from(styleDeclaration)) {
		if (
			!propertyName ||
			propertyName.startsWith('--') ||
			OMITTED_COMPUTED_STYLE_PROPERTIES.has(propertyName)
		) {
			continue;
		}

		const value = styleDeclaration.getPropertyValue(propertyName).trim();
		if (value !== baselineStyles[propertyName]) {
			differences.set(propertyName, value);
		}
	}

	compressPadding(differences);
	compressBorderRadius(differences);
	compressBorder(differences);
	removeDuplicateLogicalProperties(differences);

	return Object.fromEntries(differences);
}

function buildElementSelector(element: Element, root: Element): string {
	const segments: string[] = [];
	let currentElement: Element | null = element;

	while (currentElement) {
		const segment = buildSelectorSegment(currentElement, currentElement === element);
		if (segment) {
			segments.unshift(segment);
		}

		if (currentElement === root) {
			break;
		}

		currentElement = currentElement.parentElement;
	}

	return segments.join(' > ');
}

function buildSelectorSegment(element: Element, forceInclude: boolean): string | undefined {
	const classes = getSelectorClasses(element);
	const dataAttributes = getDataAttributes(element);
	const id = getSelectorId(element);
	const role = element.getAttribute('role');
	const ariaLabel = element.getAttribute('aria-label');
	const name = element.getAttribute('name');
	const type = element.getAttribute('type');

	if (
		!forceInclude &&
		!id &&
		classes.length === 0 &&
		dataAttributes.length === 0 &&
		!role &&
		!ariaLabel &&
		!name &&
		!type
	) {
		return undefined;
	}

	let segment = element.localName;

	if (id) {
		segment += `#${CSS.escape(id)}`;
	}

	for (const className of classes) {
		segment += `.${CSS.escape(className)}`;
	}

	for (const { name, value } of dataAttributes) {
		segment += `[${name}="${escapeAttributeValue(value)}"]`;
	}

	if (role) {
		segment += `[role="${escapeAttributeValue(role)}"]`;
	}

	if (ariaLabel) {
		segment += `[aria-label="${escapeAttributeValue(ariaLabel)}"]`;
	}

	if (name) {
		segment += `[name="${escapeAttributeValue(name)}"]`;
	}

	if (type) {
		segment += `[type="${escapeAttributeValue(type)}"]`;
	}

	return segment;
}

function getSelectorId(element: Element): string | undefined {
	return element.id && !isInternalSelectorId(element.id) ? element.id : undefined;
}

function getSelectorClasses(element: Element): string[] {
	return Array.from(element.classList).filter((className) => !isInternalSelectorClass(className));
}

function isInternalSelectorClass(className: string): boolean {
	return INTERNAL_SELECTOR_CLASS_PATTERNS.some((pattern) => pattern.test(className));
}

function isInternalSelectorId(id: string): boolean {
	return INTERNAL_SELECTOR_ID_PATTERNS.some((pattern) => pattern.test(id));
}

function getDataAttributes(element: Element): Array<{ name: string; value: string }> {
	return Array.from(element.attributes)
		.filter((attribute) => attribute.name.startsWith('data-'))
		.sort((left, right) => left.name.localeCompare(right.name))
		.map((attribute) => ({ name: attribute.name, value: attribute.value }));
}

function compressPadding(differences: Map<string, string>) {
	const top = differences.get('padding-top');
	const right = differences.get('padding-right');
	const bottom = differences.get('padding-bottom');
	const left = differences.get('padding-left');

	if (!top || !right || !bottom || !left) {
		return;
	}

	differences.set('padding', toBoxShorthand(top, right, bottom, left));
	for (const propertyName of [
		'padding-top',
		'padding-right',
		'padding-bottom',
		'padding-left',
		'padding-block-start',
		'padding-block-end',
		'padding-inline-start',
		'padding-inline-end',
	]) {
		differences.delete(propertyName);
	}
}

function compressBorderRadius(differences: Map<string, string>) {
	const topLeft = differences.get('border-top-left-radius');
	const topRight = differences.get('border-top-right-radius');
	const bottomRight = differences.get('border-bottom-right-radius');
	const bottomLeft = differences.get('border-bottom-left-radius');

	if (!topLeft || !topRight || !bottomRight || !bottomLeft) {
		return;
	}

	differences.set('border-radius', toBoxShorthand(topLeft, topRight, bottomRight, bottomLeft));
	for (const propertyName of [
		'border-top-left-radius',
		'border-top-right-radius',
		'border-bottom-right-radius',
		'border-bottom-left-radius',
		'border-start-start-radius',
		'border-start-end-radius',
		'border-end-end-radius',
		'border-end-start-radius',
	]) {
		differences.delete(propertyName);
	}
}

function compressBorder(differences: Map<string, string>) {
	const widths = [
		differences.get('border-top-width'),
		differences.get('border-right-width'),
		differences.get('border-bottom-width'),
		differences.get('border-left-width'),
	];
	const styles = [
		differences.get('border-top-style'),
		differences.get('border-right-style'),
		differences.get('border-bottom-style'),
		differences.get('border-left-style'),
	];
	const colors = [
		differences.get('border-top-color'),
		differences.get('border-right-color'),
		differences.get('border-bottom-color'),
		differences.get('border-left-color'),
	];

	if (widths.some((value) => value === undefined) || styles.some((value) => value === undefined)) {
		return;
	}

	if (widths.every((value) => value === '0px') && styles.every((value) => value === 'none')) {
		differences.set('border', '0');
		removeBorderLonghands(differences);
		return;
	}

	if (
		allEqual(widths) &&
		allEqual(styles) &&
		colors.every((value) => value !== undefined) &&
		allEqual(colors)
	) {
		const [width] = widths;
		const [style] = styles;
		const [color] = colors as string[];
		if (width && style) {
			differences.set('border', `${width} ${style}${color ? ` ${color}` : ''}`.trim());
			removeBorderLonghands(differences);
		}
	}
}

function removeBorderLonghands(differences: Map<string, string>) {
	for (const propertyName of [
		'border-top-width',
		'border-right-width',
		'border-bottom-width',
		'border-left-width',
		'border-top-style',
		'border-right-style',
		'border-bottom-style',
		'border-left-style',
		'border-top-color',
		'border-right-color',
		'border-bottom-color',
		'border-left-color',
		'border-block-start-width',
		'border-block-end-width',
		'border-inline-start-width',
		'border-inline-end-width',
		'border-block-start-style',
		'border-block-end-style',
		'border-inline-start-style',
		'border-inline-end-style',
		'border-block-start-color',
		'border-block-end-color',
		'border-inline-start-color',
		'border-inline-end-color',
	]) {
		differences.delete(propertyName);
	}
}

function removeDuplicateLogicalProperties(differences: Map<string, string>) {
	for (const propertyName of [
		'padding-block-start',
		'padding-block-end',
		'padding-inline-start',
		'padding-inline-end',
	]) {
		differences.delete(propertyName);
	}
}

function toBoxShorthand(top: string, right: string, bottom: string, left: string): string {
	if (top === right && top === bottom && top === left) {
		return top;
	}

	if (top === bottom && right === left) {
		return `${top} ${right}`;
	}

	if (right === left) {
		return `${top} ${right} ${bottom}`;
	}

	return `${top} ${right} ${bottom} ${left}`;
}

function allEqual(values: Array<string | undefined>): values is string[] {
	return values.length > 0 && values.every((value) => value === values[0] && value !== undefined);
}

function escapeAttributeValue(value: string): string {
	return value.replaceAll('"', '\\"');
}
