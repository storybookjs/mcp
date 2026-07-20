# Agentic Reference (SB-1724)

An A/B eval that measures whether a Storybook MCP of a Base UI design-system
Storybook actually helps coding agents build and change UI, compared to
having no docs, official docs, or a community MCP instead. Agents perform 5
UI workflows against a benchmark app — Mealdrop reimplemented with Base UI —
under each of 4 context cases, and results are compared across cases.

This file scaffolds the project structure (evals, experiments, case setup,
parameterisation) so the pieces exist and typecheck before the real prompts,
benchmark app, and MCP endpoint are ready. Everything here is additive to the
existing `agent-eval/` harness — see "Constraints" below — and is gated off
by default, so it never runs as part of `pnpm eval` or CI.

## Case matrix

| Case                      | Label                                                  | Linear                                               |
| ------------------------- | ------------------------------------------------------ | ---------------------------------------------------- |
| `control-empty`           | No docs, no MCP, code only                             | [SB-1726](https://linear.app/chromaui/issue/SB-1726) |
| `control-official-docs`   | Curated base-ui.com docs available, no MCP             | [SB-1726](https://linear.app/chromaui/issue/SB-1726) |
| `control-community-mcp`   | A community Base UI MCP/skill, to be identified        | [SB-1682](https://linear.app/chromaui/issue/SB-1682) |
| `treatment-storybook-mcp` | The Storybook MCP of a Base UI design-system Storybook | [SB-1725](https://linear.app/chromaui/issue/SB-1725) |

Each case is a `setup(sandbox)` in `lib/agentic-reference/cases.ts`; each has
its own experiment file (`experiments/ar-<case>-cc-opus-high.ts`) that pins
agent claude-code / model Opus / effort high and runs all 5 workflow evals
against it.

## Workflows

Each case runs the same 5 evals, under the `7xx-ar-*` band:

| Eval                   | Workflow                                 |
| ---------------------- | ---------------------------------------- |
| `700-ar-create-ui`     | Generate new UI in the existing app      |
| `701-ar-rework-ui`     | Rework existing UI / add a feature       |
| `702-ar-fix-bug`       | Fix a UI bug                             |
| `703-ar-fix-a11y`      | Fix an accessibility issue               |
| `704-ar-migrate-to-ds` | Migrate the app to use the design system |

Tracked by [SB-1724](https://linear.app/chromaui/issue/SB-1724) (this
scaffold) and [SB-1689](https://linear.app/chromaui/issue/SB-1689) (authoring
the real prompts).

## How to run

Commands below assume you are in `agent-eval/`; from the repo root prefix
with `pnpm --dir agent-eval`.

Preview what would run, no API calls, no cost:

```bash
EVAL_AGENTIC_REFERENCE=1 pnpm eval:dry
# or, equivalently:
pnpm eval:ar:dry
```

Run a single experiment (costs money — uses `ANTHROPIC_API_KEY`):

```bash
EVAL_AGENTIC_REFERENCE=1 pnpm exec agent-eval ar-control-empty-cc-opus-high
```

Run everything for real (all 4 cases × 5 evals × `AR_RUNS` repetitions):

```bash
AR_RUNS=10 pnpm eval:ar
```

`pnpm eval` / `pnpm eval:dry` (no gate env) are untouched: the `ar-*`
experiments contribute zero evals to those, exactly like the existing
`EVAL_EXTRA_MODELS`-gated `cc-mcp-sonnet-medium` / `cc-plugin-sonnet-medium`
experiments in `lib/experiment.ts`.

`control-community-mcp` needs a second flag, `AR_COMMUNITY_MCP=1`, on top of
`EVAL_AGENTIC_REFERENCE=1` — its setup always throws until SB-1682 identifies
a community MCP, so it lists zero evals either way until both are set.

## Parameters (env vars)

| Var                      | Default                      | Meaning                                                                           |
| ------------------------ | ---------------------------- | --------------------------------------------------------------------------------- |
| `EVAL_AGENTIC_REFERENCE` | unset (off)                  | Master gate — the `ar-*` experiments export evals only when `=1`.                 |
| `AR_COMMUNITY_MCP`       | unset (off)                  | Second gate for `control-community-mcp`, required in addition to the master gate. |
| `AR_RUNS`                | `1`                          | Repetitions per eval. Real runs use `10`.                                         |
| `AR_BENCHMARK_REPO`      | `yannbf/mealdrop`            | GitHub repo hosting the benchmark app.                                            |
| `AR_BENCHMARK_REF`       | `agentic-reference/baseline` | Git ref of the benchmark app to check out (branch doesn't exist yet — see Stubs). |
| `AR_DS_PACKAGE`          | `` (empty)                   | pkg.pr.new spec for the Base UI design-system package.                            |
| `AR_STORYBOOK_MCP_URL`   | `http://127.0.0.1:6006/mcp`  | URL the `treatment-storybook-mcp` case wires into the sandbox's `.mcp.json`.      |

All defaults live in `lib/agentic-reference/config.ts`.

## What's stubbed

This scaffold ships plausible placeholders so the structure is complete and
typechecks; each stub is owned by a follow-up issue:

| Stub                                                           | Where                                                        | Issue                                                                                                       |
| -------------------------------------------------------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| Workflow prompts (`PROMPT.md`)                                 | `evals/70x-ar-*/PROMPT.md`                                   | [SB-1689](https://linear.app/chromaui/issue/SB-1689)                                                        |
| Benchmark app (Mealdrop-on-Base-UI branches)                   | `lib/agentic-reference/benchmark-app.ts`                     | [SB-1680](https://linear.app/chromaui/issue/SB-1680) / [SB-1681](https://linear.app/chromaui/issue/SB-1681) |
| Community Base UI MCP/skill                                    | `lib/agentic-reference/cases.ts` (`control-community-mcp`)   | [SB-1682](https://linear.app/chromaui/issue/SB-1682)                                                        |
| Treatment MCP endpoint (published DS Storybook)                | `lib/agentic-reference/cases.ts` (`treatment-storybook-mcp`) | [SB-1725](https://linear.app/chromaui/issue/SB-1725)                                                        |
| Storybook server orchestration for the treatment case          | same                                                         | [SB-1685](https://linear.app/chromaui/issue/SB-1685)                                                        |
| Run traceability                                               | `evals/70x-ar-*/EVAL.ts` TODOs                               | [SB-1683](https://linear.app/chromaui/issue/SB-1683)                                                        |
| Quantitative metrics (SLoC, complexity, DS coverage, axe-core) | `evals/70x-ar-*/EVAL.ts` TODOs                               | [SB-1686](https://linear.app/chromaui/issue/SB-1686)                                                        |

Until the benchmark app exists, the 5 evals use the existing `vite-app`
template (a generic React + Vite app with no Storybook) as a placeholder
fixture, and `EVAL.ts` assertions stay deliberately case-agnostic and
low-threshold — a smoke check that the agent made a plausible attempt at the
task, not a real quality rubric. Swap the template reference and tighten the
assertions once the real benchmark app and prompts land.

## Constraints

This project was scaffolded additive-only: it only creates new files, plus
one line added to `agent-eval/package.json` for the `eval:ar`/`eval:ar:dry`
scripts. `lib/experiment.ts`, existing experiments/evals/templates,
`packages/`, and CI workflows are untouched. The 4 `ar-*` experiments pin
agent/model/effort explicitly (claude-code / Opus / high) rather than reading
CLI defaults, so their behavior stays fixed even if the `agent-eval` CLI's
defaults change later — the same version-freeze idiom the existing
`cc-mcp-opus-high` experiment already uses.
