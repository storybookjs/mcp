# review-changes eval

Exercise an agent end-to-end against a real UI change and capture the
`ReviewState` it produces — the JSON payload that Storybook's
`display-review` MCP tool consumes.

The agent edits code in a target repo, calls `get-changed-stories`, and
pushes `display-review` against a live Storybook MCP server. We
capture the transcript, the payload, and the diff it made, then revert.
Every run is non-deterministic — the agent writes the change itself — so
a capture is a sample of the *whole loop* under real tools.

## Commands

| Command | What it does |
|---|---|
| `pnpm link-addon-mcp` | Wire `addon-mcp` + the Storybook monorepo into a target repo. One-time setup. |
| `pnpm capture` | Run the agent end-to-end against live MCP. The hot path. |
| `pnpm replay-capture` | Re-apply a past capture's diff so you can browse it in Storybook. |

## Prerequisites

You need a target repo (any repo with Storybook 10.4+) reachable at a
local URL. The eval can drive **any** target — `pnpm capture` just
needs a `--cwd` with a Storybook serving `/mcp`.

### From a clean clone

Three repos cooperate:

- **`<mcp>`** — this repo. Holds `addon-mcp`, `addon-mcp`'s sibling
  `@storybook/mcp`, and this eval harness. pnpm, Node 24.
