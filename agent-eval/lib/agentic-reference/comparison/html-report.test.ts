import { describe, expect, it } from 'vitest';

import {
	renderHtmlReport,
	type CurveInput,
	type EstimateRow,
	type ManifestJson,
} from './html-report.ts';

const CONTROL = { caseName: 'cc-control', experiment: 'agentic-ref-cc-control', shortName: 'control-none' };
const TREATMENT_A = { caseName: 'cc-a', experiment: 'agentic-ref-cc-a', shortName: 'full' };
const TREATMENT_B = { caseName: 'cc-b', experiment: 'agentic-ref-cc-b', shortName: 'empty' };

function manifest(overrides: Partial<ManifestJson> = {}): ManifestJson {
	return {
		spec: {
			control: CONTROL,
			treatments: [TREATMENT_A, TREATMENT_B],
			workflows: ['701-new-ui-flow'],
			mode: 'single-workflow',
			minRuns: 10,
			plan: null,
		},
		metrics: [
			{
				key: 'durationSeconds',
				label: 'Duration (s)',
				path: 'speed.durationSeconds',
				family: 'speed',
				transform: 'log',
				direction: 'lower-better',
			},
			{
				key: 'slocAdded',
				label: 'SLOC added',
				path: 'diff.slocAdded',
				family: 'diff',
				transform: 'log0',
				direction: 'neutral',
			},
			{
				key: 'docsCalls',
				label: 'Docs tool calls',
				path: 'toolUse.docsCalls',
				family: 'toolUse',
				transform: 'none',
				direction: 'neutral',
			},
			{
				key: 'dsShareOfAllNodes',
				label: 'DS share of all nodes',
				path: 'dsCoverage.dsShareOfAllNodes',
				family: 'dsCoverage',
				transform: 'none',
				direction: 'higher-better',
			},
		],
		cells: [
			{
				case: 'control-none',
				workflow: '701-new-ui-flow',
				usableRuns: 10,
				passed: 10,
				failed: 0,
				unanalyzed: 0,
				superseded: 0,
			},
		],
		excludedRuns: [],
		provenance: { generatedAt: '2026-08-19T13:17:30.749Z', gitSha: 'd428141de68c0eeeb17518f3f25b046c0fa65835', metricsVersion: 7 },
		...overrides,
	};
}

function row(overrides: Partial<EstimateRow>): EstimateRow {
	return {
		metric: 'durationSeconds',
		treatment: 'full',
		scope: '701-new-ui-flow',
		context: false,
		nControl: 10,
		nTreatment: 10,
		beta: -0.2,
		se: 0.05,
		ciLow: -0.3,
		ciHigh: -0.1,
		p: 0.001,
		pctChange: -0.18,
		q: 0.01,
		verdict: 'significant',
		direction: 'lower-better',
		transform: 'log',
		anomalies: 0,
		...overrides,
	};
}

describe('renderHtmlReport', () => {
	it('never uses better/worse language for a neutral-direction metric', () => {
		const html = renderHtmlReport({
			estimates: [
				row({
					metric: 'docsCalls',
					direction: 'neutral',
					transform: 'none',
					pctChange: null,
					beta: 3.2,
					ciLow: 2.9,
					ciHigh: 3.6,
				}),
			],
			manifest: manifest(),
			curves: [],
		});
		expect(html).toContain('changed');
		expect(html).not.toMatch(/>better</);
		expect(html).not.toMatch(/>worse</);
	});

	it('renders log and log0 transforms as percentages, and none as an absolute delta', () => {
		const html = renderHtmlReport({
			estimates: [
				row({ metric: 'durationSeconds', transform: 'log', beta: -0.2231, pctChange: -0.2 }),
				row({
					metric: 'slocAdded',
					direction: 'neutral',
					transform: 'log0',
					beta: -0.223,
					pctChange: -0.2,
				}),
				row({
					metric: 'docsCalls',
					direction: 'neutral',
					transform: 'none',
					beta: 3.2,
					ciLow: 2.9,
					ciHigh: 3.6,
					pctChange: null,
				}),
			],
			manifest: manifest(),
			curves: [],
		});
		// log and log0 both display as a percent.
		expect(html).toContain('−20.0%');
		// 'none' shows the absolute beta, not a percent.
		expect(html).toContain('+3.2');
	});

	it('scales the two DS-share metrics to percentage points, not raw fractions', () => {
		const html = renderHtmlReport({
			estimates: [
				row({
					metric: 'dsShareOfAllNodes',
					direction: 'higher-better',
					transform: 'none',
					beta: 0.0151,
					ciLow: 0.005,
					ciHigh: 0.025,
					pctChange: null,
				}),
			],
			manifest: manifest(),
			curves: [],
		});
		expect(html).toContain('+1.51 pp');
	});

	it('escapes treatment and metric-adjacent text into HTML', () => {
		const html = renderHtmlReport({
			estimates: [row({ treatment: '<script>alert(1)</script>' })],
			manifest: manifest({
				spec: {
					...manifest().spec,
					treatments: [
						{ caseName: 'x', experiment: 'x', shortName: '<script>alert(1)</script>' },
						TREATMENT_B,
					],
				},
			}),
			curves: [],
		});
		expect(html).not.toContain('<script>alert(1)</script>');
		expect(html).toContain('&lt;script&gt;');
	});

	it('marks significant rows and leaves not-significant rows unmarked', () => {
		const html = renderHtmlReport({
			estimates: [
				row({ treatment: 'full', verdict: 'significant', q: 0.001 }),
				row({ treatment: 'empty', verdict: 'not-significant', q: 0.2, beta: -0.05, pctChange: -0.05 }),
			],
			manifest: manifest(),
			curves: [],
		});
		expect(html).toContain('class="t-full significant"');
		expect(html).toContain('class="t-empty "');
		expect(html).toContain('no call');
	});

	it('drops the XML prolog, DOCTYPE, and metadata block, keeping the svg element', () => {
		const svg: CurveInput = {
			metric: 'durationSeconds',
			workflow: '701-new-ui-flow',
			svg:
				'<?xml version="1.0" encoding="utf-8" standalone="no"?>\n' +
				'<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">\n' +
				'<svg xmlns="http://www.w3.org/2000/svg" width="504pt" height="324pt">\n' +
				' <metadata>\n  <rdf:RDF>irrelevant</rdf:RDF>\n </metadata>\n' +
				' <rect width="1" height="1"/>\n</svg>\n',
		};
		const html = renderHtmlReport({
			estimates: [row({ metric: 'durationSeconds' })],
			manifest: manifest(),
			curves: [svg],
		});
		expect(html).not.toContain('<?xml');
		expect(html).not.toContain('<!DOCTYPE');
		expect(html).not.toContain('<metadata>');
		expect(html).not.toContain('irrelevant');
		expect(html).toContain('<svg xmlns="http://www.w3.org/2000/svg" width="504pt" height="324pt">');
		expect(html).toContain('<rect width="1" height="1"/>');
	});

	it('excludes context rows (per-workflow breakdowns) from the summary and table', () => {
		const html = renderHtmlReport({
			estimates: [
				row({ treatment: 'full', context: false, verdict: 'significant', q: 0.001 }),
				row({ treatment: 'full', context: true, verdict: null, q: null, scope: 'other-flow' }),
			],
			manifest: manifest(),
			curves: [],
		});
		expect(html).not.toContain('other-flow');
	});
});
