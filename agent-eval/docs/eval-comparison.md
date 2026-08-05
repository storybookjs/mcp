# Old `/eval` vs new `/agent-eval`: feature-gap analysis

Comparison of the legacy eval harness (`eval/`) against the current
`agent-eval/` suite, surfacing every capability of the old system that the new
one does not have, with a build-cost and relevance assessment for each, sorted
by implementation priority.

## The two architectures in one paragraph each

**Old `/eval`** is a local CLI harness. It copies a Vite+React template into a
trial directory, optionally boots a local Storybook with `addon-mcp` (or a
stdio `@storybook/mcp` fed by static manifests), runs one of three agent CLIs
(Claude Code, Copilot, Codex) as a subprocess, then **grades the produced
artifact itself**: vite build, programmatic tsc error counts, programmatic
ESLint counts, its own vitest/browser story-test run with per-story pass/fail,
axe a11y violation counts, istanbul coverage, an expected-imports
"component-usage" score, declarative per-MCP-tool expectations (call bounds,
deep-partial input match, output-token budgets), an optional `judge.md` LLM
judge, and a weighted composite quality score. Results are saved as a
Storybook (docs pages for summary/transcript/lint/typecheck/coverage/judge),
published to Chromatic, and appended to a public Google Sheet. A batch runner
executes variant configs × N iterations in parallel workers and prints a
mean ± sd comparison per variant.

**New `/agent-eval`** builds on `@vercel/agent-eval`: experiments run agents
in Vercel/Docker sandboxes against fixture projects, where a template starts a
real Storybook and the agent is wired up through `.mcp.json` /
`.codex/config.toml` or plugin skills. Each eval's `EVAL.ts` asserts **agent
behavior** — workflow-tool calls and ordering, tool payload validity, final
response contents, files on disk, `run-story-tests` results as reported by the
tool, lifecycle outcomes (Storybook boots, dependencies upgraded) — plus
LLM-judge matchers (`toSatisfyCriterion` / `toScoreAtLeast`). It adds
sandboxing, CI labels with budget gating, failure classification, token/cost
usage with cache accounting, a hosted results playground, PR-body result
summaries, and the agentic-reference research line (treatment/control cases,
external-repo pins, offline code metrics: SLoC, cyclomatic/cognitive/JSX
complexity, churn, tool-use taxonomy, tree-diff vs a pinned baseline).

The philosophical shift matters for the gap list: the old system **verified
the artifact independently of the agent**; the new system mostly **verifies
the agent's behavior and trusts the tooling's own reports** (its post-run
`scripts` checks — typecheck, build, test:stories, lint — exist in the
framework but are deliberately disabled in `lib/experiment.ts` due to sandbox
flakiness). Most high-priority gaps below are consequences of that shift.

## Already covered or superseded (do not re-build)

| Old capability | New counterpart |
| --- | --- |
| Claude Code / Codex agents, model + effort pinning | Framework agents; effort control is new and better |
| Live Storybook MCP context (`storybook-mcp-dev`) | Templates boot Storybook via postinstall; local `file:` builds of `addon-mcp`/`mcp` |
| Arbitrary MCP servers, extra prompts, inline prompt injection | `registerMcpServer`, fixture-per-variant, `editPrompt` |
| With/without-MCP A/B comparison | Agentic-ref treatment vs bare `none` control cases |
| Cost (USD), duration, turns | `lib/usage.ts` (incl. cache-hit accounting — better), harness duration, `o11y.totalTurns` |
| Parallelism, stagger, per-run logs, failure summary | Framework concurrency + start rate-limiter, `outputs/*.txt`, failure classifier (better) |
| LLM judge (`judge.md`, score+reason) | Agentic judge matchers on `transcript`/`environment` subjects; 912's rubric ported as `A11Y_VISUAL_CHANGE_APPROVAL_CRITERION` |
| Results viewer (result-docs Storybook) | Hosted playground (experiments/evals/compare/transcript pages) + CI artifact download |
| Public Google Sheet as shared record | Playground deployments + PR-body summary + `results/analysis-summary.json` |
| Trial cleanup scripts | Results are gitignored; framework housekeeping |
| 9xx task prompts/fixtures | Ported as `evals/9xx-*` (behavioral assertions only — see gaps) |

## Missing features, by implementation priority

Cost scale: **S** ≈ ≤1 day, **M** ≈ several days, **L** ≈ a week or more /
upstream contribution. Relevance is judged against what the eval system is
for: (a) a CI regression gate for the MCP/plugin workflows, (b) a research
instrument for "does Storybook/DS context make agents better", (c) evidence
for product decisions about MCP tool design.

### P1 — build next

