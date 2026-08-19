// Self-contained HTML rendering of a results:compare comparison. Reads the
// same estimates.json/manifest.json/curves that report.md and dataset.csv
// summarize, and renders them as one static page: no server, no build step,
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
	cells: ManifestCell[];
	excludedRuns: unknown[];
	provenance: {
		generatedAt?: string;
		gitSha?: string | null;
		metricsVersion?: number | string | null;
		[key: string]: unknown;
	};
}

export interface CurveInput {
	metric: string;
	workflow: string;
	svg: string;
}

export interface HtmlReportInput {
	estimates: EstimateRow[];
	manifest: ManifestJson;
	curves: CurveInput[];
}

// Plain-English name and one-line description per metric. Metrics outside
// this map render under their raw registry key with no description.
const METRICS: Record<string, { name: string; description: string }> = {
	estimatedCostUsd: { name: 'Cost per run', description: 'How many dollars one run spends' },
	durationSeconds: { name: 'Time to finish', description: 'Wall-clock seconds per run' },
	outputTokens: { name: 'Output tokens', description: 'Text and code the model writes' },
	cacheHitRate: { name: 'Cache hit rate', description: 'Share of context read from cache' },
	inputTokens: { name: 'Uncached input tokens', description: 'Context paid at the raw rate' },
	turns: { name: 'Conversation turns', description: 'Agent loop iterations' },
	totalToolCalls: { name: 'Tool calls', description: 'Every tool invocation' },
	docsCalls: { name: 'Documentation lookups', description: 'Calls that read DS docs (MCP)' },
	explorationCalls: { name: 'Exploration calls', description: 'Reading and searching the codebase' },
	editCalls: { name: 'Edit calls', description: 'File-writing tool calls' },
	verificationCalls: { name: 'Verification calls', description: 'Tests, typechecks, build checks' },
	filesEdited: { name: 'Files touched', description: 'Distinct files the agent edited' },
	diffFilesChanged: { name: 'Files changed in diff', description: 'Files in the final change' },
	slocAdded: { name: 'Lines added', description: 'Source lines the change adds' },
	slocNet: { name: 'Net lines', description: 'Adds minus removals' },
	dsShareOfAllNodes: {
		name: 'DS share of UI',
		description: 'Design-system share of rendered nodes',
	},
	dsShareOfComponentNodes: {
		name: 'DS share of components',
		description: 'DS share of component nodes only',
	},
	cyclomaticDelta: { name: 'Cyclomatic complexity added', description: 'Branching complexity the change adds' },
	cognitiveDelta: { name: 'Cognitive complexity added', description: 'Readability cost the change adds' },
	jsxCognitiveDelta: { name: 'JSX complexity added', description: 'Markup complexity the change adds' },
};

// Metrics reported as a 0-1 share; their absolute-delta effects display in
// percentage points (beta * 100), never as a percent change.
const SHARE_METRICS = new Set(['dsShareOfAllNodes', 'dsShareOfComponentNodes']);

const LIGHT_TREATMENT_COLORS = ['#C05621', '#0D8A78', '#6D5BD0'];
const DARK_TREATMENT_COLORS = ['#D4732A', '#12A38E', '#8B79E8'];
const NEUTRAL_GRAY_LIGHT = '#6B7280';
const NEUTRAL_GRAY_DARK = '#9CA3AF';

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

function fmtAbs(value: number): string {
	const a = Math.abs(value);
	let s: string;
	if (a >= 1000) s = a.toLocaleString('en-US', { maximumFractionDigits: 0 });
	else if (a >= 10) s = a.toFixed(1);
	else if (a >= 1) s = a.toFixed(2);
	else if (a >= 0.001) s = a.toFixed(3);
	else s = a.toExponential(1);
	return (value < 0 ? '−' : '+') + s;
}

function fmtPct(value: number): string {
	return (value < 0 ? '−' : '+') + `${Math.abs(value * 100).toFixed(1)}%`;
}

function fmtQ(q: number): string {
	return q < 0.001 ? q.toExponential(1) : q.toFixed(3);
}

interface Effect {
	value: number;
	lo: number;
	hi: number;
	label: string;
	isPercent: boolean;
}

