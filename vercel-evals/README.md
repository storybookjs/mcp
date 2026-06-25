# Agent Evaluation Suite

Test AI coding agents to measure what actually works.

## Setup

1. **Install dependencies:**
   ```bash
   npm install
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

The Codex experiment uses the native Codex adapter (`agent: 'codex'`) rather
than the Vercel AI Gateway adapter, so it requires `OPENAI_API_KEY`.

### Scoring

Each run still has pass/fail validation, and also writes the former weighted scoring
rubric to `result.json` at `analysis.evaluation`.

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

### View Results

Launch the web-based results viewer:

```bash
npx @vercel/agent-eval playground
```

Open [http://localhost:3000](http://localhost:3000) to browse results.
