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

Run all Storybook plugin eval fixtures with Claude Code:

```bash
npx @vercel/agent-eval claude
```

Run all Storybook plugin eval fixtures with Codex:

```bash
npx @vercel/agent-eval codex
```

Each experiment is one agent. Each eval fixture owns one scenario:

- `ade-plugins-bare`: initialize Storybook and add the MCP addon
- `ade-plugins`: change the Badge component and add stories
- `ade-plugins-stories-only`: add stories without changing the component

The Codex experiment uses the native Codex adapter (`agent: 'codex'`) rather
than the Vercel AI Gateway adapter, so it requires `OPENAI_API_KEY`.

### View Results

Launch the web-based results viewer:

```bash
npx @vercel/agent-eval playground
```

Open [http://localhost:3000](http://localhost:3000) to browse results.