// The effect a row represents, on its own display scale: a percentage for
// log/log0 transforms (beta is a log-ratio), an absolute delta otherwise —
// scaled to percentage points for the two DS-share metrics.
function effectOf(row: EstimateRow): Effect {
	if (row.transform === 'log' || row.transform === 'log0') {
		const value = row.pctChange ?? Math.exp(row.beta) - 1;
		const lo = Math.exp(row.ciLow) - 1;
		const hi = Math.exp(row.ciHigh) - 1;
		return { value, lo, hi, label: fmtPct(value), isPercent: true };
	}
	const scale = SHARE_METRICS.has(row.metric) ? 100 : 1;
	const suffix = SHARE_METRICS.has(row.metric) ? ' pp' : '';
	const value = row.beta * scale;
	const lo = row.ciLow * scale;
	const hi = row.ciHigh * scale;
	return { value, lo, hi, label: fmtAbs(value) + suffix, isPercent: false };
}

function directionText(direction: EstimateDirection): string {
	if (direction === 'lower-better') return 'lower is better';
	if (direction === 'higher-better') return 'higher is better';
	return 'descriptive';
}

// (a) is a directional metric win, per its own better/worse convention.
// Never called for direction === 'neutral' — those metrics are "changed", not won.
function isBetter(value: number, direction: EstimateDirection): boolean {
	return (value < 0) === (direction === 'lower-better');
}

interface TreatmentStyle {
	shortName: string;
	slug: string;
	lightColor: string;
	darkColor: string;
	neutral: boolean;
}

function treatmentStyles(treatments: ManifestCase[]): TreatmentStyle[] {
	return treatments.map((t, i) => ({
		shortName: t.shortName,
		slug: slug(t.shortName),
		lightColor: i < 3 ? LIGHT_TREATMENT_COLORS[i]! : NEUTRAL_GRAY_LIGHT,
		darkColor: i < 3 ? DARK_TREATMENT_COLORS[i]! : NEUTRAL_GRAY_DARK,
		neutral: i >= 3,
	}));
}

function metricName(key: string): string {
	return METRICS[key]?.name ?? key;
}

function metricDescription(key: string): string {
	return METRICS[key]?.description ?? '';
}

function buildLegend(styles: TreatmentStyle[]): string {
	const chips = styles
		.map(
			(t) =>
				`<button type="button" class="chip-toggle" data-t="${t.slug}" aria-pressed="true" ` +
				`style="--tc:var(--c-${t.slug})"><span class="dot"></span>${escapeHtml(t.shortName)}</button>`,
		)
		.join('\n');
	return `<div class="legend">${chips}</div>`;
}

function buildHeader(manifest: ManifestJson): string {
	const { control, treatments, workflows } = manifest.spec;
	const title = `${control.shortName} vs ${treatments.map((t) => t.shortName).join(' + ')} @ ${workflows.join(', ')}`;
	const provenance = manifest.provenance;
	const sha = typeof provenance.gitSha === 'string' ? provenance.gitSha.slice(0, 7) : 'unknown';
	const generatedAt = typeof provenance.generatedAt === 'string' ? provenance.generatedAt : 'unknown';
	const metricsVersion = provenance.metricsVersion ?? 'unknown';
	return `
<span class="eyebrow">results:compare</span>
<h1>${escapeHtml(title)}</h1>
<p class="lede mono">generated ${escapeHtml(generatedAt)} &middot; ${escapeHtml(sha)} &middot; metrics v${escapeHtml(String(metricsVersion))}</p>`;
}

function buildSample(manifest: ManifestJson): string {
	const rows = manifest.cells
		.map(
			(c) =>
				`<tr><td>${escapeHtml(c.case)}</td><td>${escapeHtml(c.workflow)}</td>` +
				`<td class="num">${c.usableRuns}</td><td class="num">${c.passed}</td>` +
				`<td class="num">${c.failed}</td><td class="num">${c.superseded}</td></tr>`,
		)
		.join('\n');
	return `
<h2>Sample</h2>
<div class="tablewrap"><table>
<tr><th>Case</th><th>Workflow</th><th>Usable runs</th><th>Passed</th><th>Failed</th><th>Superseded</th></tr>
${rows}
</table></div>`;
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
			let noCall = 0;
			for (const row of forTreatment) {
				if (row.verdict !== 'significant') {
					noCall++;
				} else if (row.direction === 'neutral') {
					changed++;
				} else if (isBetter(effectOf(row).value, row.direction)) {
					better++;
				} else {
					worse++;
				}
			}
			return (
				`<li><span class="dot" style="background:var(--c-${t.slug})"></span>` +
				`<b>${escapeHtml(t.shortName)}</b>: ${better} better, ${worse} worse, ${changed} changed, ` +
				`${noCall} no call (of ${forTreatment.length} metrics)</li>`
			);
		})
		.join('\n');
	return `
<h2>Summary</h2>
<ul class="summary">${items}</ul>`;
}