- **`<storybook>`** — the Storybook monorepo (`storybookjs/storybook`),
  in particular `code/core` (the Storybook 10.4+ change-detection
  baseline) and `code/addons/review` (the UI that consumes
  the agent's `display-review` payload). yarn Berry, Node 22.
- **`<target>`** — any repo with Storybook. We'll use mealdrop as the
  worked example.

```bash
# 1. Clone both source repos
git clone https://github.com/storybookjs/mcp.git           # <mcp>
git clone https://github.com/storybookjs/storybook.git     # <storybook>

# 2. Build addon-mcp in <mcp> (re-run after any addon-mcp source change)
cd <mcp>
pnpm install
pnpm --filter @storybook/addon-mcp build

# 3. Build the Storybook monorepo so its dist/ are populated
cd <storybook>/code
yarn install
yarn task --task compile --start-from=auto --no-link        # builds all packages

# 4. Link both into the target. --storybook-repo also mirrors
#    storybook v10.4+ into <target>/node_modules without bumping
#    the target's own deps.
cd <mcp>/eval
pnpm link-addon-mcp \
  --target <target> \
  --storybook-repo <storybook>
```

Step 4 prints a status checklist of what's still missing from the
target's `.storybook/main.{ts,js}`:

```
Storybook config status (<target>/.storybook/main.ts):
  You must add and register:
    ✓ @storybook/addon-mcp (done)             ← installed by step 4
    ✓ features.changeDetection (done)         ← edit main.ts if ✗
    ✗ @storybook/addon-review (not done)  ← see step 5
```

```bash
# 5. Install + register addon-review — it lives in the
#    Storybook monorepo and is what renders /review/.
cd <storybook>/code/addons/review
yarn pack -o /tmp/addon-mcp-pack/review.tgz

cd <target>
<your-pm> add --dev @storybook/addon-review@/tmp/addon-mcp-pack/review.tgz

# Then re-run the linker so the new package is also mirrored to
# <storybook>/code/addons/review:
cd <mcp>/eval
pnpm link-addon-mcp --target <target> --storybook-repo <storybook>
```

```ts
// 6. Edit <target>/.storybook/main.ts — add the two addons and
//    the changeDetection feature flag:
addons: [
  // ...existing...,
  '@storybook/addon-mcp',
  '@storybook/addon-review',
],
features: {
  changeDetection: true,
},
```

The capture CLI spawns its own Storybook on the port from
`--storybook-url` (default `6010`) using `npx storybook dev --port
<port> --no-open`, so you don't need to start one yourself.

Auth is whatever Claude Code already has on this machine (`claude
login` or `ANTHROPIC_API_KEY` in your shell). The runner subprocesses
the `claude` CLI directly.

### Re-running after source edits

The `--sync=copy` default (safe with a linked Storybook) means
addon-mcp source changes don't flow through automatically. Re-run
the linker after edits:

```bash
cd <mcp>
pnpm --filter @storybook/addon-mcp build
pnpm --filter @storybook/mcp-eval-root link-addon-mcp \
  --target <target> --storybook-repo <storybook>
```

The `--storybook-repo` mirror is symlink-based, so edits to
`<storybook>/code/**/dist` after a `yarn nx compile <pkg>` flow
through to the target without re-running the linker.

## Two-minute loop

Hand the agent a task; it edits the target, calls `get-changed-stories`,
pushes `display-review`. We capture the transcript + payload + the
actual diff it made, then revert.

```bash
cd /Users/yannbraga/open-source/mcp/eval

pnpm capture \
  --cwd /path/to/target \
  --storybook-url http://localhost:6010 \
  --task "<a natural-language task>" \
  --scenario <slug> \
  --model claude-sonnet-4.6 \
  --verbose
```

All commands always print the **absolute paths** of every file they
read and write so you can jump straight to the source repo or run
record on disk. Add `-v` / `--verbose` for step-by-step streaming.

## What each command does

### `pnpm capture` (E2E live MCP)

Spawns `claude --mcp-config <…>` against a running Storybook with
`@storybook/addon-mcp`, hands the agent your `--task`, and lets it edit
the target repo + call `get-changed-stories` + `display-review` for
real. We capture:

- the full stream-json **transcript** (assistant turns + every
  `tool_use`/`tool_result`)
- the **payload** the agent pushed to `display-review` (pulled out
  of the matching `tool_use` block)
- the actual **diff** git observed after the run, before the reset
- token usage + cost from the final `result` event

**Hard precondition: the target repo must be clean before the run.**
Captures refuse to start if `git status --porcelain` shows anything
modified, staged, or untracked. This guarantees the captured `git
diff HEAD` after the agent is unambiguously the agent's change — no
stash, no mixing with your in-flight work, no merge conflicts on
cleanup. The runner aborts with a multi-line message listing every
dirty path and the resolutions (commit, `git checkout + clean`, or
`--force`) before any Storybook is spawned, so a dirty repo costs
nothing.

Pass **`--force`** to reset a dirty target to pristine
(`git checkout -- . && git clean -fd`) and run anyway. It is
**destructive** — it discards every uncommitted change in the target,
including untracked files — so the CLI prints exactly what it's about
to discard first. Use it when the target's dirty state is throwaway
(e.g. a previous run's leftovers); commit or stash instead when it
isn't.

Required: `--cwd`, `--task`, `--scenario`. Optional: `--storybook-url`
(default `http://localhost:6010`), `--model`, `--timeout` (default
**25 min**), `--storybook-cmd`, `--install-cmd`, `--skip-install`,
`--force`, `--keep-changes`, `--verbose`.

`pnpm capture` also writes a permanent git tag `eval-base/<slug>/<ts>`
in the target, pinning the base commit so `pnpm replay-capture` can
always reproduce the exact state the agent saw — even after you rebase
or amend in the target.

> **The target is made pristine before every capture.** The teardown
> only restores *tracked* files, so a previous run that had the agent
> add or remove a dependency leaves `node_modules` out of sync with the
> restored lockfile. Storybook/Vite caches under `node_modules/.cache`
> and `node_modules/.vite` are the same hazard. So before each run the
> capture wipes those caches and runs the package manager's install
> (auto-detected from the lockfile: `yarn install --immutable`,
> `npm ci`, …) to reconcile `node_modules` with the committed lockfile.
> Override the command with `--install-cmd "<cmd>"`; skip the reconcile
> entirely (caches still cleared) with `--skip-install`. Note: if
> you've linked `addon-mcp` into the target by copying files over the
> installed package, the reconcile can revert that — re-run
> `pnpm link-addon-mcp` if the MCP preflight then fails.

> **Teardown — default is CLEAN, `--keep-changes` leaves everything
> in place.** Because the target was clean before the run, teardown
> doesn't have to play any stash or re-apply games. Two modes:
>
> - **Default** (no flag): `git checkout -- . && git clean -fd` to
>   revert the agent's edits + **kill the spawned Storybook**. Your
>   target repo ends exactly as it started, no process leaks. To
>   browse the captured feature later, use `pnpm replay-capture
>   --scenario <slug>` which re-applies the diff.
> - **`--keep-changes`**: do nothing. The agent's edits stay in the
>   target's working tree; Storybook keeps running so you can browse
>   the feature live at `<storybook-url>`. The CLI prints the cleanup
>   commands at the end. Use this when you want to inspect the feature
>   immediately in the same shell as the capture.

> **Storybook is always restarted before each capture.** Long-running
> Storybook dev servers accumulate Vite/HMR state across capture
> cycles — eventually the story-index endpoint starts returning HTTP
> 500 even on trivial single-file edits, and you get garbage
> cascades. To prevent this, the capture CLI kills whatever's on
> `--storybook-url`'s port and spawns a fresh Storybook before every
> run. The addon-mcp in-memory review-state store also resets for free
> (it lives in the Storybook process). There is no opt-out.
>
> Default spawn command: `npx storybook dev --port <port> --no-open`.
> Pass `--storybook-cmd "your-cmd"` to override.
>
> Cost: ~10-30s per capture for the cold start. The fresh process is
> detached and its stdout/stderr lands at
> `<out>/<ts>--<model>.storybook.log` for post-mortem.

> **Timeouts and partial captures.** Real refactors take time. The
> wall-clock cap defaults to 25 minutes; pass `--timeout <ms>` for
> longer (or shorter) tasks. **If the cap fires, the run still
> captures whatever the agent already did**: the transcript so far,
> the diff git observed on disk, the tool calls made, and the
> `display-review` payload if the agent had pushed one before the
> kill. The record is written with `error: "claude subprocess
> exceeded …ms"`.

### Two trust signals to read in the headline output

A `✓ Capture complete` banner doesn't mean the payload is correct.
The CLI also prints two signals you should glance at:

1. **Tool errors.** If any `tool_use` came back with `is_error: true`
   (e.g. `mcp__storybook__get-changed-stories` returning HTTP 500
   because the agent's edits destabilised Storybook's dev server),
   the CLI lists them under a `⚠ N tool calls returned an error`
   banner. The agent **often keeps going** and fabricates a payload
   from its own memory in this case — so when `get-changed-stories`
   errored, treat the `storyIds` as inferred-without-cascade.

2. **`changedFiles` delta.** The CLI compares `payload.changedFiles`
   (what the agent reported) against `agentChangedFiles` (what
   `git diff HEAD` actually observed) and prints both counts + the
   Jaccard accuracy + the missing files. Anything below 100% means
   the agent under- or over-reported the scope of its own change.

Both signals are also persisted on the `RunRecord` — `toolErrors` and
`agentChangedFiles` — so a meta-analysis agent can detect them
programmatically.

> **Heads up on `--storybook-url`.** Storybook's own default port is
> `6006`. The eval defaults to `6010` to avoid clashing with the eval
> repo's own Storybook on `6007`. **Whatever port you booted Storybook
> on is the one you must pass.** If you get the URL wrong, the
> preflight catches it before any cost is incurred.

Before spawning `claude`, the runner POSTs `tools/list` against
`<storybook-url>/mcp` and confirms both `get-changed-stories` and
`display-review` are present. If the URL is unreachable, returns
HTTP errors, isn't speaking MCP, or exposes the wrong tool set, the
run aborts in <0.1s with a labelled failure stage (`unreachable` /
`http-error` / `parse-error` / `missing-tools`). Nothing is mutated,
no claude spawn, no cost.

Captures live under `review-changes/captures/<slug>/`:

- `<ts>--<model>.json` — RunRecord (transcript, payload, diff, cost,
  `status`, and the snapshotted `storyIndex` + `cascade`)
- `<ts>--<model>.payload.json` — just the `ReviewState`
- `<ts>--<model>.agent.diff` — unified diff of what the agent changed
- `<ts>--<model>.live.log` — tail-friendly per-event log (see below)
- `<ts>--<model>.storybook.log` — the spawned Storybook's output
- `latest.payload.json` — copy of the most recent run's `ReviewState`,
  a stable path to hand to a downstream UI consumer

The whole `captures/` tree is gitignored — captures are per-developer,
non-deterministic artifacts. After the agent runs, the capture
snapshots the live story index from `<storybook-url>/index.json` and
computes the cascade of the agent's changed files. That cascade is real
depth ground truth, so the cascade-derived graders (schema validity,
collection purity, `kind` correctness, `changedFiles` Jaccard) all run
on captures.

### `pnpm replay-capture`

Re-apply a past capture's diff into the target repo so you can open
Storybook and **see exactly what the agent saw** when it pushed
`display-review`. The captured `.agent.diff` includes
modifications, newly-created files, and deletions.

```bash
# Apply the latest capture for a scenario:
pnpm replay-capture --scenario <slug>

# …and run the agent to push a FRESH review to /review/:
pnpm replay-capture --scenario <slug> --review

# Apply a specific run record:
pnpm replay-capture --run review-changes/captures/<slug>/<ts>--<model>.json

# Revert — drop the patch, return to the branch you were on:
pnpm replay-capture --scenario <slug> --revert
```

`--scenario <slug>` is the capture directory name under
`review-changes/captures/`; it uses that capture's most recent run.

**It does not matter where the target's `HEAD` is.** The captured
`agentDiff` is an ordinary unified diff — `git apply` patches file
*contents*, not a commit position. The capture's base is resolved from
`source.baseTag` (a permanent git tag `pnpm capture` writes) or the raw
`source.baseCommit`; replay checks out a throwaway
`review-replay/<scenario>` branch at that base and applies the patch
there. If the base commit is gone entirely, replay falls back to
`git apply --3way` onto the current `HEAD` and warns that exact
fidelity isn't guaranteed.

`--revert` switches back to the branch you started on and deletes the
replay branch.

**`--review`** is the optional second half. By default `replay-capture`
only re-applies the diff — it never spawns the agent or touches MCP.
Pass `--review` and, with the diff applied, it runs the agent against
the target's **live Storybook MCP** to do the *review step only* (it
cannot edit code — `Write`/`Edit` are disallowed): the agent inspects
the applied diff, calls `get-changed-stories`, and pushes a **fresh**
`display-review`. This needs Storybook already running on the
target; replay-capture preflights `/mcp` first and fails fast if it
isn't. `--model <id>` picks the review model.

Safety:

- **Refuses to apply** if the target working tree is dirty (pass
  `--force` to override).
- `git apply --check` runs first; on failure it retries with `--3way`
  before giving up.
- The CLI never starts or stops Storybook — your dev server stays
  yours.

## Following along while a run is in flight

`pnpm capture` writes a per-run `<ts>--<model>.live.log` next to the
run record as the agent runs. It's a human-readable stream of every
Claude Code event — `system`, `thinking`, `assistant` text, `tool_use`
(with truncated args), `tool_result` (with truncated content), and the
final `result` line with cost + tokens + duration. Each line is
timestamped.

The CLI prints the absolute path before spawning the agent so you can
open a second shell and follow along:

```bash
# In shell A:
pnpm capture --cwd … --task "…" --scenario <slug> --verbose

# In shell B (path comes from shell A's "Live agent log" line):
tail -f review-changes/captures/<slug>/<ts>--<model>.live.log
```

The live log is best-effort and tail-friendly — for the canonical
machine-readable transcript (with full `tool_use` inputs and
`tool_result` outputs), see `transcript` on the final run record.

## Inspecting results

The capture loop is meant to be inspected two ways:

1. **The logs** — the headline output + the `.live.log` show what the
   agent did, the tools it called, the two trust signals, and the cost.
2. **The live target Storybook** — run `pnpm capture` with
   `--keep-changes` (or `pnpm replay-capture --scenario <slug>`) and
   open `<storybook-url>/?path=/review/` to see the review the
   agent actually pushed, rendered in the real product surface.

Eyeball one run on disk:

```bash
# The payload (what would have been pushed to the UI):
jq . review-changes/captures/<slug>/latest.payload.json

# Scores + cost:
jq '{scores, latencyMs, inputTokens, outputTokens, costUsd, status, error}' \
   review-changes/captures/<slug>/<ts>--<model>.json

# The transcript:
jq '.transcript' review-changes/captures/<slug>/<ts>--<model>.json | less
```

Run records carry `status` (`ok` / `agent-error` / `infra-error` /
`timeout`) so you can separate genuine agent misses from harness
flakes.

## `RunRecord` fields

```ts
{
  scenarioId, model, agent,
  driver: 'live-mcp',
  status?: 'ok' | 'agent-error' | 'infra-error' | 'timeout',
  prompt: '<full prompt text>',
  promptVersion: 'sha-<first 8 of SHA-256(prompt)>',
  task: '<task prompt>',
  startedAt, finishedAt, latencyMs,
  inputTokens, outputTokens, costUsd,
  pushedReviewState: ReviewState | undefined,
  scores: {
    schemaValid, kindCorrectness, collectionPurity,
    changedFilesAccuracy, diffHunksProvided, descriptionLength,
    collectionCount, pushedStoryCount,
  },
  rawText: '<model output>',
  transcript: [ ... stream-json events ... ],
  agentDiff: '<unified diff>',          // what git observed (ground truth)
  agentChangedFiles: ['…'],
  storyIndex: { entries: {...} },       // snapshot taken after the run
  changedStories: [...],                // cascade-derived
  cascade: [{ storyId, depth }],        // depth ground truth
  source: { repoPath, baseCommit, baseTag?, workingTreeDirty, storybookUrl? },
  error?: '...',
}
```

`storyIndex` / `cascade` are snapshotted from the live Storybook
*after* a capture so the cascade-derived graders have real depth
ground truth. `agentDiff` is what git observed (the ground truth);
compare with `pushedReviewState.diffHunks` to see whether the agent
reported its own change accurately.

## Layout

```
review-changes/
  README.md              ← you are here
  cli/
    link-addon-mcp.ts    ← pnpm link-addon-mcp  (wire addon + storybook monorepo into a target)
    capture.ts           ← pnpm capture         (run agent end-to-end against live MCP)
    replay-capture.ts    ← pnpm replay-capture  (re-apply a capture's diff to browse it)
  lib/                   ← schemas, graders, cascade, live-mcp runner, storybook lifecycle
  captures/<slug>/       ← gitignored: E2E live-MCP captures (per-developer)
```

Every CLI also accepts `-v` / `--verbose` for step-by-step streaming.
Without it, each command still prints the absolute paths of what it
read and wrote.