**1. Independent artifact verification (build / typecheck / lint / story tests)**
- *Was:* `eval/lib/graders/{build,typecheck,lint,test-stories,run-tests,parse-tests}.ts` — the harness built the project, counted tsc and ESLint errors programmatically, and ran the story tests itself with per-story pass/fail parsed from vitest JSON.
- *Now:* `EVAL.ts` checks the agent called `run-story-tests` and that the tool's own report showed passing stories. Nothing independently confirms the project builds, typechecks, lints, or that tests pass outside the agent's session. The framework's `scripts` hook would do exactly this but is commented out in `DEFAULT_EXPERIMENT_CONFIG` ("fail on sandbox environment flakiness more often than on agent mistakes").
- *Why it matters:* the eval currently trusts the agent's testimony. A run can go green while the artifact is broken (non-story code that doesn't compile, lint disasters, tests green only inside the agent's stale dev-server session). It also mis-scores the 9xx ports, which formerly measured exactly this.
- *Cost:* **M** — the mechanism exists; the work is de-flaking (retries, port isolation, tolerating install noise) and recording error *counts* (`scriptsResults` output parsing) rather than raw pass/fail, so results stay comparable across arms.
- *Relevance:* **High** — restores the "production-quality output" half of the eval's value; prerequisite for gaps 5 and 10.

**2. Design-system usage metric (expected-imports conformance)**
- *Was:* `eval/lib/graders/component-usage.ts` + `config.json#expectedImports` — static import extraction scored matched/missing/unexpected DS imports (did the agent actually build with Reshaped, or hand-roll HTML?).
- *Now:* nothing. Agentic-ref measures complexity/churn of what was written, and 8xx asserts `get-documentation` was *called*, but nothing checks the produced code *uses* the design system.
- *Why it matters:* this is the closest proxy the old system had for the agentic-reference research question — DS docs quality → correct DS adoption. As a pure static pass it slots into the offline `post-analysis` metrics (zero agent spend, re-runnable over stored runs and baselines).
- *Cost:* **S** — the old extractor is dependency-free and portable; add it under `lib/agentic-reference/metrics/` with per-eval expected-import lists (or "imports from the DS package at all" as the delta metric).
- *Relevance:* **High** for the 70x research line; useful assertion for 8xx/9xx too.