interface ForestGroup {
	metric: string;
	scope: string;
	rows: EstimateRow[];
}

function groupForForest(estimates: EstimateRow[]): ForestGroup[] {
	const rows = headlineRows(estimates);
	const groups = new Map<string, ForestGroup>();
	for (const row of rows) {
		const key = `${row.metric} ${row.scope}`;
		let group = groups.get(key);
		if (!group) {
			group = { metric: row.metric, scope: row.scope, rows: [] };
			groups.set(key, group);
		}
		group.rows.push(row);
	}
	return [...groups.values()];
}

function buildForest(estimates: EstimateRow[], manifest: ManifestJson, styles: TreatmentStyle[]): string {
	const byShortName = new Map(styles.map((t) => [t.shortName, t]));
	const multiScope = manifest.spec.workflows.length > 1;
	const rowsHtml = groupForForest(estimates)
		.map((group) => {
			const marks = group.rows
				.map((row) => ({ row, effect: effectOf(row) }))
				.filter(({ row }) => byShortName.has(row.treatment));
			if (marks.length === 0) return '';
			const span = Math.max(
				...marks.flatMap(({ effect }) => [Math.abs(effect.value), Math.abs(effect.lo), Math.abs(effect.hi)]),
				1e-9,
			);
			const x = (v: number) => 50 + (v / span) * 44;
			// Marks are percent-positioned HTML, not SVG: an SVG stretched to the
			// column width (preserveAspectRatio="none") scales circles into ovals.
			const plotParts = ['<span class="fzero"></span>'];
			const labelParts: string[] = [];
			marks.forEach(({ row, effect }, i) => {
				const t = byShortName.get(row.treatment)!;
				const lane = (((i + 0.5) / marks.length) * 100).toFixed(1);
				const sig = row.verdict === 'significant';
				const tip =
					`${metricName(row.metric)} — ${row.treatment}: ${effect.label} (95% CI ` +
					`${effect.isPercent ? fmtPct(effect.lo) : fmtAbs(effect.lo)} to ` +
					`${effect.isPercent ? fmtPct(effect.hi) : fmtAbs(effect.hi)}), ` +
					`q=${fmtQ(row.q!)}, ${sig ? 'significant' : 'not significant'}`;
				const lo = x(effect.lo);
				plotParts.push(
					`<span class="t-${t.slug}">` +
						`<span class="fci" style="left:${lo.toFixed(1)}%;width:${(x(effect.hi) - lo).toFixed(1)}%;` +
						`top:${lane}%;background:var(--c-${t.slug});opacity:${sig ? 1 : 0.45}"></span>` +
						`<span class="fdot" style="left:${x(effect.value).toFixed(1)}%;top:${lane}%;` +
						`border-color:var(--c-${t.slug});${sig ? `background:var(--c-${t.slug})` : ''}"></span>` +
						'</span>',
				);
				labelParts.push(
					`<span class="flab t-${t.slug}" data-tip="${escapeHtml(tip)}" style="color:var(--c-${t.slug})">` +
						`${escapeHtml(effect.label)}${sig ? '' : '°'}</span>`,
				);
			});
			const svg = `<div class="fplotarea" style="height:${marks.length * 16 + 4}px" aria-hidden="true">${plotParts.join('')}</div>`;
			const scopeLabel = multiScope ? ` · ${escapeHtml(group.scope)}` : '';
			const desc = metricDescription(group.metric);
			const descLabel = desc ? `${escapeHtml(desc)} · ` : '';
			return (
				'<div class="frow">' +
				`<div class="fmeta"><span class="fname">${escapeHtml(metricName(group.metric))}${scopeLabel}</span>` +
				`<span class="fdesc">${descLabel}${directionText(group.rows[0]!.direction)}</span></div>` +
				`<div class="fplot">${svg}</div>` +
				`<div class="fvals">${labelParts.join('')}</div>` +
				'</div>'
			);
		})
		.join('\n');
	return `
<h2>Effects at a glance</h2>
<p class="note">Dot = estimated effect vs control, line = 95% confidence interval, center line =
no effect. Solid dot: significant; hollow dot (and &deg;): no call. Percentages for log-scaled
metrics, absolute deltas otherwise. Hover a value for the exact numbers.</p>
${rowsHtml}`;
}

