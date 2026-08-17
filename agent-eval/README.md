# Agent Evaluation Suite

Runs coding agents (Claude Code and Codex) against fixture projects in
sandboxes and asserts that they follow the Storybook workflows this repo
ships — writing stories, previewing or reviewing them, and running story
tests through the MCP server or the plugin skills.

## Setup

1. **Install dependencies:**

   ```bash
   pnpm install
   ```

2. **Configure environment variables:**

   ```bash
   cp .env.example .env.local
   ```

   Edit `.env.local` and add your API keys (see comments in `.env.example` for options):
   - **Agent keys**: `ANTHROPIC_API_KEY` is required for the Claude Code experiments and for failure classification, both of which use the direct Anthropic API. `OPENAI_API_KEY` is required for the Codex experiments, which use the direct Codex API.
   - **Sandbox access**: this suite is configured with `sandbox: 'auto'`, which uses Vercel Sandbox when access-token credentials (`VERCEL_PROJECT_ID`, `VERCEL_TEAM_ID`, and `VERCEL_TOKEN`) are present and falls back to local Docker otherwise. Set `sandbox: 'docker'` to force Docker-only experiments.

## Running Evals

Commands below assume you are in `agent-eval/`. From the repository root, prefix
them with `pnpm --dir agent-eval`, for example `pnpm --dir agent-eval run
eval:dry`.

### Preview (no cost)

See what will run without making API calls:

```bash
pnpm eval:dry
```

### Run Experiments

Run all configured experiments:

```bash
pnpm eval
```

Run a single experiment:

```bash
pnpm exec agent-eval cc-mcp-opus-high
```

Pull requests with the `ci:eval` label run all experiments in CI. The
`ci:eval`/`ci:extra-*` labels are applied by **humans only** — labeled runs are
expensive and re-trigger on every subsequent push, so an AI agent must never
add them to a PR (nor start `workflow_dispatch` eval runs). Agents validate
their changes locally instead: only the specific evals affected by the change
(or the eval being fixed), one experiment at a time, via `EVAL_ONLY` — never a
full line, never multiple experiments in parallel.

By default only the first core eval (`801-create-component-no-launch-config`)
runs. Set `EVAL_EXTRA_EVALS=1` to run the full hand-crafted line — the 8xx
workflow evals on every experiment plus the lifecycle 82x evals
(`storybook-init`/`storybook-upgrade` scenarios) on the plugin experiments —
or `EVAL_ONLY=<name>[,<name>]` to debug specific evals one at a time:

```bash
EVAL_EXTRA_EVALS=1 pnpm eval
EVAL_ONLY=803-edit-component pnpm eval
```

