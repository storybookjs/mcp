# Agent Evaluation Suite

Test AI coding agents to measure what actually works.

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
   - **Choose ONE agent key**: `AI_GATEWAY_API_KEY` (for Vercel agents), `ANTHROPIC_API_KEY`, or `OPENAI_API_KEY`
   - **Choose ONE sandbox option**: `VERCEL_TOKEN`, `VERCEL_OIDC_TOKEN`, or use Docker (set `sandbox: 'docker'` in config)

## Running Evals

### Preview (no cost)

See what will run without making API calls:

```bash
npx @vercel/agent-eval claude --dry
```

### Run Experiments

Run the Claude Code Storybook plugin eval fixtures:

```bash
npx @vercel/agent-eval claude
```

Run the Codex Storybook plugin eval fixtures:

```bash
npx @vercel/agent-eval codex
```

Each experiment is one agent. Each eval fixture owns one scenario:

- `922-skill-storybook-setup-claude-launch`: configure `.claude/launch.json` for Storybook
- `923-skill-stories`: change the Badge component, write stories, and preview them

The Claude experiment runs both fixtures. The Codex experiment runs `923-skill-stories`;
`922-skill-storybook-setup-claude-launch` is specific to Claude's launch config.

The Codex experiment uses the Vercel AI Gateway Codex adapter
(`agent: 'vercel-ai-gateway/codex'`), so it uses the same gateway credential
path as the Claude experiment.

### Skill injection

The Storybook plugin skills are **not** committed into the eval fixtures. Each
experiment's `setup` hook injects them into the sandbox via `lib/skills-fixture.ts`,
which reads the canonical skills from the plugin packages and applies two
eval-only overlays:

- the `.agent-eval/skills/<name>.json` invocation marker (so the harness can
  detect a real skill invocation) — on the `init` and `stories` skills
- a sandbox `require_escalated` note — on the `stories` skill

| Sandbox dir      | Canonical source                                 |
| ---------------- | ------------------------------------------------ |
| `.claude/skills` | `packages/claude-plugin/skills`                  |
| `.agents/skills` | `packages/codex-plugin/plugins/storybook/skills` |

The plugin packages stay the single source of truth for skill content — update a
skill in `packages/`, not in a fixture. Because the content is read live at setup,
refreshing a skill there changes what the eval exercises, so re-run the experiments
after a skill change.

### Scoring

Each run still has pass/fail validation, and also writes the former weighted scoring
rubric to `result.json` at `analysis.evaluation`.

Scoring is intentionally separate from fixture pass/fail validation. `EVAL.ts` should
keep checking hard correctness requirements, while `lib/scoring` captures weighted
quality signals for comparison across agents and migrations from the former eval
infrastructure.

`922-skill-storybook-setup-claude-launch`:

| Metric                                              | Weight |
| --------------------------------------------------- | ------ |
| Storybook launch entry exists with `autoPort: true` | 100 %  |

`923-skill-stories`:

| Metric                                        | Weight |
| --------------------------------------------- | ------ |
| Loaded story rules via the `storybook ai` CLI | 30 %   |
| Invoked/followed the `stories` skill workflow | 20 %   |
| Wrote a `*.stories.*` file                    | 20 %   |
| Opened a preview via `preview-stories`        | 30 %   |

Export the latest results, including weighted scoring, with:

```bash
pnpm run export-results
```

This writes `agent-results.json`.

To migrate scoring for another former eval:

1. Add the fixture under `evals/<fixture-name>`.
2. Add a scorer in `lib/scoring/scorers/<fixture-name>.ts` with `defineScorer`.
3. Register it in `lib/scoring/registry.ts`.
4. Add or update `lib/evaluation-scoring.test.ts`.

Scorers receive `{ fixtureName, runData, analysis, agent }` and return itemized
weighted metrics. Shared evidence helpers for generated files, shell commands,
skill invocation markers, and Claude launch config parsing live in
`lib/scoring/evidence.ts`.

```ts
import { defineScorer, binaryItem, totalScore } from '../types.ts';

export const myFixtureScorer = defineScorer({
	fixtureName: 'my-fixture',
	score({ runData, analysis, agent }) {
		return totalScore([binaryItem('did-work', 'Completed the expected workflow', 1, true)]);
	},
});
```

### View Results

Launch the web-based results viewer:

```bash
npx @vercel/agent-eval playground
```

Open [http://localhost:3000](http://localhost:3000) to browse results.