function buildTable(estimates: EstimateRow[], manifest: ManifestJson, styles: TreatmentStyle[]): string {
	const byShortName = new Map(styles.map((t) => [t.shortName, t]));
	const orderedMetrics = manifest.metrics.map((m) => m.key);
	const rows = [...headlineRows(estimates)].sort((a, b) => {
		const byMetric = orderedMetrics.indexOf(a.metric) - orderedMetrics.indexOf(b.metric);
		if (byMetric !== 0) return byMetric;
		return a.treatment.localeCompare(b.treatment);
	});
	const trs = rows
		.map((row) => {
			const t = byShortName.get(row.treatment);
			if (!t) return '';
			const effect = effectOf(row);
			const sig = row.verdict === 'significant';
			let cls: string;
			let word: string;
			if (!sig) {
				cls = 'na';
				word = 'no call';
			} else if (row.direction === 'neutral') {
				cls = 'shift';
				word = 'changed';
			} else if (isBetter(effect.value, row.direction)) {
				cls = 'good';
				word = 'better';
			} else {
				cls = 'bad';
				word = 'worse';
			}
			return (
				`<tr class="t-${t.slug} ${sig ? 'significant' : ''}"><td>${escapeHtml(metricName(row.metric))}</td>` +
				`<td><span class="dot" style="background:var(--c-${t.slug})"></span>${escapeHtml(row.treatment)}</td>` +
				`<td class="num">${escapeHtml(effect.label)}</td>` +
				`<td class="num">q=${fmtQ(row.q!)}</td>` +
				`<td><span class="chip ${cls}">${word}</span></td></tr>`
			);
		})
		.join('\n');
	return `
<h2>Every verdict</h2>
<label class="filter"><input type="checkbox" id="sigOnly"> significant only</label>
<div class="tablewrap"><table id="verdictTable">
<tr><th>Metric</th><th>Arm</th><th>Effect</th><th>q</th><th>Verdict</th></tr>
${trs}
</table></div>
<p class="note">"Better"/"worse" follows each metric's own direction; descriptive metrics get
"changed", not a value judgment. q is the false-discovery-corrected p-value; the bar is
q&nbsp;&lt;&nbsp;0.05.</p>`;
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
				'<details class="curve"><summary>' +
				escapeHtml(title) +
				'</summary><div class="curve-card">' +
				stripSvgWrapper(curve.svg) +
				'</div></details>'
			);
		})
		.join('\n');
	return `
<h2>Curves</h2>
<p class="note">Empirical CDF of every run per arm. Curves render on a white card in both themes:
the source SVGs assume a white ground.</p>
${details}`;
}

