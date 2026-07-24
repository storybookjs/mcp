# Agentic reference eval — minimal educational example

A tiny, standalone slice of the "agentic reference" eval idea (the fuller
version lives on `yann/sb-1724-agentic-reference-scaffold`): one eval, one
agent configuration, one deterministic check. It exists to show the shape —
materialize a real app into a sandbox, give an agent one small task, assert
one thing about the result — not to be a rigorous workflow rubric.

## Files

- **`evals/700-ar-hello/package.json`** — fixture manifest. The
  `evals.benchmarkApp` marker (`{ repo: 'yannbf/mealdrop', ref:
  'base-ui-migration-squashed' }`) tells the experiment's `setup()` which
  app to materialize. That branch already has the design system installed
  (`@base-ui/react` + `@droppy/theme` pinned in its own `package.json`, and
  app wrapper components like `src/components/Button` already written) —
  simpler than the full scaffold, which installs the design system as a
  separate canary step.
- **`evals/700-ar-hello/PROMPT.md`** — the task: add an "Order help" button
  to the footer using the app's own `Button` wrapper component.
- **`evals/700-ar-hello/EVAL.ts`** — two checks, no LLM judge: the agent
  produced a transcript, and `src/components/Footer/Footer.tsx` ends up
  importing from `src/components/Button`. Purely deterministic (file read +
  regex), so it costs nothing beyond the agent run itself.
- **`experiments/ar-hello-cc-opus-high.ts`** — one experiment: Claude Code,
  opus, high effort, scoped to only `700-ar-hello`. `setup()` downloads the
  benchmark app's GitHub codeload tarball and extracts it into the sandbox,
  then runs `yarn install` — no design-system canary install step needed
  (see above). Self-contained: it does not import any
  `lib/agentic-reference/*` case registry or config module.

## Running it

All commands run from `agent-eval/` (from the repo root, prefix with `pnpm --dir agent-eval`).

**Dry run** (free — confirms exactly one eval is scoped in):

```bash
EVAL_AGENTIC_REFERENCE=1 pnpm exec agent-eval ar-hello-cc-opus-high --dry
```

**Real run** (costs money — see below):

```bash
EVAL_AGENTIC_REFERENCE=1 pnpm exec agent-eval ar-hello-cc-opus-high
```

## Safety rules (verbatim from the scaffold's RUNNING.md)

- **Never run the full matrix** (a bare `pnpm eval`, or any invocation
  without scoping to a single experiment).
- **Always run one experiment by name and scope it to one eval** — the
  invocations above already do this (`ar-hello-cc-opus-high` is the only
  experiment this file adds, and it only ever contains the single
  `700-ar-hello` eval).

## Cost and credentials

A real run costs roughly **$0.30–$1** in agent tokens (opus-high, plus a
real `yarn install` in the sandbox). Real runs need, by name only:

- `ANTHROPIC_API_KEY` — the claude-code agent runs against the direct
  Anthropic API.
- Sandbox credentials — one of: a Vercel access token
  (`VERCEL_PROJECT_ID` + `VERCEL_TEAM_ID` + `VERCEL_TOKEN`), Vercel OIDC
  (`vercel link` + `vercel env pull`), or a running local Docker daemon
  (the suite falls back to Docker when no Vercel credentials are set).

Dry runs need none of the above — no API calls, no sandbox.
