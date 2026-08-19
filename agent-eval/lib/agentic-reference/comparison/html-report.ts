// Self-contained HTML rendering of a results:compare comparison. Reads the
// estimates.json/manifest.json/dataset.csv/curves that the statistics stage
// emits and renders them as one static tabbed page: no server, no build step,
// no external requests beyond the Google Fonts stylesheet.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export type EstimateVerdict = 'significant' | 'not-significant';
export type EstimateTransform = 'log' | 'log0' | 'none';
export type EstimateDirection = 'lower-better' | 'higher-better' | 'neutral';

export interface EstimateRow {
	metric: string;
	treatment: string;
	scope: string;
	context: boolean;
	nControl: number;
	nTreatment: number;
	beta: number;
	se: number;
	ciLow: number;
	ciHigh: number;
	p: number;
	pctChange: number | null;
	q: number | null;
	verdict: EstimateVerdict | null;
	direction: EstimateDirection;
	transform: EstimateTransform;
	anomalies: number | null;
}

interface ManifestCase {
	caseName: string;
	experiment: string;
	shortName: string;
}

interface ManifestMetric {
	key: string;
	label: string;
	path: string;
	family: string;
	transform: EstimateTransform;
	direction: EstimateDirection;
}

interface ManifestCell {
	case: string;
	workflow: string;
	usableRuns: number;
	passed: number;
	failed: number;
	unanalyzed: number;
	superseded: number;
}

export interface ManifestJson {
	spec: {
		control: ManifestCase;
		treatments: ManifestCase[];
		workflows: string[];
		mode: 'single-workflow' | 'aggregate';
		minRuns: number;
		plan: string | null;
	};
	metrics: ManifestMetric[];
	/** Stable per-case colors; absent in manifests from before they existed. */
	colors?: Record<string, { light: string; dark: string }>;
	cells: ManifestCell[];
	excludedRuns: { path?: string; reason?: string }[];
	provenance: {
		generatedAt?: string;
		gitSha?: string | null;
		metricsVersion?: number | string | null;
		statsmodels?: string;
		[key: string]: unknown;
	};
}

export interface CurveInput {
	metric: string;
	workflow: string;
	svg: string;
}

/** One usable run's raw metric values, straight from dataset.csv. */
export interface DatasetRow {
	case: string;
	workflow: string;
	values: Record<string, number | null>;
}

export interface HtmlReportInput {
	estimates: EstimateRow[];
	manifest: ManifestJson;
	curves: CurveInput[];
	dataset: DatasetRow[];
}

// Plain-English name and one-line description per metric. Metrics outside
// this map render under their raw registry key with no description.
const METRICS: Record<string, { name: string; description: string }> = {
	estimatedCostUsd: {
		name: 'Cost per run',
		description: 'How many dollars one run spends',
	},
	durationSeconds: {
		name: 'Time to finish',
		description: 'Wall-clock seconds per run',
	},
	outputTokens: {
		name: 'Output tokens',
		description: 'Text and code the model writes',
	},
	cacheHitRate: {
		name: 'Cache hit rate',
		description: 'Share of context read from cache',
	},
	inputTokens: {
		name: 'Uncached input tokens',
		description: 'Context paid at the raw rate',
	},
	turns: { name: 'Conversation turns', description: 'Agent loop iterations' },
	totalToolCalls: { name: 'Tool calls', description: 'Every tool invocation' },
	docsCalls: {
		name: 'Documentation lookups',
		description: 'Calls that read DS docs (MCP)',
	},
	explorationCalls: {
		name: 'Exploration calls',
		description: 'Reading and searching the codebase',
	},
	editCalls: { name: 'Edit calls', description: 'File-writing tool calls' },
	verificationCalls: {
		name: 'Verification calls',
		description: 'Tests, typechecks, build checks',
	},
	filesEdited: {
		name: 'Files touched',
		description: 'Distinct files the agent edited',
	},
	diffFilesChanged: {
		name: 'Files changed in diff',
		description: 'Files in the final change',
	},
	slocAdded: {
		name: 'Lines added',
		description: 'Source lines the change adds',
	},
	slocNet: { name: 'Net lines', description: 'Adds minus removals' },
	dsShareOfAllNodes: {
		name: 'DS share of UI',
		description: 'Design-system share of rendered nodes',
	},
	dsShareOfComponentNodes: {
		name: 'DS share of components',
		description: 'DS share of component nodes only',
	},
	cyclomaticDelta: {
		name: 'Cyclomatic complexity added',
		description: 'Branching complexity the change adds',
	},
	cognitiveDelta: {
		name: 'Cognitive complexity added',
		description: 'Readability cost the change adds',
	},
	jsxCognitiveDelta: {
		name: 'JSX complexity added',
		description: 'Markup complexity the change adds',
	},
};

// Metric families, in registry order, with a short intro each.
const FAMILIES: Record<string, { name: string; intro: string }> = {
	speed: {
		name: 'Speed',
		intro: 'How long a run takes: wall-clock time and agent-loop turns.',
	},
	cost: {
		name: 'Cost',
		intro: 'What a run spends: dollars, tokens, cache efficiency, and total tool calls.',
	},
	toolUse: {
		name: 'Tool use',
		intro:
			'Where the calls go: docs, exploration, edits, verification. Descriptive — more is not inherently better or worse.',
	},
	churn: {
		name: 'Churn',
		intro: 'How many files the agent touches while working.',
	},
	dsCoverage: {
		name: 'DS coverage',
		intro: 'How much of the produced UI uses the design system.',
	},
	complexity: {
		name: 'Complexity',
		intro: 'Code complexity the change adds over the baseline.',
	},
	diff: { name: 'Diff footprint', intro: 'The size of the final change.' },
};

// Metrics measured as a 0-1 share; values and absolute-delta effects display
// as percentages (value * 100), never as a relative percent change.
const SHARE_METRICS = new Set(['dsShareOfAllNodes', 'dsShareOfComponentNodes', 'cacheHitRate']);

// Small-count metrics whose values and deltas display with one decimal.
const COUNT_METRICS = new Set([
	'turns',
	'totalToolCalls',
	'docsCalls',
	'explorationCalls',
	'editCalls',
	'verificationCalls',
	'filesEdited',
	'diffFilesChanged',
	'cyclomaticDelta',
	'cognitiveDelta',
	'jsxCognitiveDelta',
]);

// Line counts: whole numbers with thousands separators.
const SLOC_METRICS = new Set(['slocAdded', 'slocNet']);

const LIGHT_TREATMENT_COLORS = ['#C05621', '#0D8A78', '#6D5BD0'];
const DARK_TREATMENT_COLORS = ['#D4732A', '#12A38E', '#8B79E8'];
const NEUTRAL_GRAY_LIGHT = '#6B7280';
const NEUTRAL_GRAY_DARK = '#9CA3AF';

const MINUS = '−';

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

// CSS class / DOM id safe token for a treatment's short name.
function slug(name: string): string {
	return name.replace(/[^a-zA-Z0-9_-]/g, '-');
}