function buildStyle(styles: TreatmentStyle[]): string {
	const lightVars = styles.map((t) => `--c-${t.slug}:${t.lightColor};`).join(' ');
	const darkVars = styles.map((t) => `--c-${t.slug}:${t.darkColor};`).join(' ');
	const hideRules = styles
		.map((t) => `body.hide-t-${t.slug} .t-${t.slug}{display:none}`)
		.join(' ');
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
body { background:var(--surface); color:var(--ink); margin:0;
  font:16px/1.6 "IBM Plex Sans",system-ui,sans-serif; }
main { max-width:860px; margin:0 auto; padding:48px 24px 96px; }
h1,h2 { font-family:Spectral,Georgia,serif; text-wrap:balance; line-height:1.2; }
h1 { font-size:2.1rem; font-weight:700; margin:8px 0 4px; }
h2 { font-size:1.3rem; font-weight:600; margin:48px 0 12px; }
.eyebrow { font-size:.72rem; letter-spacing:.14em; text-transform:uppercase; color:var(--ink-3); font-weight:600; }
.lede { color:var(--ink-2); max-width:62ch; }
.mono, .num { font-family:"IBM Plex Mono",monospace; font-variant-numeric:tabular-nums; font-size:.86em; }
.legend { display:flex; gap:10px; flex-wrap:wrap; margin:20px 0 6px; font-size:.85rem; }
.chip-toggle { display:inline-flex; align-items:center; gap:7px; font:inherit; font-weight:600;
  color:var(--ink-2); background:var(--card); border:1px solid var(--line); border-radius:99px;
  padding:5px 12px; cursor:pointer; }
.chip-toggle[aria-pressed="false"] { opacity:.4; }
.chip-toggle .dot { background:var(--tc); }
.dot { display:inline-block; width:9px; height:9px; border-radius:50%; margin-right:7px; vertical-align:baseline; }
.summary { list-style:none; padding:0; margin:12px 0; font-size:.92rem; color:var(--ink-2); }
.summary li { margin:6px 0; }
.summary b { color:var(--ink); }
.frow { display:grid; grid-template-columns:220px 1fr 130px; gap:14px; align-items:center;
  padding:9px 0; border-bottom:1px solid var(--line); }
.fname { display:block; font-weight:600; font-size:.9rem; }
.fdesc { display:block; font-size:.74rem; color:var(--ink-3); }
.fplotarea { position:relative; }
.fzero { position:absolute; left:50%; top:0; bottom:0; width:1px; background:var(--line); }
.fci { position:absolute; height:3px; border-radius:2px; transform:translateY(-50%); }
.fdot { position:absolute; width:9px; height:9px; box-sizing:border-box; border-radius:50%;
  border:1.5px solid; background:var(--card); transform:translate(-50%,-50%); }
.fvals { display:flex; flex-direction:column; gap:2px; align-items:flex-end; }
.flab { font-family:"IBM Plex Mono",monospace; font-size:.8rem; cursor:default; position:relative; }
.flab:hover::after { content:attr(data-tip); position:absolute; right:0; bottom:130%; z-index:5;
  background:var(--ink); color:var(--surface); padding:8px 11px; border-radius:6px;
  font:12px/1.5 "IBM Plex Sans",sans-serif; width:290px; white-space:normal; text-align:left; }
table { border-collapse:collapse; width:100%; font-size:.88rem; }
th { text-align:left; font-size:.72rem; letter-spacing:.08em; text-transform:uppercase;
  color:var(--ink-3); font-weight:600; padding:8px 10px; border-bottom:1px solid var(--line); }
td { padding:7px 10px; border-bottom:1px solid var(--line); }
td.num { text-align:right; }
.chip { font-size:.72rem; font-weight:600; padding:2px 9px; border-radius:99px; white-space:nowrap; }
.chip.good { background:color-mix(in srgb, var(--good) 14%, transparent); color:var(--good); }
.chip.bad { background:color-mix(in srgb, var(--bad) 14%, transparent); color:var(--bad); }
.chip.na { background:var(--wash); color:var(--ink-3); }
.chip.shift { background:color-mix(in srgb, var(--ink-2) 12%, transparent); color:var(--ink-2); }
.tablewrap { overflow-x:auto; }
.filter { display:inline-flex; align-items:center; gap:6px; font-size:.85rem; color:var(--ink-2); margin-bottom:10px; }
#verdictTable.sig-only tr:not(.significant) { display:none; }
.note { font-size:.8rem; color:var(--ink-3); margin-top:10px; max-width:66ch; }
.curve summary { cursor:pointer; font-weight:600; padding:10px 0; border-bottom:1px solid var(--line); }
.curve-card { background:#FFFFFF; border-radius:10px; padding:16px; margin:12px 0 20px; }
.curve-card svg { width:100%; height:auto; max-width:100%; display:block; }
@media (max-width:640px) { .frow { grid-template-columns:1fr; gap:4px; } .fvals { flex-direction:row; gap:14px; align-items:baseline; } }
${hideRules}`;
}

function buildScript(): string {
	return `
document.querySelectorAll('.chip-toggle').forEach(function (btn) {
  btn.addEventListener('click', function () {
    var on = btn.getAttribute('aria-pressed') === 'true';
    btn.setAttribute('aria-pressed', String(!on));
    document.body.classList.toggle('hide-t-' + btn.dataset.t, on);
  });
});
var sigOnly = document.getElementById('sigOnly');
var table = document.getElementById('verdictTable');
if (sigOnly && table) {
  sigOnly.addEventListener('change', function () {
    table.classList.toggle('sig-only', sigOnly.checked);
  });
}`;
}

export function renderHtmlReport(input: HtmlReportInput): string {
	const { estimates, manifest, curves } = input;
	const styles = treatmentStyles(manifest.spec.treatments);
	const title = `${manifest.spec.control.shortName} vs ${manifest.spec.treatments.map((t) => t.shortName).join(' + ')}`;
	return `<!doctype html>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Spectral:wght@500;600;700&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap">
<style>${buildStyle(styles)}</style>
<main>
${buildHeader(manifest)}
${buildLegend(styles)}
${buildSample(manifest)}
${buildSummary(estimates, styles)}
${buildForest(estimates, manifest, styles)}
${buildTable(estimates, manifest, styles)}
${buildCurves(curves, manifest)}
</main>
<script>${buildScript()}</script>
`;
}

export function writeHtmlReport(stagingDir: string): void {
	const estimates: EstimateRow[] = JSON.parse(
		readFileSync(join(stagingDir, 'estimates.json'), 'utf8'),
	);
	const manifest: ManifestJson = JSON.parse(readFileSync(join(stagingDir, 'manifest.json'), 'utf8'));
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
	writeFileSync(join(stagingDir, 'report.html'), renderHtmlReport({ estimates, manifest, curves }));
}