**3. MCP context-efficiency accounting (per-tool output tokens + declarative expectations)**
- *Was:* `eval/lib/graders/mcp-tools.ts` — per-tool call counts, per-tool output-token totals, and declarative `expectedMcpTools`: `minCalls`/`maxCalls`, `expectedCalls` (deep-partial input match), `maxOutputTokens` budgets, with an all-expectations-passed rollup.
- *Now:* `o11y.toolCalls` gives counts; `expectWorkflowCalls` asserts presence; input checks are hand-rolled per eval (e.g. 811's `a11y !== false`); tool-use taxonomy buckets calls. **No one measures how many tokens each MCP tool's responses consume**, and there is no reusable min/max/input-match/token-budget helper.
- *Why it matters:* output-token cost per tool is a direct product signal for MCP tool design (the repo's own docs-tool changes are exactly what `EVAL_STORYBOOK_LATEST` exists to check). Token budgets catch "the tool works but floods the context" regressions that behavioral assertions can't see.
- *Cost:* **S–M** — transcripts already carry tool results (both agents); estimate tokens (chars/4 or a tokenizer) in an offline metrics pass, plus a small declarative helper in `#test-utils` for budgets/bounds/input matching.
- *Relevance:* **High** — this measures the product itself, not just the agent.

### P2 — worth scheduling

**4. Repetition with dispersion statistics for the workflow line**
- *Was:* N iterations per variant with a mean ± sd comparison table (duration, cost, turns, a11y, usage score) — `eval/lib/eval/run-eval.ts`.
- *Now:* CI runs each 8xx eval once (`runs: 1`, `earlyExit`) — a deliberate cost decision. Agentic-ref supports `AGENTIC_REF_RUNS` (default 10) but its `summarize` reports **means only, no sd/variance** (`lib/utils/math.ts` has no deviation helper).
- *Cost:* **S** infra (an sd helper + a `ci:extra-runs`-style label reusing the existing `runs` knob); the real cost is run spend, which the label model already governs.
- *Relevance:* **Medium-High** — single-run gates are noisy (the repo already carries "known failure ~1 in 4 runs" comments); at N=10 research samples, means without dispersion under-report uncertainty.

**5. Independent a11y violation counting**
- *Was:* axe violations per story parsed from the harness's own test run; fed quality scores and the public sheet.
- *Now:* behavioral only — 811/812/912 forbid `a11y: false` and judge the response; violation counts are only whatever `run-story-tests` output happens to say, and are not extracted as a metric.
- *Cost:* **S** once gap 1 exists (addon-a11y is already in the templates); alternatively parse `## Accessibility Violations` sections out of stored transcripts offline.
- *Relevance:* **Medium** — a headline number for "agents + Storybook produce more accessible UI", and a cross-arm comparison the research line can use.

**6. System-prompt (CLAUDE.md / AGENTS.md) experimentation axis**
- *Was:* per-variant `systemPrompts` merged `system.*.md` into `Claude.md` (used by 901–907 `system.explicit-mcp.md` and 910's `system.a11y-false.md` arm).
- *Now:* prompt variation only via `PROMPT.md` fixtures and `editPrompt`; the 910 system-prompt arm was dropped in the port, and nothing writes agent instruction files.
- *Cost:* **S** — a `setup()` helper writing `CLAUDE.md`/`AGENTS.md` per case/experiment.
- *Relevance:* **Medium** — instruction-placement (system vs user prompt vs skill) is a live question for the plugin work; cheap to restore.

**7. Fail-fast MCP health gate at setup**
- *Was:* the old runner aborted a trial immediately if the agent's init reported an MCP server as not connected — no tokens spent on a doomed run, no misattributed failure.
- *Now:* a dead MCP surfaces as failed behavioral assertions after the full agent run has been paid for; the classifier may catch it afterwards, and only agentic-ref has a transcript sanity gate.
- *Cost:* **S** — probe `:6006/mcp` (or the registered server) at the end of `setup()` and throw.
- *Relevance:* **Medium** — spend protection and cleaner attribution; complements, not replaces, the classifier.

**8. Composite quality score**
- *Was:* `calculateQuality` hook + `lib/quality/*` weighted calculators combining tests/lint/a11y/usage/judge into one 0–1 scalar per trial, used for cross-variant ranking.
- *Now:* pass/fail per assertion, judge thresholds, and a table of independent metrics — no single comparable scalar per run/arm.
- *Cost:* **S** — a `summarize`-side fold once gaps 1/2/3/5 supply inputs.
- *Relevance:* **Medium** — mostly presentation, but it is what makes cross-arm comparisons legible to non-researchers.

### P3 — opportunistic / only with a concrete trigger

**9. Rendered-UI publishing (Chromatic or hosted static Storybook per run)**
- *Was:* every trial's Storybook (with embedded result docs) built and published to Chromatic — humans could *look at* what the agent built; visual regression was possible.
- *Now:* full file snapshots (`copyFiles: 'all'`) and transcripts in the playground, but nothing renders the UI.
- *Cost:* **M** — build `storybook-static` in the sandbox post-run and attach as artifact / deploy alongside the playground.
- *Relevance:* **Medium** — code metrics can't judge visual quality; valuable for the research write-ups, not for the CI gate.

**10. Coverage measurement** — old istanbul integration incl. per-file line hits. Story-export completeness is partially covered by `expectAllStoryExportsInDisplayReview`. Cost **M** (depends on gap 1), relevance **Low-Medium**.

**11. Static-manifest docs MCP mode** — old `storybook-mcp-docs` ran `@storybook/mcp --manifestsDir` with no dev server. The agentic-ref preview package covers the *external DS* flavor; the project-local static mode of the published `@storybook/mcp` has no experiment. Cost **S**, relevance **Low-Medium** (only if that product path still ships to users).

**12. Flat results export (CSV/Sheet)** — old auto-appended every trial to a public Google Sheet grouped by uploadId/runId. `analysis-summary.json` + the playground supersede it internally; an exporter for external analysis (R/pandas) is trivial to add when a research round needs it. Cost **S**, relevance **Low**.

**13. Environment capture** — old wrote `environment.json` (envinfo, git branch/commit) per trial. New records the Storybook version pin and model; the git sha lives only in CI context, not in `result.json`. Cost **S**, relevance **Low** (sandboxes are uniform; add the repo sha to `onRunComplete` for provenance).

**14. Copilot CLI agent (and its model breadth: Gemini, GPT minis, cross-vendor)** — old ran GitHub Copilot CLI with 8 models. The framework has no Copilot adapter; output parsing was always the weak point (no structured transcript). Cost **L** (upstream or custom agent), relevance **Low-Medium** — brings Gemini coverage and a major MCP client, but poor observability limits its eval value.

**15. Local ergonomics: interactive CLI, rerun-command echo, `start-trial-storybook --back N`, per-message token/cost in the transcript viewer** — the new system is CI-first (`EVAL_ONLY`, `--dry`, playground). Cost **M** in aggregate, relevance **Low**.

## Dropped content (fixtures, not infrastructure)

Not features of the harness, but coverage the old task set had and the new eval
set does not:

- **Design-system breadth:** flight-booking existed for plain CSS, Reshaped, Radix, and RSuite; only Reshaped survives (plus base-ui in agentic-ref).
- **Docs-source arms:** `read-from-node_modules.md` / `read-from-website.md` prompt variants (MCP docs vs. reading node_modules vs. the web) — precisely the treatment/control shape agentic-ref formalizes; worth porting as cases if that question returns.
- **910's system-prompt arm** (see gap 6) — concise/explicit arms were ported, the system-prompt arm was not.
