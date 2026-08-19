import { describe, expect, it } from 'vitest';

import {
	formatBeta,
	formatMetricValue,
	formatPQ,
	renderHtmlReport,
	type CurveInput,
	type DatasetRow,
	type EstimateRow,
	type ManifestJson,
} from './html-report.ts';

const CONTROL = {
	caseName: 'cc-control',
	experiment: 'agentic-ref-cc-control',
	shortName: 'control-none',
};
const TREATMENT_A = {
	caseName: 'cc-a',
	experiment: 'agentic-ref-cc-a',
	shortName: 'full',
};
const TREATMENT_B = {
	caseName: 'cc-b',
	experiment: 'agentic-ref-cc-b',
	shortName: 'empty',
};

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
			{
				case: 'full',
				workflow: '701-new-ui-flow',
				usableRuns: 10,
				passed: 10,
				failed: 0,
				unanalyzed: 0,
				superseded: 3,
			},
		],
		excludedRuns: [],
		provenance: {
			generatedAt: '2026-08-19T13:17:30.749Z',
			gitSha: 'd428141de68c0eeeb17518f3f25b046c0fa65835',
			metricsVersion: 7,
		},
		...overrides,
	};
}

function aggregateManifest(): ManifestJson {
	const base = manifest();
	return {
		...base,
		spec: {
			...base.spec,
			workflows: ['701-new-ui-flow', '703-fix-bug-flow'],
			mode: 'aggregate',
		},
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

function datasetRow(overrides: Partial<DatasetRow> = {}): DatasetRow {
	return {
		case: 'control-none',
		workflow: '701-new-ui-flow',
		values: {
			durationSeconds: 1281,
			docsCalls: 4,
			dsShareOfAllNodes: 0.465,
			slocAdded: 1200,
		},
		...overrides,
	};
}

function render(overrides: {
	estimates?: EstimateRow[];
	manifest?: ManifestJson;
	curves?: CurveInput[];
	dataset?: DatasetRow[];
}): string {
	return renderHtmlReport({
		estimates: overrides.estimates ?? [row({})],
		manifest: overrides.manifest ?? manifest(),
		curves: overrides.curves ?? [],
		dataset: overrides.dataset ?? [datasetRow()],
	});
}

describe('formatMetricValue', () => {
	it('humanizes durations into s, m, and h forms', () => {
		expect(formatMetricValue('durationSeconds', 42)).toBe('42s');
		expect(formatMetricValue('durationSeconds', 1281)).toBe('21m 21s');
		expect(formatMetricValue('durationSeconds', 3700)).toBe('1h 02m');
	});

	it('formats dollars, tokens, rates, and counts per metric', () => {
		expect(formatMetricValue('estimatedCostUsd', 9.853)).toBe('$9.85');
		expect(formatMetricValue('inputTokens', 226)).toBe('226');
		expect(formatMetricValue('outputTokens', 86000)).toBe('86.0k');
		expect(formatMetricValue('outputTokens', 1200000)).toBe('1.2M');
		expect(formatMetricValue('cacheHitRate', 0.988)).toBe('98.8%');
		expect(formatMetricValue('dsShareOfAllNodes', 0.465)).toBe('46.5%');
		expect(formatMetricValue('turns', 14.55)).toBe('14.6');
		expect(formatMetricValue('slocNet', 1342)).toBe('1,342');
	});
});

describe('formatBeta / formatPQ', () => {
	it('renders four decimals and never exponent form', () => {
		expect(formatBeta(-0.24656040212469432)).toBe('−0.2466');
		expect(formatBeta(1.9000000000000006)).toBe('1.9000');
		expect(formatPQ(0.0005718250301111768)).toBe('0.0006');
	});

	it('floors tiny p/q values instead of using exponents', () => {
		expect(formatPQ(0.00003)).toBe('< 0.0001');
		expect(formatPQ(8.577375451667651e-9)).toBe('< 0.0001');
	});
});

describe('renderHtmlReport structure', () => {
	it('renders four tabs: Summary, Effects, Full report, Curves', () => {
		const html = render({});
		const tabs = html.match(/role="tab"/g) ?? [];
		expect(tabs).toHaveLength(4);
		expect(html).toContain('Effects at a glance');
		expect(html).toContain('Full report');
		expect(html).toContain('Curves');
	});

	it('places Summary before Sample in the summary tab', () => {
		const html = render({});
		expect(html.indexOf('>Summary</h2>')).toBeGreaterThan(-1);
		expect(html.indexOf('>Summary</h2>')).toBeLessThan(html.indexOf('>Sample</h2>'));
	});

	it('slims the sample table to runs used and highlights the control row', () => {
		const html = render({});
		expect(html).not.toContain('<th>Failed</th>');
		expect(html).not.toContain('<th>Superseded</th>');
		expect(html).not.toContain('<th>Passed</th>');
		expect(html).toContain('<th>Runs used</th>');
		expect(html).toMatch(/class="control-row"/);
		expect(html).toContain('>control<');
	});

	it('explains BH-FDR: multiple tests, false-discovery control, the q rule', () => {
		const html = render({
			estimates: [row({}), row({ treatment: 'empty', q: 0.2, verdict: 'not-significant' })],
		});
		expect(html).toContain('Benjamini');
		expect(html).toMatch(/false/i);
		expect(html).toContain('2 tests');
		expect(html).toContain('q &le; 0.05');
	});

	it('mentions equal workflow weighting only in aggregate mode', () => {
		expect(
			render({
				manifest: aggregateManifest(),
				estimates: [row({ scope: 'pooled' })],
			})
		).toContain('every workflow equally');
		expect(render({})).not.toContain('every workflow equally');
	});

	it('groups effects into family sections with intros', () => {
		const html = render({
			estimates: [
				row({}),
				row({
					metric: 'docsCalls',
					direction: 'neutral',
					transform: 'none',
					pctChange: null,
					beta: 3.2,
				}),
			],
		});
		expect(html).toContain('>Speed</h3>');
		expect(html).toContain('>Tool use</h3>');
		// A family with no estimates renders no section.
		expect(html).not.toContain('>Complexity</h3>');
	});

	it('never renders the degree-sign marker and states the new legend copy', () => {
		const html = render({
			estimates: [row({ verdict: 'not-significant', q: 0.2 })],
		});
		expect(html).not.toContain('&deg;');
		expect(html).not.toContain('°');
		expect(html).toContain('not significant');
		expect(html).toContain('control value');
	});

	it('prints the control value at the center line with mean and median variants', () => {
		const html = render({
			dataset: [
				datasetRow({ values: { durationSeconds: 900 } }),
				datasetRow({ values: { durationSeconds: 1600 } }),
				datasetRow({ case: 'full', values: { durationSeconds: 800 } }),
			],
		});
		// Geometric mean of 900 and 1600 = 1200s = 20m 0s; median = 1250s.
		expect(html).toContain('data-mean="20m 00s"');
		expect(html).toContain('data-median="20m 50s"');
	});

	it('attaches popover data to forest marks', () => {
		const html = render({});
		expect(html).toContain('data-tip-effect=');
		expect(html).toContain('data-tip-control=');
		expect(html).toContain('data-tip-treatment=');
		expect(html).toContain('id="tip"');
	});

	it('renders the filter bar with significance select and reset button', () => {
		const html = render({});
		expect(html).toContain('id="sigFilter"');
		expect(html).toContain('id="resetFilters"');
	});

	it('renders a workflow select only in aggregate mode', () => {
		expect(render({})).not.toContain('id="wfFilter"');
		const html = render({
			manifest: aggregateManifest(),
			estimates: [
				row({ scope: 'pooled' }),
				row({
					scope: '701-new-ui-flow',
					context: true,
					q: null,
					verdict: null,
				}),
			],
		});
		expect(html).toContain('id="wfFilter"');
		expect(html).toContain('not FDR-tested');
	});

	it('renders context rows hidden, scoped to their workflow, in aggregate mode', () => {
		const html = render({
			manifest: aggregateManifest(),
			estimates: [
				row({ scope: 'pooled' }),
				row({
					scope: '703-fix-bug-flow',
					context: true,
					q: null,
					verdict: null,
					beta: -0.4,
					pctChange: -0.33,
				}),
			],
		});
		expect(html).toContain('data-scope="703-fix-bug-flow"');
	});

	it('omits context rows entirely in single-workflow mode', () => {
		const html = render({
			estimates: [row({}), row({ context: true, verdict: null, q: null, scope: 'other-flow' })],
		});
		expect(html).not.toContain('other-flow');
	});
});

describe('renderHtmlReport full report table', () => {
	it('uses a sticky-header table with n, effect, CI, beta, p, q columns', () => {
		const html = render({});
		expect(html).toContain('<thead>');
		expect(html).toContain('<th>n</th>');
		expect(html).toContain('<th class="num nocase">β</th>');
		expect(html).toContain('<th class="num nocase">p</th>');
		expect(html).toContain('<th class="num nocase">q</th>');
		expect(html).toContain('10 / 10');
	});

	it('marks non-significant rows for dimming via data-sig', () => {
		const html = render({
			estimates: [
				row({ verdict: 'significant', q: 0.001 }),
				row({
					treatment: 'empty',
					verdict: 'not-significant',
					q: 0.2,
					beta: -0.05,
					pctChange: -0.05,
				}),
			],
		});
		expect(html).toContain('data-sig="1"');
		expect(html).toContain('data-sig="0"');
	});

	it('formats beta, p, and q to four decimals without exponents', () => {
		const html = render({
			estimates: [
				row({
					beta: -0.24656040212469432,
					p: 8.577375451667651e-5,
					q: 0.0005718250301111768,
				}),
			],
		});
		expect(html).toContain('−0.2466');
		expect(html).toContain('0.0001');
		expect(html).toContain('0.0006');
		expect(html).not.toMatch(/e-\d/);
	});

	it('lists untested metric-treatment pairs', () => {
		// Four metrics x two treatments = 8 potential tests; only one ran.
		const html = render({ estimates: [row({})] });
		expect(html).toContain('Not tested');
		expect(html).toContain('docsCalls');
	});
});

describe('renderHtmlReport effect display', () => {
	it('never uses better/worse language for a neutral-direction metric', () => {
		const html = render({
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
		});
		expect(html).toContain('changed');
		expect(html).not.toMatch(/>better</);
		expect(html).not.toMatch(/>worse</);
	});

	it('renders log transforms as percentages and counts with one decimal', () => {
		const html = render({
			estimates: [
				row({
					metric: 'durationSeconds',
					transform: 'log',
					beta: -0.2231,
					pctChange: -0.2,
				}),
				row({
					metric: 'docsCalls',
					direction: 'neutral',
					transform: 'none',
					beta: 3.24,
					ciLow: 2.9,
					ciHigh: 3.6,
					pctChange: null,
				}),
			],
		});
		expect(html).toContain('−20.0%');
		expect(html).toContain('+3.2');
		expect(html).not.toContain('+3.24');
	});

	it('renders share-metric effects as %, never pp', () => {
		const html = render({
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
		});
		expect(html).toContain('+1.5%');
		expect(html).not.toMatch(/\d ?pp/);
	});
});

describe('renderHtmlReport curves and escaping', () => {
	it('escapes treatment and metric-adjacent text into HTML', () => {
		const html = render({
			estimates: [row({ treatment: '<script>alert(1)</script>' })],
			manifest: manifest({
				spec: {
					...manifest().spec,
					treatments: [
						{
							caseName: 'x',
							experiment: 'x',
							shortName: '<script>alert(1)</script>',
						},
						TREATMENT_B,
					],
				},
			}),
		});
		expect(html).not.toContain('<script>alert(1)</script>');
		expect(html).toContain('&lt;script&gt;');
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
		const html = render({ curves: [svg] });
		expect(html).not.toContain('<?xml');
		expect(html).not.toContain('<!DOCTYPE svg');
		expect(html).not.toContain('<metadata>');
		expect(html).not.toContain('irrelevant');
		expect(html).toContain('<svg xmlns="http://www.w3.org/2000/svg" width="504pt" height="324pt">');
		expect(html).toContain('<rect width="1" height="1"/>');
	});

	it('tags curve panels with their workflow for filtering', () => {
		const svg: CurveInput = {
			metric: 'durationSeconds',
			workflow: '701-new-ui-flow',
			svg: '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
		};
		const html = render({ curves: [svg] });
		expect(html).toContain('data-workflow="701-new-ui-flow"');
	});
});