function formatDuration(seconds: number): string {
	if (seconds < 60) return `${Math.round(seconds)}s`;
	if (seconds < 3600) {
		let minutes = Math.floor(seconds / 60);
		let rest = Math.round(seconds - minutes * 60);
		if (rest === 60) {
			minutes += 1;
			rest = 0;
		}
		return `${minutes}m ${String(rest).padStart(2, '0')}s`;
	}
	let hours = Math.floor(seconds / 3600);
	let minutes = Math.round((seconds - hours * 3600) / 60);
	if (minutes === 60) {
		hours += 1;
		minutes = 0;
	}
	return `${hours}h ${String(minutes).padStart(2, '0')}m`;
}

function formatCompactCount(value: number): string {
	if (value >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
	if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
	return String(Math.round(value));
}

function formatPlain(value: number): string {
	const a = Math.abs(value);
	if (a >= 1000) return value.toLocaleString('en-US', { maximumFractionDigits: 0 });
	if (a >= 10) return value.toFixed(1);
	if (a >= 1) return value.toFixed(2);
	return value.toFixed(3);
}

/** A metric's absolute value, rounded and unit-annotated for that metric. */
export function formatMetricValue(key: string, value: number): string {
	if (key === 'durationSeconds') return formatDuration(value);
	if (key === 'estimatedCostUsd') return `$${value.toFixed(2)}`;
	if (key === 'outputTokens') return formatCompactCount(value);
	if (key === 'inputTokens' || SLOC_METRICS.has(key)) {
		return Math.round(value).toLocaleString('en-US');
	}
	if (SHARE_METRICS.has(key)) return `${(value * 100).toFixed(1)}%`;
	if (COUNT_METRICS.has(key)) return value.toFixed(1);
	return formatPlain(value);
}

/** OLS coefficients: three decimals, never exponent form. */
export function formatBeta(value: number): string {
	return value < 0 ? MINUS + Math.abs(value).toFixed(3) : value.toFixed(3);
}

/** p and q values: three decimals, floored instead of exponent form. */
export function formatPQ(value: number): string {
	return value < 0.0005 ? '< 0.001' : value.toFixed(3);
}

function signed(negative: boolean, body: string): string {
	return (negative ? MINUS : '+') + body;
}

function fmtPct(value: number): string {
	return signed(value < 0, `${Math.abs(value * 100).toFixed(1)}%`);
}

/** An absolute-delta effect, rounded per the metric's own display rules. */
function formatDelta(key: string, value: number): string {
	const a = Math.abs(value);
	if (SHARE_METRICS.has(key)) return signed(value < 0, `${(a * 100).toFixed(1)}%`);
	if (COUNT_METRICS.has(key)) return signed(value < 0, a.toFixed(1));
	if (SLOC_METRICS.has(key)) {
		return signed(value < 0, Math.round(a).toLocaleString('en-US'));
	}
	return signed(value < 0, formatPlain(a));
}

interface Effect {
	value: number;
	lo: number;
	hi: number;
	label: string;
	ciLabel: string;
}

// The effect a row represents, on its own display scale: a percent change for
// log/log0 transforms (beta is a log-ratio), an absolute delta otherwise —
// share metrics display the delta as a percentage.
function effectOf(row: EstimateRow): Effect {
	if (row.transform === 'log' || row.transform === 'log0') {
		const value = row.pctChange ?? Math.exp(row.beta) - 1;
		const lo = Math.exp(row.ciLow) - 1;
		const hi = Math.exp(row.ciHigh) - 1;
		return {
			value,
			lo,
			hi,
			label: fmtPct(value),
			ciLabel: `${fmtPct(lo)} to ${fmtPct(hi)}`,
		};
	}
	return {
		value: row.beta,
		lo: row.ciLow,
		hi: row.ciHigh,
		label: formatDelta(row.metric, row.beta),
		ciLabel: `${formatDelta(row.metric, row.ciLow)} to ${formatDelta(row.metric, row.ciHigh)}`,
	};
}

function directionText(direction: EstimateDirection): string {
	if (direction === 'lower-better') return 'lower is better';
	if (direction === 'higher-better') return 'higher is better';
	return 'descriptive';
}

// (a) is a directional metric win, per its own better/worse convention.
// Never called for direction === 'neutral' — those metrics are "changed", not won.
function isBetter(value: number, direction: EstimateDirection): boolean {
	return value < 0 === (direction === 'lower-better');
}

interface TreatmentStyle {
	shortName: string;
	slug: string;
	lightColor: string;
	darkColor: string;
}

// Stable colors come from the manifest (written by compare-results from
// CASE_COLORS); the index palette only serves manifests from before that.
function treatmentStyles(
	treatments: ManifestCase[],
	colors: ManifestJson['colors'],
): TreatmentStyle[] {
	return treatments.map((t, i) => {
		const assigned = colors?.[t.shortName];
		return {
			shortName: t.shortName,
			slug: slug(t.shortName),
			lightColor: assigned?.light ?? (i < 3 ? LIGHT_TREATMENT_COLORS[i]! : NEUTRAL_GRAY_LIGHT),
			darkColor: assigned?.dark ?? (i < 3 ? DARK_TREATMENT_COLORS[i]! : NEUTRAL_GRAY_DARK),
		};
	});
}

function metricName(key: string): string {
	return METRICS[key]?.name ?? key;
}

function metricDescription(key: string): string {
	return METRICS[key]?.description ?? '';
}

// ---------------------------------------------------------------------------
// Control / treatment statistics from the raw dataset

function mean(values: number[]): number {
	return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function median(values: number[]): number {
	const sorted = [...values].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function transformValue(value: number, transform: EstimateTransform): number {
	if (transform === 'log') return Math.log(value);
	if (transform === 'log0') return value === 0 ? 0 : Math.log(value);
	return value;
}

function backTransform(value: number, transform: EstimateTransform): number {
	return transform === 'none' ? value : Math.exp(value);
}

function usableValues(
	dataset: DatasetRow[],
	caseName: string,
	workflow: string,
	metric: ManifestMetric
): number[] {
	return dataset
		.filter((row) => row.case === caseName && row.workflow === workflow)
		.map((row) => row.values[metric.key])
		.filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
		.filter((v) => (metric.transform === 'log' ? v > 0 : true))
		.filter((v) => (metric.transform === 'log0' ? v >= 0 : true));
}

// The statistic the model actually references: for the mean, the average on
// the transformed scale, back-transformed (geometric mean for log metrics).
// Pooled scope combines per-workflow statistics with equal weight.
function caseStat(
	dataset: DatasetRow[],
	caseName: string,
	metric: ManifestMetric,
	scope: string,
	workflows: string[],
	kind: 'mean' | 'median'
): number | null {
	const scoped = scope === 'pooled' ? workflows : [scope];
	const perWorkflow: number[] = [];
	for (const workflow of scoped) {
		const values = usableValues(dataset, caseName, workflow, metric);
		if (values.length === 0) continue;
		perWorkflow.push(
			kind === 'median'
				? median(values)
				: mean(values.map((v) => transformValue(v, metric.transform)))
		);
	}
	if (perWorkflow.length === 0) return null;
	const combined = mean(perWorkflow);
	return kind === 'median' ? combined : backTransform(combined, metric.transform);
}

// ---------------------------------------------------------------------------
// Page sections

function buildHeader(manifest: ManifestJson): string {
	const { control, treatments, workflows } = manifest.spec;
	const title = `${control.shortName} vs ${treatments
		.map((t) => t.shortName)
		.join(' + ')} @ ${workflows.join(', ')}`;
	const provenance = manifest.provenance;
	const sha = typeof provenance.gitSha === 'string' ? provenance.gitSha.slice(0, 7) : 'unknown';
	const generatedAt =
		typeof provenance.generatedAt === 'string' ? provenance.generatedAt : 'unknown';
	const metricsVersion = provenance.metricsVersion ?? 'unknown';
	return `
<span class="eyebrow">results:compare</span>
<h1>${escapeHtml(title)}</h1>
<p class="lede mono">generated ${escapeHtml(generatedAt)} &middot; ${escapeHtml(
		sha
	)} &middot; metrics v${escapeHtml(String(metricsVersion))}</p>`;
}

function buildFilterBar(manifest: ManifestJson, styles: TreatmentStyle[]): string {
	const chips = styles
		.map(
			(t) =>
				`<button type="button" class="chip-toggle" data-t="${t.slug}" aria-pressed="true" ` +
				`style="--tc:var(--c-${t.slug})"><span class="dot"></span>${escapeHtml(
					t.shortName
				)}</button>`
		)
		.join('\n');
	const workflowSelect =
		manifest.spec.mode === 'aggregate'
			? `
<label class="select">Workflow
<select id="wfFilter">
<option value="pooled" selected>All workflows</option>
${manifest.spec.workflows
	.map((w) => `<option value="${escapeHtml(w)}">${escapeHtml(w)}</option>`)
	.join('\n')}
</select></label>`
			: '';
	return `
<div class="filterbar">
<div class="legend">${chips}</div>
<label class="select">Significance
<select id="sigFilter">
<option value="all" selected>All</option>
<option value="sig">Significant</option>
<option value="nonsig">Non-significant</option>
</select></label>${workflowSelect}
<button type="button" id="resetFilters">Reset filters</button>
</div>`;
}

// Only headline estimates enter significance testing (rows.context === false);
// per-workflow context rows in aggregate mode carry no q/verdict.
function headlineRows(estimates: EstimateRow[]): EstimateRow[] {
	return estimates.filter((row) => !row.context && row.verdict !== null);
}

function buildSummary(estimates: EstimateRow[], styles: TreatmentStyle[]): string {
	const rows = headlineRows(estimates);
	const items = styles
		.map((t) => {
			const forTreatment = rows.filter((r) => r.treatment === t.shortName);
			let better = 0;
			let worse = 0;
			let changed = 0;
			let inconclusive = 0;
			for (const row of forTreatment) {
				if (row.verdict !== 'significant') {
					inconclusive++;
				} else if (row.direction === 'neutral') {
					changed++;
				} else if (isBetter(effectOf(row).value, row.direction)) {
					better++;
				} else {
					worse++;
				}
			}
			return (
				`<li class="t-${t.slug}" data-t="${t.slug}"><span class="dot" style="background:var(--c-${t.slug})"></span>` +
				`<b>${escapeHtml(
					t.shortName
				)}</b>: ${better} better, ${worse} worse, ${changed} changed, ` +
				`${inconclusive} not significant (of ${forTreatment.length} metrics)</li>`
			);
		})
		.join('\n');
	return `
<h2>Summary</h2>
<ul class="summary">${items}</ul>`;
}

function buildStatsBox(estimates: EstimateRow[], manifest: ManifestJson): string {
	const tests = headlineRows(estimates).length;
	const aggregate = manifest.spec.mode === 'aggregate';
	const statsmodelsVersion =
		typeof manifest.provenance.statsmodels === 'string'
			? ` ${manifest.provenance.statsmodels}`
			: '';
	const lines = [
		'<li><b>Effect (β)</b> — an OLS regression coefficient of treatment vs control, with ' +
			'HC3 robust standard errors. Log-scaled metrics display exp(β)−1 as a percent change.</li>',
		'<li><b>95% CI</b> — the range that would capture the true effect in 95% of ' +
			'identical re-runs of this experiment.</li>',
		`<li><b>q (BH-FDR)</b> — this report runs ${tests} test${tests === 1 ? '' : 's'} at once; at ` +
			'p &lt; 0.05 alone, about 1 in 20 true-null tests would come out significant by luck. ' +
			'Benjamini&ndash;Hochberg corrects that multiple-testing bias by controlling the ' +
			'false-discovery rate: of the results it calls significant, at most ~5% are expected ' +
			'to be false discoveries. Significant iff q &le; 0.05.</li>',
	];
	if (aggregate) {
		lines.push(
			'<li><b>Aggregation</b> — multi-workflow effects weight every workflow equally, ' +
				'regardless of run counts.</li>'
		);
	}
	lines.push(
		`<li><b>Engine</b> — statsmodels${escapeHtml(
			statsmodelsVersion
		)} OLS (Python); details in manifest.json.</li>`
	);
	return `
<div class="statsbox">
<h3>How the statistics work</h3>
<ul>
${lines.join('\n')}
</ul>
</div>`;
}

function buildSample(manifest: ManifestJson, styles: TreatmentStyle[]): string {
	const controlShortName = manifest.spec.control.shortName;
	const bySlug = new Map(styles.map((t) => [t.shortName, t.slug]));
	const rows = manifest.cells
		.map((c) => {
			const isControl = c.case === controlShortName;
			const t = bySlug.get(c.case);
			const attrs = isControl ? 'class="control-row"' : `class="t-${t ?? ''}" data-t="${t ?? ''}"`;
			const badge = isControl ? ' <span class="chip control">control</span>' : '';
			return (
				`<tr ${attrs} data-workflow="${escapeHtml(c.workflow)}"><td>${escapeHtml(
					c.case
				)}${badge}</td>` +
				`<td>${escapeHtml(c.workflow)}</td><td class="num">${c.usableRuns}</td></tr>`
			);
		})
		.join('\n');
	return `
<h2>Sample</h2>
<div class="tablewrap"><table id="sampleTable">
<thead><tr><th>Case</th><th>Workflow</th><th>Runs used</th></tr></thead>
<tbody>
${rows}
</tbody>
</table></div>`;
}

interface Scoped {
	scope: string;
	context: boolean;
	rows: EstimateRow[];
}

// Rows for one metric, split into the headline scope and (in aggregate mode)
// one context scope per workflow. Single-workflow mode has no context scopes.
function scopesFor(metricKey: string, estimates: EstimateRow[], manifest: ManifestJson): Scoped[] {
	const headline = headlineRows(estimates).filter((row) => row.metric === metricKey);
	const defaultScope = defaultScopeOf(manifest);
	const scopes: Scoped[] = [];
	if (headline.length > 0) scopes.push({ scope: defaultScope, context: false, rows: headline });
	if (manifest.spec.mode === 'aggregate') {
		for (const workflow of manifest.spec.workflows) {
			const rows = estimates.filter(
				(row) => row.context && row.metric === metricKey && row.scope === workflow
			);
			if (rows.length > 0) scopes.push({ scope: workflow, context: true, rows });
		}
	}
	return scopes;
}

function defaultScopeOf(manifest: ManifestJson): string {
	return manifest.spec.mode === 'aggregate' ? 'pooled' : manifest.spec.workflows[0] ?? 'pooled';
}

function tipAttributes(
	row: EstimateRow,
	effect: Effect,
	stats: {
		control: string;
		treatment: string;
		controlMedian: string;
		treatmentMedian: string;
	}
): string {
	const sig = row.verdict === 'significant';
	const call = row.context
		? `p=${formatPQ(row.p)} · not FDR-tested`
		: `q=${formatPQ(row.q ?? Number.NaN)} · ${sig ? 'significant' : 'not significant'} · n=${
				row.nControl
		  }/${row.nTreatment}`;
	return (
		`data-tip-title="${escapeHtml(`${metricName(row.metric)} — ${row.treatment}`)}" ` +
		`data-tip-effect="${escapeHtml(`${effect.label} (95% CI ${effect.ciLabel})`)}" ` +
		`data-tip-q="${escapeHtml(call)}" ` +
		`data-tip-control="${escapeHtml(stats.control)}" ` +
		`data-tip-control-median="${escapeHtml(stats.controlMedian)}" ` +
		`data-tip-treatment="${escapeHtml(stats.treatment)}" ` +
		`data-tip-treatment-median="${escapeHtml(stats.treatmentMedian)}"`
	);
}

function buildEffects(
	estimates: EstimateRow[],
	manifest: ManifestJson,
	styles: TreatmentStyle[],
	dataset: DatasetRow[]
): string {
	const byShortName = new Map(styles.map((t) => [t.shortName, t]));
	const controlName = manifest.spec.control.shortName;
	const workflows = manifest.spec.workflows;
	const defaultScope = defaultScopeOf(manifest);
	const metricByKey = new Map(manifest.metrics.map((m) => [m.key, m]));

	const familySections: string[] = [];
	const familyOrder = [...new Set(manifest.metrics.map((m) => m.family))];
	for (const family of familyOrder) {
		const metricRows: string[] = [];
		for (const metric of manifest.metrics.filter((m) => m.family === family)) {
			const scopes = scopesFor(metric.key, estimates, manifest);
			if (scopes.length === 0 || scopes.every((s) => s.rows.length === 0)) continue;
			const groups: string[] = [];
			const valueGroups: string[] = [];
			for (const { scope, context, rows } of scopes) {
				const marks = rows
					.map((row) => ({ row, effect: effectOf(row) }))
					.filter(({ row }) => byShortName.has(row.treatment));
				if (marks.length === 0) continue;
				const span = Math.max(
					...marks.flatMap(({ effect }) => [
						Math.abs(effect.value),
						Math.abs(effect.lo),
						Math.abs(effect.hi),
					]),
					1e-9
				);
				const x = (v: number) => 50 + (v / span) * 44;
				const controlMean = caseStat(dataset, controlName, metric, scope, workflows, 'mean');
				const controlMedian = caseStat(dataset, controlName, metric, scope, workflows, 'median');
				const controlLabel =
					controlMean === null
						? ''
						: `<span class="fctrl" data-mean="${escapeHtml(
								formatMetricValue(metric.key, controlMean)
						  )}" ` +
						  `data-median="${escapeHtml(
								formatMetricValue(metric.key, controlMedian ?? controlMean)
						  )}">` +
						  `${escapeHtml(formatMetricValue(metric.key, controlMean))}</span>`;
				// Marks are percent-positioned HTML, not SVG: an SVG stretched to the
				// column width (preserveAspectRatio="none") scales circles into ovals.
				const plotParts = ['<span class="fzero"></span>', controlLabel];
				const labelParts: string[] = [];
				marks.forEach(({ row, effect }, i) => {
					const t = byShortName.get(row.treatment)!;
					const lane = 18 + (i + 0.5) * 16;
					const sig = row.verdict === 'significant';
					const tMean = caseStat(dataset, row.treatment, metric, scope, workflows, 'mean');
					const tMedian = caseStat(dataset, row.treatment, metric, scope, workflows, 'median');
					const stats = {
						control: controlMean === null ? '' : formatMetricValue(metric.key, controlMean),
						controlMedian:
							controlMedian === null ? '' : formatMetricValue(metric.key, controlMedian),
						treatment: tMean === null ? '' : formatMetricValue(metric.key, tMean),
						treatmentMedian: tMedian === null ? '' : formatMetricValue(metric.key, tMedian),
					};
					const tip = tipAttributes(row, effect, stats);
					const lo = x(effect.lo);
					plotParts.push(
						`<span class="fmark" data-t="${t.slug}"${
							context ? '' : ` data-sig="${sig ? 1 : 0}"`
						}>` +
							`<span class="fci" style="left:${lo.toFixed(1)}%;width:${(x(effect.hi) - lo).toFixed(
								1
							)}%;` +
							`top:${lane}px;background:var(--c-${t.slug});opacity:${sig ? 1 : 0.45}"></span>` +
							`<span class="fdot tipsrc" tabindex="0" ${tip} style="left:${x(effect.value).toFixed(
								1
							)}%;top:${lane}px;` +
							`border-color:var(--c-${t.slug});${
								sig ? `background:var(--c-${t.slug})` : ''
							}"></span>` +
							'</span>'
					);
					labelParts.push(
						`<span class="flab fmark-lab tipsrc${sig ? '' : ' dim'}" tabindex="0" data-t="${
							t.slug
						}"` +
							`${context ? '' : ` data-sig="${sig ? 1 : 0}"`} ${tip} style="color:var(--c-${
								t.slug
							})">` +
							`${escapeHtml(effect.label)}</span>`
					);
				});
				const height = 18 + marks.length * 16 + 6;
				const hidden = scope === defaultScope ? '' : ' hidden';
				groups.push(
					`<div class="fgroup" data-scope="${escapeHtml(
						scope
					)}"${hidden} style="height:${height}px">${plotParts.join('')}</div>`
				);
				valueGroups.push(
					`<div class="fvgroup" data-scope="${escapeHtml(scope)}"${hidden}>${labelParts.join(
						''
					)}</div>`
				);
			}
			if (groups.length === 0) continue;
			const desc = metricDescription(metric.key);
			const descLabel = desc ? `${escapeHtml(desc)} · ` : '';
			metricRows.push(
				'<div class="frow">' +
					`<div class="fmeta"><span class="fname">${escapeHtml(metricName(metric.key))}</span>` +
					`<span class="fdesc">${descLabel}${directionText(metric.direction)}</span></div>` +
					`<div class="fplot">${groups.join('')}</div>` +
					`<div class="fvals">${valueGroups.join('')}</div>` +
					'</div>'
			);
		}
		if (metricRows.length === 0) continue;
		const meta = FAMILIES[family] ?? { name: family, intro: '' };
		familySections.push(
			`<section class="family" data-family="${escapeHtml(family)}">` +
				`<h3>${escapeHtml(meta.name)}</h3>` +
				(meta.intro ? `<p class="family-intro">${escapeHtml(meta.intro)}</p>` : '') +
				metricRows.join('\n') +
				'</section>'
		);
	}
	void metricByKey;

	const badge =
		manifest.spec.mode === 'aggregate'
			? '<span class="wfBadge" hidden>per-workflow view — not FDR-tested</span>'
			: '';
	return `
<div class="effects-head">
<div class="glyphs">
<span class="glyph"><span class="g-dot solid"></span>significant (q &le; 0.05)</span>
<span class="glyph"><span class="g-dot hollow"></span>not significant</span>
<span class="glyph"><span class="g-ci"></span>95% CI</span>
<span class="glyph"><span class="g-line"></span>center line = control value</span>
<span class="glyph">% for log-scaled metrics, absolute &Delta; otherwise</span>
<span class="glyph">hover a dot or value for exact numbers</span>
</div>
<div class="effects-tools">
<span class="stat-toggle">Control value:
<button type="button" data-stat="mean" aria-pressed="true">mean</button><button type="button" data-stat="median" aria-pressed="false">median</button>
</span>
${badge}
</div>
</div>
${familySections.join('\n')}
<p class="empty-note" id="effectsEmpty" hidden>Nothing matches the current filters.</p>`;
}

function verdictChip(row: EstimateRow, effect: Effect): string {
	if (row.context) return '<span class="chip na">not tested</span>';
	if (row.verdict !== 'significant') return '<span class="chip na">not significant</span>';
	if (row.direction === 'neutral') return '<span class="chip shift">changed</span>';
	return isBetter(effect.value, row.direction)
		? '<span class="chip good">better</span>'
		: '<span class="chip bad">worse</span>';
}

function buildFullReport(
	estimates: EstimateRow[],
	manifest: ManifestJson,
	styles: TreatmentStyle[]
): string {
	const byShortName = new Map(styles.map((t) => [t.shortName, t]));
	const orderedMetrics = manifest.metrics.map((m) => m.key);
	const defaultScope = defaultScopeOf(manifest);
	const sortRows = (a: EstimateRow, b: EstimateRow) => {
		const byMetric = orderedMetrics.indexOf(a.metric) - orderedMetrics.indexOf(b.metric);
		if (byMetric !== 0) return byMetric;
		return a.treatment.localeCompare(b.treatment);
	};
	const headline = [...headlineRows(estimates)].sort(sortRows);
	const contexts =
		manifest.spec.mode === 'aggregate'
			? [...estimates.filter((row) => row.context)].sort(sortRows)
			: [];
	let anomalyTotal = 0;
	const trs = [...headline, ...contexts]
		.map((row) => {
			const t = byShortName.get(row.treatment);
			if (!t) return '';
			const effect = effectOf(row);
			const sig = row.verdict === 'significant';
			const scope = row.context ? row.scope : defaultScope;
			const hidden = scope === defaultScope ? '' : ' hidden';
			const sigAttr = row.context ? '' : ` data-sig="${sig ? 1 : 0}"`;
			const anomalies = row.anomalies ?? 0;
			if (!row.context) anomalyTotal += anomalies;
			const marker =
				anomalies > 0 ? `<sup title="${anomalies} anomalous value(s) excluded">&dagger;</sup>` : '';
			return (
				`<tr class="t-${t.slug}" data-t="${t.slug}" data-scope="${escapeHtml(
					scope
				)}"${sigAttr}${hidden}>` +
				`<td>${escapeHtml(metricName(row.metric))}${marker}</td>` +
				`<td><span class="dot" style="background:var(--c-${t.slug})"></span>${escapeHtml(
					row.treatment
				)}</td>` +
				`<td class="num">${row.nControl} / ${row.nTreatment}</td>` +
				`<td class="num">${escapeHtml(effect.label)}</td>` +
				`<td class="num">${escapeHtml(effect.ciLabel)}</td>` +
				`<td class="num">${escapeHtml(formatBeta(row.beta))}</td>` +
				`<td class="num">${escapeHtml(formatPQ(row.p))}</td>` +
				`<td class="num">${row.q === null ? '—' : escapeHtml(formatPQ(row.q))}</td>` +
				`<td>${verdictChip(row, effect)}</td></tr>`
			);
		})
		.join('\n');

	const tested = new Set(headline.map((row) => `${row.metric} ${row.treatment}`));
	const untested: string[] = [];
	for (const metric of manifest.metrics) {
		for (const t of manifest.spec.treatments) {
			if (!tested.has(`${metric.key} ${t.shortName}`)) {
				untested.push(
					`<li><span class="mono">${escapeHtml(metric.key)}</span> × ${escapeHtml(
						t.shortName
					)}</li>`
				);
			}
		}
	}
	const untestedSection =
		untested.length > 0
			? `
<h3>Not tested</h3>
<p class="note">No estimate exists for these pairs (too few values, or a degenerate fit).</p>
<ul class="untested">${untested.join('\n')}</ul>`
			: '';

	const excluded = manifest.excludedRuns ?? [];
	const excludedSection =
		excluded.length > 0
			? `
<h3>Excluded runs</h3>
<ul class="untested">${excluded
					.map(
						(run) =>
							`<li><span class="mono">${escapeHtml(run.path ?? '')}</span> — ${escapeHtml(
								run.reason ?? ''
							)}</li>`
					)
					.join('\n')}</ul>`
			: '';

	const anomalyNote =
		anomalyTotal > 0
			? `
<p class="note">&dagger; ${anomalyTotal} value(s) &le; 0 were excluded from log-scaled metrics; see report.md for the run list.</p>`
			: '';

	const badge =
		manifest.spec.mode === 'aggregate'
			? '<span class="wfBadge" hidden>per-workflow view — not FDR-tested</span>'
			: '';
	return `
${badge}
<div class="tablewrap tall"><table id="verdictTable">
<thead><tr><th>Metric</th><th>Arm</th><th>n</th><th class="num">Effect</th><th class="num">95% CI</th><th class="num nocase">β</th><th class="num nocase">p</th><th class="num nocase">q</th><th>Verdict</th></tr></thead>
<tbody>
${trs}
</tbody>
</table></div>
<p class="empty-note" id="fullEmpty" hidden>Nothing matches the current filters.</p>
<p class="note">"Better"/"worse" follows each metric's own direction; descriptive metrics get
"changed", not a value judgment. n is control / treatment. β is on the model scale (log for
log-scaled metrics); Effect and CI are on the display scale. q is the false-discovery-corrected
p-value; the bar is q&nbsp;&le;&nbsp;0.05.</p>${anomalyNote}${untestedSection}${excludedSection}`;
}

// Strip the XML prolog, DOCTYPE, and matplotlib <metadata> block matplotlib
// emits — everything before the opening <svg> tag except that tag itself,
// plus the rdf metadata block matplotlib nests just inside it.
function stripSvgWrapper(svg: string): string {
	const svgStart = svg.indexOf('<svg');
	const body = svgStart >= 0 ? svg.slice(svgStart) : svg;
	return body.replace(/<metadata>[\s\S]*?<\/metadata>/, '');
}

function buildCurves(curves: CurveInput[], manifest: ManifestJson): string {
	const orderedMetrics = manifest.metrics.map((m) => m.key);
	const sorted = [...curves].sort((a, b) => {
		const byMetric = orderedMetrics.indexOf(a.metric) - orderedMetrics.indexOf(b.metric);
		if (byMetric !== 0) return byMetric;
		return a.workflow.localeCompare(b.workflow);
	});
	const multiScope = manifest.spec.workflows.length > 1;
	const details = sorted
		.map((curve) => {
			const title = multiScope
				? `${metricName(curve.metric)} · ${curve.workflow}`
				: metricName(curve.metric);
			return (
				`<details class="curve" data-workflow="${escapeHtml(curve.workflow)}"><summary>` +
				escapeHtml(title) +
				'</summary><div class="curve-card">' +
				stripSvgWrapper(curve.svg) +
				'</div></details>'
			);
		})
		.join('\n');
	const empty = sorted.length === 0 ? '<p class="note">No curves were generated.</p>' : '';
	return `
<p class="note">Empirical CDF of every run per arm. Case toggles cannot reach inside these
static images. Curves render on a white card in both themes: the source SVGs assume a white
ground.</p>
${details}${empty}`;
}

function buildTabs(panels: { id: string; label: string; body: string }[]): string {
	const tabs = panels
		.map(
			(panel, i) =>
				`<button class="tab" role="tab" id="tab-${panel.id}" aria-controls="panel-${panel.id}" ` +
				`aria-selected="${i === 0 ? 'true' : 'false'}"${i === 0 ? '' : ' tabindex="-1"'}>${
					panel.label
				}</button>`
		)
		.join('\n');
	const sections = panels
		.map(
			(panel, i) =>
				`<section class="panel" id="panel-${panel.id}" role="tabpanel" aria-labelledby="tab-${
					panel.id
				}"${i === 0 ? '' : ' hidden'}>
${panel.body}
</section>`
		)
		.join('\n');
	return `
<div class="tabs" role="tablist" aria-label="Report sections">
${tabs}
</div>
${sections}`;
}

function buildStyle(styles: TreatmentStyle[]): string {
	const lightVars = styles.map((t) => `--c-${t.slug}:${t.lightColor};`).join(' ');
	const darkVars = styles.map((t) => `--c-${t.slug}:${t.darkColor};`).join(' ');
	return `
:root {
  --surface:#FAF9F7; --ink:#1B1E22; --ink-2:#4A5058; --ink-3:#8A9098;
  --line:#E4E1DB; --card:#FFFFFF; --wash:#F1EFEA;
  --good:#0B7A45; --bad:#B4232A;
  ${lightVars}
}
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {
  --surface:#16181C; --ink:#E8E6E1; --ink-2:#AFB4BB; --ink-3:#767C85;
  --line:#2C2F35; --card:#1D2025; --wash:#22252B;
  --good:#3AA46F; --bad:#D96B70;
  ${darkVars}
} }
:root[data-theme="dark"] {
  --surface:#16181C; --ink:#E8E6E1; --ink-2:#AFB4BB; --ink-3:#767C85;
  --line:#2C2F35; --card:#1D2025; --wash:#22252B;
  --good:#3AA46F; --bad:#D96B70;
  ${darkVars}
}
* { box-sizing:border-box; }
[hidden] { display:none !important; }
body { background:var(--surface); color:var(--ink); margin:0;
  font:16px/1.6 "IBM Plex Sans",system-ui,sans-serif; }
main { max-width:920px; margin:0 auto; padding:48px 24px 96px; }
h1,h2,h3 { font-family:Spectral,Georgia,serif; text-wrap:balance; line-height:1.2; }
h1 { font-size:2.1rem; font-weight:700; margin:8px 0 4px; }
h2 { font-size:1.3rem; font-weight:600; margin:36px 0 12px; }
h3 { font-size:1.05rem; font-weight:600; margin:32px 0 6px; }
.eyebrow { font-size:.72rem; letter-spacing:.14em; text-transform:uppercase; color:var(--ink-3); font-weight:600; }
.lede { color:var(--ink-2); max-width:62ch; }
.mono, .num { font-family:"IBM Plex Mono",monospace; font-variant-numeric:tabular-nums; font-size:.86em; }
.filterbar { display:flex; flex-wrap:wrap; gap:10px 16px; align-items:center; margin:22px 0 0;
  padding:12px 14px; background:var(--wash); border:1px solid var(--line); border-radius:12px; }
.legend { display:flex; gap:8px; flex-wrap:wrap; font-size:.85rem; margin-right:auto; }
.chip-toggle { display:inline-flex; align-items:center; gap:7px; font:inherit; font-weight:600;
  color:var(--ink-2); background:var(--card); border:1px solid var(--line); border-radius:99px;
  padding:4px 12px; cursor:pointer; }
.chip-toggle[aria-pressed="false"] { opacity:.4; }
.chip-toggle .dot { background:var(--tc); margin:0; }
.select { display:inline-flex; align-items:center; gap:7px; font-size:.72rem; font-weight:600;
  letter-spacing:.07em; text-transform:uppercase; color:var(--ink-3); }
.select select { font:600 .85rem/1.4 "IBM Plex Sans",system-ui,sans-serif; color:var(--ink);
  background:var(--card); border:1px solid var(--line); border-radius:8px; padding:5px 8px; }
.select select:disabled { opacity:.45; }
#resetFilters { font:600 .8rem/1.4 "IBM Plex Sans",system-ui,sans-serif; color:var(--ink-2);
  background:none; border:1px solid var(--line); border-radius:8px; padding:5px 10px; cursor:pointer; }
#resetFilters:hover { background:var(--card); }
.tabs { display:flex; gap:2px; border-bottom:1px solid var(--line); margin:26px 0 0; overflow-x:auto; }
.tab { font:600 .92rem/1.4 "IBM Plex Sans",system-ui,sans-serif; color:var(--ink-2); background:none;
  border:none; border-bottom:2px solid transparent; padding:9px 14px; cursor:pointer; white-space:nowrap; }
.tab[aria-selected="true"] { color:var(--ink); border-bottom-color:var(--ink); }
.panel { padding-top:8px; }
.dot { display:inline-block; width:9px; height:9px; border-radius:50%; margin-right:7px; vertical-align:baseline; }
.summary { list-style:none; padding:0; margin:12px 0; font-size:.92rem; color:var(--ink-2); }
.summary li { margin:6px 0; }
.summary b { color:var(--ink); }
.statsbox { background:var(--wash); border:1px solid var(--line); border-radius:12px;
  padding:14px 18px; margin:24px 0; font-size:.84rem; color:var(--ink-2); }
.statsbox h3 { margin:0 0 4px; }
.statsbox ul { margin:0; padding-left:18px; }
.statsbox li { margin:5px 0; }
.statsbox b { color:var(--ink); }
.effects-head { margin:14px 0 6px; }
.glyphs { display:flex; flex-wrap:wrap; gap:6px 16px; font-size:.76rem; color:var(--ink-3); }
.glyph { display:inline-flex; align-items:center; gap:6px; }
.g-dot { width:9px; height:9px; border-radius:50%; border:1.5px solid var(--ink-2); }
.g-dot.solid { background:var(--ink-2); }
.g-dot.hollow { background:var(--card); }
.g-ci { width:16px; height:3px; border-radius:2px; background:var(--ink-2); }
.g-line { width:1px; height:12px; background:var(--line); outline:1px solid var(--line); }
.effects-tools { display:flex; align-items:center; gap:14px; margin-top:10px; font-size:.8rem; color:var(--ink-2); }
.stat-toggle button { font:600 .78rem/1.3 "IBM Plex Sans",system-ui,sans-serif; color:var(--ink-2);
  background:var(--card); border:1px solid var(--line); padding:3px 10px; cursor:pointer; }
.stat-toggle button:first-of-type { border-radius:7px 0 0 7px; }
.stat-toggle button:last-of-type { border-radius:0 7px 7px 0; margin-left:-1px; }
.stat-toggle button[aria-pressed="true"] { color:var(--ink); background:var(--wash); border-color:var(--ink-3); }
.wfBadge { font-size:.74rem; font-weight:600; color:var(--ink-2); background:var(--wash);
  border:1px solid var(--line); border-radius:99px; padding:3px 11px; }
.family h3 { margin:34px 0 2px; }
.family-intro { font-size:.82rem; color:var(--ink-3); margin:0 0 8px; max-width:70ch; }
.frow { display:grid; grid-template-columns:220px 1fr 130px; gap:14px; align-items:center;
  padding:9px 0; border-bottom:1px solid var(--line); }
.fname { display:block; font-weight:600; font-size:.9rem; }
.fdesc { display:block; font-size:.74rem; color:var(--ink-3); }
.fgroup { position:relative; }
.fzero { position:absolute; left:50%; top:14px; bottom:0; width:1px; background:var(--line); }
.fctrl { position:absolute; left:50%; top:-2px; transform:translateX(-50%);
  font:500 .68rem/1.3 "IBM Plex Mono",monospace; color:var(--ink-3);
  background:var(--surface); padding:0 5px; white-space:nowrap; }
.fci { position:absolute; height:3px; border-radius:2px; transform:translateY(-50%); }
.fdot { position:absolute; width:9px; height:9px; box-sizing:border-box; border-radius:50%;
  border:1.5px solid; background:var(--card); transform:translate(-50%,-50%); cursor:default; }
.fvals { display:flex; flex-direction:column; }
.fvgroup { display:flex; flex-direction:column; gap:2px; align-items:flex-end; }
.flab { font-family:"IBM Plex Mono",monospace; font-size:.8rem; cursor:default; }
.flab.dim { opacity:.55; }
#tip { position:fixed; z-index:50; max-width:320px; background:var(--ink); color:var(--surface);
  padding:9px 12px; border-radius:8px; font-size:.78rem; line-height:1.5; pointer-events:none; }
#tip .tip-title { font-weight:600; }
table { border-collapse:collapse; width:100%; font-size:.88rem; }
thead th { text-align:left; font-size:.72rem; letter-spacing:.08em; text-transform:uppercase;
  color:var(--ink-3); font-weight:600; padding:8px 10px; border-bottom:1px solid var(--line);
  position:sticky; top:0; background:var(--surface); z-index:2; }
thead th.num { text-align:right; }
thead th.nocase { text-transform:none; font-size:.82rem; }
td { padding:7px 10px; border-bottom:1px solid var(--line); }
td.num { text-align:right; white-space:nowrap; }
tr[data-sig="0"] td { opacity:.55; }
.control-row td { background:color-mix(in srgb, var(--good) 7%, transparent); }
.chip { font-size:.72rem; font-weight:600; padding:2px 9px; border-radius:99px; white-space:nowrap; }
.chip.good { background:color-mix(in srgb, var(--good) 14%, transparent); color:var(--good); }
.chip.bad { background:color-mix(in srgb, var(--bad) 14%, transparent); color:var(--bad); }
.chip.na { background:var(--wash); color:var(--ink-3); }
.chip.shift { background:color-mix(in srgb, var(--ink-2) 12%, transparent); color:var(--ink-2); }
.chip.control { background:color-mix(in srgb, var(--good) 14%, transparent); color:var(--good);
  margin-left:6px; }
.tablewrap { overflow-x:auto; }
.tablewrap.tall { max-height:74vh; overflow:auto; margin-top:14px; }
.untested { font-size:.85rem; color:var(--ink-2); margin:6px 0; padding-left:18px; }
.untested li { margin:3px 0; }
.empty-note { font-size:.85rem; color:var(--ink-3); font-style:italic; margin:18px 0; }
.note { font-size:.8rem; color:var(--ink-3); margin-top:10px; max-width:70ch; }
.curve summary { cursor:pointer; font-weight:600; padding:10px 0; border-bottom:1px solid var(--line); }
.curve-card { background:#FFFFFF; border-radius:10px; padding:16px; margin:12px 0 20px; }
.curve-card svg { width:100%; height:auto; max-width:100%; display:block; }
@media (max-width:640px) {
  .frow { grid-template-columns:1fr; gap:4px; }
  .fvgroup { flex-direction:row; gap:14px; align-items:baseline; }
  .filterbar { gap:8px; }
}`;
}

function buildScript(): string {
	return `
var $ = function (sel, root) { return [].slice.call((root || document).querySelectorAll(sel)); };
var byId = function (id) { return document.getElementById(id); };

var tabs = $('.tab');
function selectTab(index) {
  tabs.forEach(function (tab, i) {
    var on = i === index;
    tab.setAttribute('aria-selected', String(on));
    tab.tabIndex = on ? 0 : -1;
    byId(tab.getAttribute('aria-controls')).hidden = !on;
  });
  tabs[index].focus();
}
tabs.forEach(function (tab, i) {
  tab.addEventListener('click', function () { selectTab(i); });
  tab.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowRight') selectTab((i + 1) % tabs.length);
    if (e.key === 'ArrowLeft') selectTab((i - 1 + tabs.length) % tabs.length);
  });
});

var sigFilter = byId('sigFilter');
var wfFilter = byId('wfFilter');
var chips = $('.chip-toggle');
var mode = document.body.getAttribute('data-mode');
var defaultScope = document.body.getAttribute('data-default-scope');

function currentScope() {
  return wfFilter && wfFilter.value !== 'pooled' ? wfFilter.value : defaultScope;
}
function isContextView() { return mode === 'aggregate' && currentScope() !== defaultScope; }
function offTreatments() {
  var off = {};
  chips.forEach(function (chip) {
    if (chip.getAttribute('aria-pressed') === 'false') off[chip.getAttribute('data-t')] = true;
  });
  return off;
}
function sigMatch(el, sigMode, contextView) {
  if (contextView || sigMode === 'all') return true;
  var s = el.getAttribute('data-sig');
  return sigMode === 'sig' ? s === '1' : s === '0';
}
function anyVisible(els) {
  return els.some(function (el) { return !el.hidden; });
}
function refresh() {
  var scope = currentScope();
  var contextView = isContextView();
  var sigMode = sigFilter ? sigFilter.value : 'all';
  var off = offTreatments();
  if (sigFilter) sigFilter.disabled = contextView;
  $('.wfBadge').forEach(function (el) { el.hidden = !contextView; });
  $('.fgroup, .fvgroup').forEach(function (group) {
    group.hidden = group.getAttribute('data-scope') !== scope;
  });
  $('.fmark, .fmark-lab').forEach(function (el) {
    el.hidden = off[el.getAttribute('data-t')] === true || !sigMatch(el, sigMode, contextView);
  });
  $('.frow').forEach(function (row) {
    var group = $('.fgroup', row).filter(function (g) { return !g.hidden; })[0];
    row.hidden = !group || !anyVisible($('.fmark', group));
  });
  $('.family').forEach(function (section) {
    section.hidden = !anyVisible($('.frow', section));
  });
  var effectsEmpty = byId('effectsEmpty');
  if (effectsEmpty) effectsEmpty.hidden = anyVisible($('.family'));
  $('#verdictTable tbody tr').forEach(function (tr) {
    tr.hidden =
      tr.getAttribute('data-scope') !== scope ||
      off[tr.getAttribute('data-t')] === true ||
      !sigMatch(tr, sigMode, contextView);
  });
  var fullEmpty = byId('fullEmpty');
  if (fullEmpty) fullEmpty.hidden = anyVisible($('#verdictTable tbody tr'));
  $('#sampleTable tbody tr').forEach(function (tr) {
    var wfOk = !contextView || tr.getAttribute('data-workflow') === scope;
    var t = tr.getAttribute('data-t');
    tr.hidden = !wfOk || (t !== null && off[t] === true);
  });
  $('.summary li[data-t]').forEach(function (li) {
    li.hidden = off[li.getAttribute('data-t')] === true;
  });
  $('.curve').forEach(function (curve) {
    curve.hidden = contextView && curve.getAttribute('data-workflow') !== scope;
  });
}
chips.forEach(function (chip) {
  chip.addEventListener('click', function () {
    var on = chip.getAttribute('aria-pressed') === 'true';
    chip.setAttribute('aria-pressed', String(!on));
    refresh();
  });
});
if (sigFilter) sigFilter.addEventListener('change', refresh);
if (wfFilter) wfFilter.addEventListener('change', refresh);

var statButtons = $('.stat-toggle button');
var statKind = 'mean';
function setStat(kind) {
  statKind = kind;
  statButtons.forEach(function (b) {
    b.setAttribute('aria-pressed', String(b.getAttribute('data-stat') === kind));
  });
  $('.fctrl').forEach(function (el) {
    el.textContent = el.getAttribute('data-' + kind) || '';
  });
}
statButtons.forEach(function (b) {
  b.addEventListener('click', function () { setStat(b.getAttribute('data-stat')); });
});

var reset = byId('resetFilters');
if (reset) reset.addEventListener('click', function () {
  chips.forEach(function (chip) { chip.setAttribute('aria-pressed', 'true'); });
  if (sigFilter) sigFilter.value = 'all';
  if (wfFilter) wfFilter.value = 'pooled';
  setStat('mean');
  refresh();
});

var tip = byId('tip');
var tipParts = $('#tip div');
function showTip(el) {
  var median = statKind === 'median';
  var control = el.getAttribute('data-tip-control' + (median ? '-median' : '')) || '';
  var treatment = el.getAttribute('data-tip-treatment' + (median ? '-median' : '')) || '';
  tipParts[0].textContent = el.getAttribute('data-tip-title') || '';
  tipParts[1].textContent = el.getAttribute('data-tip-effect') || '';
  tipParts[2].textContent = el.getAttribute('data-tip-q') || '';
  tipParts[3].textContent =
    control && treatment ? statKind + ': control ' + control + ' \\u2192 ' + treatment : '';
  tip.hidden = false;
  var r = el.getBoundingClientRect();
  var box = tip.getBoundingClientRect();
  var left = Math.min(
    Math.max(8, r.left + r.width / 2 - box.width / 2),
    window.innerWidth - box.width - 8
  );
  var top = r.top - box.height - 8;
  if (top < 8) top = r.bottom + 8;
  tip.style.left = left + 'px';
  tip.style.top = top + 'px';
}
document.addEventListener('mouseover', function (e) {
  var el = e.target && e.target.closest ? e.target.closest('.tipsrc') : null;
  if (el) showTip(el);
  else tip.hidden = true;
});
document.addEventListener('focusin', function (e) {
  var el = e.target && e.target.closest ? e.target.closest('.tipsrc') : null;
  if (el) showTip(el);
  else tip.hidden = true;
});
document.addEventListener('scroll', function () { tip.hidden = true; }, true);

setStat('mean');
refresh();`;
}

export function renderHtmlReport(input: HtmlReportInput): string {
	const { estimates, manifest, curves, dataset } = input;
	const styles = treatmentStyles(manifest.spec.treatments);
	const title = `${manifest.spec.control.shortName} vs ${manifest.spec.treatments
		.map((t) => t.shortName)
		.join(' + ')}`;
	const panels = [
		{
			id: 'summary',
			label: 'Summary',
			body:
				buildSummary(estimates, styles) +
				buildStatsBox(estimates, manifest) +
				buildSample(manifest, styles),
		},
		{
			id: 'effects',
			label: 'Effects at a glance',
			body: buildEffects(estimates, manifest, styles, dataset),
		},
		{
			id: 'full',
			label: 'Full report',
			body: buildFullReport(estimates, manifest, styles),
		},
		{
			id: 'curves',
			label: 'Curves',
			body: buildCurves(curves, manifest),
		},
	];
	return `<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Spectral:wght@500;600;700&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap">
<style>${buildStyle(styles)}</style>
<body data-mode="${escapeHtml(manifest.spec.mode)}" data-default-scope="${escapeHtml(
		defaultScopeOf(manifest)
	)}">
<main>
${buildHeader(manifest)}
${buildFilterBar(manifest, styles)}
${buildTabs(panels)}
</main>
<div id="tip" role="tooltip" hidden><div class="tip-title"></div><div></div><div></div><div></div></div>
<script>${buildScript()}</script>
</body>
`;
}

function parseDatasetCsv(csv: string): DatasetRow[] {
	const lines = csv.trim().split('\n');
	if (lines.length === 0) return [];
	const header = lines[0]!.split(',');
	const metricKeys = header.slice(4);
	return lines.slice(1).map((line) => {
		const cells = line.split(',');
		const values: Record<string, number | null> = {};
		metricKeys.forEach((key, i) => {
			const raw = cells[i + 4];
			values[key] = raw === undefined || raw === '' ? null : Number(raw);
		});
		return { case: cells[0]!, workflow: cells[1]!, values };
	});
}

export function writeHtmlReport(stagingDir: string): void {
	const estimates: EstimateRow[] = JSON.parse(
		readFileSync(join(stagingDir, 'estimates.json'), 'utf8')
	);
	const manifest: ManifestJson = JSON.parse(
		readFileSync(join(stagingDir, 'manifest.json'), 'utf8')
	);
	const dataset = parseDatasetCsv(readFileSync(join(stagingDir, 'dataset.csv'), 'utf8'));
	const curvesDir = join(stagingDir, 'curves');
	const curves: CurveInput[] = readdirSync(curvesDir)
		.filter((file) => file.endsWith('.svg'))
		.map((file) => {
			const [metric, workflow] = file.replace(/\.svg$/, '').split('@');
			return {
				metric: metric ?? file,
				workflow: workflow ?? '',
				svg: readFileSync(join(curvesDir, file), 'utf8'),
			};
		});
	writeFileSync(
		join(stagingDir, 'report.html'),
		renderHtmlReport({ estimates, manifest, curves, dataset })
	);
}