A full `EVAL_EXTRA_EVALS=1` run (12 workflow evals × 4 experiments + 3
lifecycle evals × 2 plugin experiments) costs roughly **$30–45** in agent
tokens at current per-run averages ($0.30–0.80 per workflow eval, $1–2 per
lifecycle eval). The budget guardrail is **$75 per full run** — check the
usage metadata in the results playground before growing the eval set past it
(see storybookjs/mcp#324).

The 9xx evals (ports from the old `/eval` system) never run automatically; see
`lib/experiment.ts`.

Experiments named `<agent>-<integration>-<model>-<effort>` pin their model and
effort explicitly. Non-default model tiers (currently `cc-plugin-sonnet-medium` and `cc-mcp-sonnet-medium`)
run zero evals unless `EVAL_EXTRA_MODELS=1` is set, so labeled CI runs only pay
for the default-model experiments:

```bash
EVAL_EXTRA_MODELS=1 pnpm exec agent-eval cc-plugin-sonnet-medium
```

Sandbox setup resolves the Storybook npm dist-tag at run time and pins the
exact version it finds into the sandbox `package.json`, so each result snapshot
records which version the run used. By default it pins the `next` tag and keeps
the local `@storybook/addon-mcp`/`@storybook/mcp` builds from this checkout.
Set `EVAL_STORYBOOK_LATEST=1` to pin the `latest` tag instead — including the
published `@storybook/addon-mcp` and `@storybook/mcp` in place of the local
builds — to check whether a behavior change (e.g. in the documentation tooling)
regressed since the last stable release:

```bash
EVAL_STORYBOOK_LATEST=1 pnpm eval
```

Review mode follows the integration. The plugin experiments always run — and
assert — the review workflow (display-review published, review section in the
final response), because review is on by default for the `storybook ai` CLI
channel the plugins use. The MCP experiments run review-off by default
(preview-stories links, no display-review), matching direct MCP clients where
the `experimentalReview` feature flag is opt-in. Set `EVAL_REVIEW=1` to enable
the flag in every sandbox Storybook and flip the MCP assertions to the review
workflow too:

```bash
EVAL_REVIEW=1 pnpm eval
```

In CI, the `ci:extra-evals`, `ci:extra-models`, `ci:storybook-latest`, and
`ci:review` PR labels set the matching flag on labeled `ci:eval` runs, and
manual `workflow_dispatch` runs of the `Agent eval` workflow can enable them
through the `extra_evals`, `extra_models`, `storybook_latest`, and `review`
inputs, or target specific evals through the `eval_only` input. All of these
are human-triggered spend decisions; agents never apply the labels or dispatch
the workflow.

CI uses Vercel Sandbox through access-token credentials (`VERCEL_PROJECT_ID`,
`VERCEL_TEAM_ID`, and `VERCEL_TOKEN`). Do not store a static
`VERCEL_OIDC_TOKEN` in GitHub secrets; development OIDC tokens expire and
Vercel-issued OIDC is only refreshed automatically inside Vercel-managed
runtime/build contexts.

Configured experiments (Claude Code experiments use the direct Anthropic API
via `ANTHROPIC_API_KEY`; Codex experiments use the direct Codex API via
`OPENAI_API_KEY`):

- `cc-mcp-opus-high`: Claude Code (Opus at high effort) with project-local Storybook MCP config in `.mcp.json`.
- `cc-plugin-opus-high`: Claude Code (Opus at high effort) with Storybook plugin skills copied to `.claude/skills`.
- `codex-mcp-gpt-5.5-medium`: Codex (gpt-5.5 at medium reasoning effort) with project-local Storybook MCP config in `.codex/config.toml`.
- `codex-plugin-gpt-5.5-medium`: Codex (gpt-5.5 at medium reasoning effort) with Storybook plugin skills copied to `.agents/skills`.
- `cc-mcp-sonnet-medium` / `cc-plugin-sonnet-medium`: Claude Code (Sonnet at medium effort) variants; they run zero evals unless `EVAL_EXTRA_MODELS=1` is set.

## Known Failures

Accepted eval failures are documented as a code comment directly above the
relaxed assertion in the affected `EVAL.ts`. The comment is self-contained:
the observed behavior, the evidence (CI run id and date), and the condition
for re-enabling. See the gates in `evals/807-docs-request/EVAL.ts` and
`evals/808-shared-infra-fallback/EVAL.ts` for the expected shape.

## Shared Templates

Fixtures can opt into a shared starter project with package metadata:

```json
{
	"evals": {
		"template": "reshaped-storybook"
	}
}
```

Templates live in `agent-eval/templates/<template-name>` and are copied into the
sandbox during setup before the agent runs. They intentionally stay visible in
saved result project snapshots so eval runs are easy to inspect.

Three templates exist today:

- `reshaped-storybook`: the design-system shape — Reshaped components, full
  Storybook (`next`) with the local addon builds, MSW, and the vitest story
  test setup.
- `vite-app`: a minimal React + Vite app with **no Storybook at all**. The
  lifecycle fixtures use it directly (820 init) or layer an old Storybook on
  top (821/822 upgrades and 823 setup-on-outdated, which also set
  `evals.pinStorybook: false` so the harness keeps their intentionally
  outdated versions); 812 layers a full Storybook `next` setup with zero
  stories on top.
- `monorepo`: an npm-workspaces repo where the runnable Storybook lives in the
  `packages/ui` leaf, so evals can cover agents working inside a workspace
  package. Storybook pinning and the local `file:` build detection cover
  workspace package.json files too.

This keeps prompt variants small: each variant keeps its own `PROMPT.md`,
`EVAL.ts`, and metadata `package.json`, while shared app files stay in the
template.

Templates can use local built Storybook MCP packages with npm `file:`
dependencies, for example `file:./local-packages/addon-mcp`. The setup step
copies `packages/addon-mcp/dist` and `packages/mcp/dist` from this checkout into
the sandbox before the sandbox runs `npm install`. CI builds those packages
before running evals; run `pnpm --filter @storybook/addon-mcp... run build`
locally after changing those packages.

The MCP experiments configure each agent through its project-local MCP file:
Claude Code gets `.mcp.json`, and Codex gets `.codex/config.toml`. The plugin
experiments do not write MCP config; they copy the Storybook plugin skills into
the agent's project skill directory instead. The template is responsible for
starting Storybook before the agent runs; `reshaped-storybook` does this from
`postinstall` so it runs after sandbox dependencies are installed.

Codex experiments use the direct `codex` agent with `OPENAI_API_KEY`. The
`codex-mcp` experiment cannot use `vercel-ai-gateway/codex` until the Gateway
path handles Codex's Responses namespace tool shape reliably. See
https://github.com/openai/codex/issues/26234.

## Agentic-reference cases

The agentic-reference research line (the `70x` workflow fixtures) works
differently from other evals. Instead of running a workflow and making
pass/fail assertions about its output, it collects the output of the LLM eval,
and performs an in-depth post-analysis that involves computing metrics,
running LLM judges, and comparing different experiments that used the same
workflow fixture for statistically significant changes to metrics.

Agentic reference uses the following concepts:

- An external app repo where the LLM workflow will run (e.g. Mealdrop)
- An external MCP app that provides Storybook content (e.g. the Droppy DS)
- A workflow fixture that contains the prompt to run
- An experiment case that defines which version of the app and MCP will be used

The Storybook instance used for agentic reference (either Base UI or Droppy)
generates dozens of different NPM packages with different stories and MDX docs.
This is performed by classifying the Storybook data and running two tailored
scripts on these repos: `pnpm experiment:freeze` and `pnpm experiment:publish`.
To use a different Storybook for agentic reference, it needs the same concepts
built in.

Much of agentic reference eval is about comparing these different MCP contents
to see which ones perform a set of workflows best. This is configured in
`lib/agentic-reference/cases.ts`, where `storybookMcpPackage` or `storybookMcpUrl`
can be passed to point to a published MCP package or deployed Chromatic MCP.
Experiments are generated with the `pnpm gen:agentic-ref` command, into a git
ignored folder, to avoid having to hand maintain dozens of experiments.

Control cases to compare against the Storybook MCP can choose to not provide any
instructions, or use `skillDirs` to provide competing skills. It's also possible
to pass a `transformPrompt` function to inject instructions to use a MCP, skill
or external resource based on whether you're testing agents' tool selection
behaviour or their raw performance once the tested tool has been selected.

To capture runs, first use the dry mode command to understand what will happen.
See below for options for this command. Runs can cost up to $25 each for larger
workflows.

```bash
pnpm eval:agentic-ref:dry
```

If you have run capture in the cloud via the GitHub action, you'll need to
download data locally with `pnpm results:download`.

Once runs have been captured, the agentic reference post-analysis computes
metrics for a control case and Storybook cases. This happens in
`scripts/analyze-results.ts`, via `pnpm results:analyze`.

Its tables cover one comparable set each — every stored run measuring the same
thing, however many result directories they were collected in, since a plan tops
a cell up in as many invocations as it takes.

What a run measured is read from the run's own artifacts
(`lib/agentic-reference/identity.ts`): the external-repo pin, the design-system
MCP served, the model, whether the case rewrote the prompt, and a digest of the
fixture's `PROMPT.md` and `EVAL.ts`. The harness's own fingerprint is not used —
it hashes the sample size and the whole fixture, so two collections of one cell
never match and an unrelated fixture edit invalidates everything.

Runs measuring something their cell no longer measures are kept in a group of
their own rather than averaged into the sample being collected today, and are
not printed unless `--superseded` is passed. With it, each such group says which
part of its measurement moved, e.g. `pin: yannbf/mealdrop@droppy-v2 →
yannbf/mealdrop@droppy-70pc`.

Where two external-repo pins name the same upstream tree — a re-tag, say — list
them in `BUNDLED_PINS` (`lib/agentic-reference/identity.ts`) and their runs are
aggregated as one sample.

Each result directory's own `summary.json` still describes only the runs beside
it.

Once all metrics have been computed, a separate script compares them for
statistical significance between experiments. The command for that is
`pnpm results:compare`.

### Selecting what runs

Choices can be passed as CLI options or environment variables. Flags take precedence over env vars.

| Flag                   | Selects                                                 | Env fallback              | Alternative name |
| ---------------------- | ------------------------------------------------------- | ------------------------- | ---------------- |
| `--experiments <list>` | cases, by name or glob (`agentic-ref-cc-control-none*`) | `AGENTIC_REF_EXPERIMENTS` | `--cases <list>` |
| `--evals <list>`       | evals, by name, number (`703`) or glob (`70*`)          | `AGENTIC_REF_EVALS`       | `--flows <list>` |
| `--runs <n>`           | repetitions per (experiment, eval) cell (default 10)    | `AGENTIC_REF_RUNS`        |                  |
| `--force`              | re-run cells that already have saved results            | `AGENTIC_REF_FORCE`       |                  |
| `--dry`                | print the plan, spend nothing                           | `AGENTIC_REF_DRY`         |                  |
| `--expect <n>`         | refuse to run unless the plan is exactly `n` evals      | `AGENTIC_REF_EXPECT`      |                  |

Each env fallback is the flag uppercased behind `AGENTIC_REF_`, and a flag always
beats its env var.
`--experiments` and `--evals` have alternative names to account for how we talk about them in the day to day (`--cases` and `--flows`).
These options take comma-separated values. Each value can be a full name, or a glob pattern. For evals, a number can also be passed.

The same options drive both `pnpm eval:agentic-ref:dry` and `pnpm results:analyze`,
env fallbacks included — so one exported selection narrows a run and the analysis
that follows it alike. `results:analyze` adds `--since <ISO date>`, `--latest`,
`--recompute`, `--superseded` and the `--general`/`--complexity`/`--coverage`
table flags, each with the same `AGENTIC_REF_` fallback.

Fallbacks key off the canonical flag name, never an alternative one:
`--recompute` reads `AGENTIC_REF_RECOMPUTE`, and its `--force` spelling stays
command-line only. Otherwise an `AGENTIC_REF_FORCE` exported to re-run a case
would go on to rebuild every committed baseline in the next analysis pass.

```bash
# Preview any invocation below at zero cost
pnpm eval:agentic-ref:dry

# Everything: every experiment × its evals
pnpm eval:agentic-ref

# One experiment, all of its evals
pnpm eval:agentic-ref --experiments agentic-ref-cc-control-none-opus-high

# A group of experiments, by glob (make sure to quote it)
pnpm eval:agentic-ref --experiments "agentic-ref-cc-*"

# One eval across every experiment that includes it
pnpm eval:agentic-ref --evals 703

# One cell: one experiment against one eval
pnpm eval:agentic-ref --experiments agentic-ref-cc-control-none-opus-high --evals 703

# Research sample: repeat every selected cell once
pnpm eval:agentic-ref --experiments "agentic-ref-cc-*" --runs 1

# Spend guard: run only if this selection is exactly the size expected
pnpm eval:agentic-ref --experiments "agentic-ref-cc-*" --evals 703 --runs 1 --expect 3
```

Completed (experiment, eval) cells are fingerprint-cached: re-running a
partially completed selection only executes what is missing (`--force`
overrides).

### View Results

```bash
pnpm playground
```

Open [http://localhost:3000](http://localhost:3000) to browse results.

### Download CI Results

Pull the eval results produced by recent CI runs into the local
`agent-eval/results` directory, so they can be browsed in the local playground
and inspected by analysis tooling:

```bash
pnpm results:download        # latest 20 agent-eval-results artifacts
pnpm results:download 5      # or any count between 1 and 100
```

Requires an authenticated GitHub CLI (`gh auth login`) and a `tar` binary
(preinstalled on macOS and Linux). Result snapshots are
keyed by experiment name and run timestamp, so artifacts from multiple CI runs
merge into `agent-eval/results` without colliding, and re-running the command
is idempotent. Each artifact is roughly 20–40 MB extracted.

### Clear Out Interrupted Runs

A run stopped by something outside the experiment — a 402 from the gateway, an
eval timeout, an MCP endpoint that would not answer, the host killing a
container — still leaves a `run-N` directory behind, holding a transcript of how
far it got and no `project` tree. There is nothing in it to measure, so the
analysis skips it and the plan runner does not count it towards a cell's sample.

`pnpm results:prune` is what removes them:

```bash
pnpm results:prune                                  # list them, delete nothing
pnpm results:prune --experiments "agentic-ref-cc-*" # same selection grammar as the runner
pnpm results:prune --delete                         # remove them
```

It reports what stopped each run (billing, timeout, network), and `--delete`
removes the directories, along with any eval or result directory they leave
empty. Re-run `pnpm eval:plan --dry` afterwards to see the gaps they were
hiding.

### Deploy Results Playground

The `Agent eval` GitHub Actions workflow deploys the playground to Vercel
project `storybook-evals` after eval results have been written to
`agent-eval/results`.

- Pull requests from the main repository with the `ci:eval` label create
  preview deployments.
- Manual runs on non-`main` branches create preview deployments.
- Manual runs on `main` create production deployments.

The workflow deploys from the same runner that produced `agent-eval/results`,
so failed evals can still publish a playground with partial results. The final
workflow status still fails when the eval, build, or deploy step fails.

The workflow links the Vercel project at runtime instead of committing
`.vercel/project.json`. It uses the same Vercel access token for the Sandbox
evals and the Vercel CLI preview deployment, but those are separate steps:
Sandbox auth happens in `pnpm eval`, while the preview playground deployment
runs `vercel link`, `vercel pull`, `vercel build`, and
`vercel deploy --prebuilt`.

Configure these GitHub secrets before enabling the workflow:

- `VERCEL_TOKEN`: Vercel access token with Sandbox and deploy access to the Storybook team.
- `VERCEL_TEAM_ID`: Vercel team ID or slug for the Storybook account.
- `VERCEL_PROJECT_ID`: Vercel project ID used by Vercel Sandbox access-token auth.

The thin app wrapper in `agent-eval/app` re-exports routes from
`@vercel/agent-eval-playground` so Next.js can discover them from this package.
Run `pnpm playground:check-routes` after upgrading the playground package.
