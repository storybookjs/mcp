import { describe, expect, it } from 'vitest';
import { isReExportBarrel } from './compute-cascade.ts';

describe('isReExportBarrel', () => {
	it('detects `export * from` (the mealdrop index.tsx shape)', () => {
		expect(isReExportBarrel("export * from './Badge'")).toBe(true);
	});

	it('detects `export { … } from`', () => {
		expect(isReExportBarrel("export { Badge } from './Badge';")).toBe(true);
	});

	it('detects `export * as ns from`', () => {
		expect(isReExportBarrel("export * as badge from './Badge';")).toBe(true);
	});

	it('detects `export type { … } from`', () => {
		expect(isReExportBarrel("export type { BadgeProps } from './Badge';")).toBe(true);
	});

	it('detects multiple re-exports with comments and blank lines', () => {
		expect(
			isReExportBarrel("// barrel file\nexport * from './A';\n\nexport { B } from './B';\n"),
		).toBe(true);
	});

	it('detects a multi-line named re-export', () => {
		expect(isReExportBarrel("export {\n  A,\n  B,\n} from './things';")).toBe(true);
	});

	it('rejects a real component file', () => {
		expect(
			isReExportBarrel("import React from 'react';\nexport const Badge = () => null;"),
		).toBe(false);
	});

	it('rejects a barrel with a side-effect import alongside the re-export', () => {
		expect(isReExportBarrel("import './styles.css';\nexport * from './Badge';")).toBe(false);
	});

	it('rejects a local re-export with no module source', () => {
		expect(isReExportBarrel('const x = 1;\nexport { x };')).toBe(false);
	});

	it('rejects an empty file', () => {
		expect(isReExportBarrel('')).toBe(false);
	});
});
