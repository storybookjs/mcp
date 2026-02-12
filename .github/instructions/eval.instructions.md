````instructions
---
applyTo: 'eval/**'
---

# Copilot Instructions for Storybook MCP Eval Harness

## Project Overview

This is an eval harness for testing AI coding agents' ability to build UI components using Storybook and MCP tools. The harness automates the process of running trials, executing agents with prompts, and grading the results through multiple quality metrics.

**Core Purpose**: Measure how effectively AI agents can use Storybook's MCP tools to build production-quality UI components.

## Architecture

### Harness Flow

1. **Prepare**: Create fresh Vite + React + Storybook project from template
2. **Execute**: Run AI agent (Claude Code CLI) with prompt and optional context
3. **Grade**: Run automated checks (build, typecheck, lint, tests, a11y)
4. **Report**: Generate metrics, save results, optionally upload to Google Sheets

### Key Components

- **CLI Interface**: Two modes:
  - `eval.ts` - Batch eval runner for running multiple trials across variants
  - `advanced-eval.ts` - Single trial runner with interactive CLI
- **Context System**: Five context modes (none, Storybook MCP - Dev, Storybook MCP - Docs, custom MCP server, extra prompts)
- **Agent Abstraction**: Pluggable agent implementations (currently Claude Code CLI)
- **Grading Pipeline**: Parallel execution of multiple quality checks
- **Hooks System**: Lifecycle hooks for custom trial logic
- **Telemetry**: Optional results upload to Google Sheets for tracking

### File Structure

```
eval/
├── eval.ts                          # Batch eval runner (multiple trials)
├── advanced-eval.ts                 # Single trial runner (interactive)
├── types.ts                         # Core types and schemas
├── lib/
│   ├── collect-args.ts              # Interactive CLI argument collection (for advanced-eval)
│   ├── show-help.ts                 # Help text formatting
│   ├── generate-prompt.ts           # Combines prompt parts
│   ├── prepare-trial.ts             # Project template setup
│   ├── teardown-trial.ts            # Trial cleanup (stop dev servers, etc.)
│   ├── storybook-dev-server.ts      # Storybook dev server management
│   ├── agents/
│   │   └── claude-code-cli.ts       # Claude Code CLI agent implementation
│   ├── eval/                        # Batch eval runner logic
│   │   ├── collect-eval-args.ts     # Collect args for batch eval
│   │   ├── run-eval.ts              # Main eval orchestration
│   │   ├── types.ts                 # Eval-specific types
│   │   └── progress-ui.ts           # Progress display
│   └── graders/
│       ├── grade.ts                 # Main grading orchestrator
│       ├── prepare-grading.ts       # Install test dependencies
│       ├── build.ts                 # Vite build check
│       ├── typecheck.ts             # TypeScript checking
│       ├── lint.ts                  # ESLint execution
│       ├── test-stories.ts          # Vitest + a11y testing
│       ├── environment.ts           # Git branch/commit tracking
│       └── save-to-sheets.ts        # Google Sheets upload
├── variant-configs/                 # Variant configs (variants, context combinations)
├── tasks/                           # Task definitions
│   └── {number}-{name}/
│       ├── prompt.md                # Main prompt
│       ├── hooks.ts                 # Optional lifecycle hooks
│       ├── manifests/               # Optional manifest files directory
│       │   ├── components.json      # Component manifest for @storybook/mcp
│       │   └── docs.json            # Optional docs manifest for @storybook/mcp
│       ├── mcp.config.json          # Optional MCP server config
│       ├── *.md                     # Optional additional context
│       ├── pre-grade/               # Optional files to copy before grading
│       ├── {hook-name}/             # Optional hook directories (see Lifecycle Hooks)
│       └── trials/                  # Generated trial runs
└── templates/
    ├── project/                     # Base Vite + React template
    └── grading/                     # Test/lint configs
```

### Context Modes

The harness supports five distinct context types:

1. **No Context** (`--no-context`):
   - Agent uses only built-in tools
   - Tests baseline agent capabilities

2. **Storybook MCP - Dev** (`--context storybook-dev`):
   - Sets up Storybook in the trial project with `@storybook/addon-mcp`
   - Starts a local Storybook dev server
   - Configures the MCP server endpoint (`/mcp`) for the agent
   - Best for testing agents in a live development environment
   - Includes automatic setup and teardown of the dev server

3. **Storybook MCP - Docs** (`--context components.json`):
   - Provides component documentation via `@storybook/mcp` package
   - Uses stdio transport with `packages/mcp/bin.ts`
   - Best for testing agents with library/component documentation
   - This uses the Storybook MCP server, not a custom MCP server

4. **MCP Server** (`--context mcp.config.json` or inline JSON):
   - Custom MCP server configuration (HTTP or stdio)
   - Supports multiple named servers
   - Flexible for testing different MCP tool combinations
   - Use this for fully custom MCP servers; use components.json for Storybook MCP - Docs

5. **Extra Prompts** (`--context extra-prompt-01.md,extra-prompt-02.md`):
   - Appends additional markdown files to main prompt
   - Useful for providing supplementary instructions
   - Keeps main prompt clean while testing variations

## Development Workflow

### Prerequisites

- Node.js 24+ (see root `.nvmrc`)
- pnpm 10.19.0+ (monorepo root enforces this)
- Claude Code CLI: `npm install -g claude-code`

### Running Evaluations

**Batch eval mode (recommended for comparison testing):**
```bash
cd eval
node eval.ts
```

**Single trial mode (interactive):**
```bash
cd eval
node advanced-eval.ts
```

**Non-interactive single trial:**
```bash
node advanced-eval.ts --agent claude-code --context components.json --upload-id batch-1 --no-storybook 100-flight-booking-plain

# With Storybook MCP - Dev context (starts local dev server)
node advanced-eval.ts --agent claude-code --context storybook-dev --no-storybook 200-build-ui-with-storybook
```

**IMPORTANT**: Always use the `--no-storybook` flag when running tasks to prevent the process from hanging at the end waiting for user input about starting Storybook.

**Get help:**
```bash
node advanced-eval.ts --help
```

### Creating a New Task

1. **Create directory:**
   ```bash
   mkdir tasks/200-my-component
   ```

2. **Write `prompt.md`:**
   ```markdown
   Build a SearchBar component with autocomplete...

   <technical_requirements>
   1. Component MUST be default export in src/components/SearchBar.tsx
   2. Component MUST have data-testid="search-bar"
   </technical_requirements>
   ```

3. **Optional: Add context files:**
   - `manifests/components.json` - Component manifest for `@storybook/mcp` (in a `manifests/` subdirectory)
   - `manifests/docs.json` - Optional docs manifest for `@storybook/mcp` (in a `manifests/` subdirectory)
   - `mcp.config.json` - Custom MCP server configuration
   - `extra-prompt-*.md` - Supplementary instructions

4. **Optional: Create `hooks.ts`:**
   ```typescript
   import type { Hooks } from '../../types.ts';

   export default {
     async postPrepareTrial(args, log) {
       // Custom setup (e.g., copy fixture data)
       await fs.cp(
         path.join(args.taskPath, 'fixtures'),
         path.join(args.projectPath, 'public/fixtures'),
         { recursive: true }
       );
     }
   } satisfies Hooks;
   ```

5. **Optional: Create hook directories:**
   - Create directories named after lifecycle hooks in kebab-case
   - Files in these directories are copied to `projectPath` at that lifecycle point
   - Example: `pre-grade/stories/MyComponent.stories.ts` copies test stories before grading
   - See [Lifecycle Hooks](#lifecycle-hooks) for the full list of supported directories

### Viewing Results

**View transcript:** Open `results/transcript.json` to see agent activity.

**Inspect generated project:**
```bash
cd tasks/{task-name}/trials/{trial-name}/project
pnpm storybook
```

## Code Style and Conventions

### TypeScript Configuration

- Uses `@tsconfig/node24` as base
- Module system: ESM with `"type": "module"`
- Module resolution: `bundler`
- Strict mode enabled

### Code Style

- **Always include file extensions in imports**: `import { foo } from './bar.ts'`
- Use Valibot for schema validation (see `types.ts` and `collect-args.ts`)
- Prefer async/await over callbacks
- Use `taskLog` (verbose) or `spinner` (normal) for user feedback
- Export types explicitly

### Naming Conventions

- Constants: SCREAMING_SNAKE_CASE (rare in this codebase)
- Functions: camelCase (e.g., `collectArgs`, `prepareTrial`)
- Types/Interfaces: PascalCase (e.g., `TrialArgs`, `Context`)

### Argument Parsing Pattern

The `collect-args.ts` module uses Commander for CLI argument parsing:

1. Load `.env` file using `loadEnvFile` from `node:process`
2. Configure Commander with options, including `.env()` for environment variable support
3. Parse async context values (may involve file loading)
4. Prompt for missing values using `@clack/prompts`
5. Build rerun command for user convenience
6. Return fully-resolved arguments

**Note:** Boolean environment variables (VERBOSE, STORYBOOK) are parsed manually via `parseBooleanEnv()` because Commander's built-in env handling coerces "false" strings to `true`.

**Example:**
```typescript
const program = new Command()
  .name('advanced-eval.ts')
  .argument('[task-name]', 'Name of the task directory')
  .addOption(
    new Option('-a, --agent <name>', 'Which coding agent to use')
      .choices(['claude-code'])
      .env('AGENT')
  )
  .addOption(
    new Option('-v, --verbose', 'Show detailed logs (env: VERBOSE)')
  );

await program.parseAsync();
const opts = program.opts();

const result = await p.group({
  agent: async () => {
    if (opts.agent) return opts.agent;
    return await p.select({ message: '...', options: [...] });
  }
});
```

## Important Files

### Core Harness

- `eval.ts` - Batch eval runner for comparing variants
- `advanced-eval.ts` - Single trial runner with interactive CLI
- `types.ts` - All TypeScript types and Valibot schemas
- `lib/collect-args.ts` - CLI argument parsing and validation (for advanced-eval)
- `lib/eval/collect-eval-args.ts` - CLI argument parsing (for eval)
- `lib/eval/run-eval.ts` - Main batch eval orchestration
- `lib/show-help.ts` - Help text formatting
- `lib/generate-prompt.ts` - Combines prompt parts with constraints
- `lib/prepare-trial.ts` - Project template setup

### Agent Integration

- `lib/agents/claude-code-cli.ts` - Claude Code CLI wrapper
  - Streams JSON messages from Claude
  - Parses tool calls and todo lists
  - Calculates token counts using `ai-tokenizer`
  - Tracks transcript for debugging
- `lib/agents/copilot-cli.ts` - GitHub Copilot CLI wrapper
  - Runs `copilot -p "<prompt>" --allow-all-tools` from `projectPath`
  - Captures plain stdout/stderr (no structured tool events)
  - Writes `transcript.json` with minimal metadata (no token/cost)
  - Requires global CLI install/auth (`npm i -g @github/copilot`, `copilot login`)

### Grading Pipeline

- `lib/graders/grade.ts` - Main orchestrator
  - Runs checks in parallel: build, typecheck, lint, test, environment
  - Creates unified logging interface (verbose vs. normal)
  - Formats results and optionally uploads
- `lib/graders/prepare-grading.ts` - Installs test dependencies
- `lib/graders/build.ts` - Vite build verification
- `lib/graders/typecheck.ts` - TypeScript compilation check
- `lib/graders/lint.ts` - ESLint execution
- `lib/graders/test-stories.ts` - Vitest + a11y testing
- `lib/graders/save-to-sheets.ts` - Google Sheets upload

### Templates

- `templates/project/` - Base Vite + React + Storybook template
  - Minimal setup with TypeScript
  - `src/main.tsx` - React root (agents modify this)
  - `vite.config.ts` - Vite configuration
- `templates/grading/` - Testing infrastructure
  - `.storybook/` - Storybook config with Vitest addon
  - `eslint.config.js` - ESLint rules
  - `vitest.config.ts` - Vitest + a11y setup

## Agent Implementation Details

### Claude Code CLI Integration

The Claude Code CLI agent (`lib/agents/claude-code-cli.ts`) implements a sophisticated integration:

**Key Features:**

1. **Auto-approval of MCP servers**: Sends "1\n" to stdin to automatically trust MCP servers
2. **Streaming JSON parsing**: Parses `--output-format=stream-json` line-by-line
3. **Token counting**: Uses `ai-tokenizer` with Claude encoding to calculate tokens per message
4. **Cost tracking**: Calculates USD cost based on Anthropic pricing
5. **Todo list tracking**: Extracts todo progress from `TodoWrite` tool calls for progress display
6. **Transcript logging**: Saves complete transcript with metadata to `transcript.json`

**Message Types:**

- `SystemInitMessage`: Session start, tools available, MCP servers
- `AssistantMessage`: Agent responses with text and/or tool calls
- `UserMessage`: Tool results from user
- `ResultMessage`: Final summary with usage stats

**Output Format:**

The agent generates `transcript.json` with all messages and metadata:

```json
{
  "prompt": "...",
  "messages": [...]
}
```

### Copilot CLI Integration

The Copilot CLI agent (`lib/agents/copilot-cli.ts`) provides a simpler, best-effort integration:

**Key Behaviors:**

1. **Programmatic mode:** Executes `copilot -p "<prompt>" --allow-all-tools` in the trial `projectPath`.
2. **Text-mode CLI output:** Captures stdout/stderr from the Copilot CLI (which currently does not expose a streaming JSON format) and parses it using regex patterns to detect tool calls (for example, lines like `✓ tool_name args`) and their outputs.
3. **Transcript logging:** Writes `transcript.json` with a synthetic init message and reconstructs a full transcript timeline, including assistant/user messages and structured `tool_use` / `tool_result` messages synthesized from the parsed CLI output. Token counts and costs are currently zeroed.
4. **No direct MCP transport:** There is no live MCP session over a structured streaming protocol; instead, tool metadata is inferred from the Copilot CLI's plain-text output rather than received as JSON.

**Requirements:**

- Global install and auth: `npm i -g @github/copilot` then `copilot login`.
- Availability: Copilot CLI must be on PATH for the agent to run; otherwise the agent will report the failure in stderr.

### Adding a New Agent

To add support for a new coding agent:

1. Create `lib/agents/my-agent.ts`
2. Implement the `Agent` interface from `types.ts`:
   ```typescript
   export const myAgent: Agent = {
     async execute(prompt, trialArgs, mcpServerConfig) {
       // 1. Setup MCP config if provided
       // 2. Execute agent with prompt
       // 3. Stream/parse output
       // 4. Save transcript log
       // 5. Return ExecutionSummary
       return { cost, duration, durationApi, turns };
     }
   };
   ```
3. Add to `agents` object in `config.ts`
4. Update Commander options in `collect-args.ts` to include new agent choice

## Grading Metrics

Each trial produces comprehensive metrics:

### Execution Metrics (from agent)

- **cost**: Total API cost in USD
- **duration**: Total execution time in seconds
- **durationApi**: API request time in seconds
- **turns**: Number of transcript turns

### Quality Metrics (from grading)

- **buildSuccess**: Boolean - can the project build?
- **typeCheckErrors**: Number of TypeScript errors
- **lintErrors**: Number of ESLint errors
- **test.passed**: Number of passing tests
- **test.failed**: Number of failing tests
- **a11y.violations**: Number of accessibility violations

### Output Files

**`summary.json`**: Complete metrics
```json
{
  "cost": 0.1234,
  "duration": 45,
  "durationApi": 38,
  "turns": 8,
  "buildSuccess": true,
  "typeCheckErrors": 0,
  "lintErrors": 0,
  "test": { "passed": 3, "failed": 0 },
  "a11y": { "violations": 1 }
}
```

**`transcript.json`**: Complete transcript log for debugging
**`test-results.json`**: Detailed Vitest results with a11y violations
**`build-output.txt`**: Vite build logs
**`typecheck-output.txt`**: TypeScript compiler output
**`lint-output.txt`**: ESLint output

## Lifecycle Hooks

Tasks can customize behavior at each lifecycle step through two mechanisms:

### Hook Directories

Create directories named after lifecycle hooks (kebab-case) to automatically copy files to `projectPath` at that step:

| Directory | When Contents Are Copied |
|-----------|-------------------------|
| `pre-prepare-trial/` | Before project template is copied |
| `post-prepare-trial/` | After dependencies are installed |
| `pre-execute-agent/` | Before agent starts execution |
| `post-execute-agent/` | After agent completes |
| `pre-grade/` | Before grading runs |
| `post-grade/` | After grading completes |
| `pre-save/` | Before results are saved |
| `post-save/` | After results are saved |

**Example:** To add test stories that run against agent-generated components:
```
tasks/200-my-component/
├── prompt.md
├── pre-grade/
│   └── stories/
│       └── MyComponent.stories.ts
```

The `pre-grade/stories/MyComponent.stories.ts` file will be copied to `project/stories/MyComponent.stories.ts` before grading runs.

Directories merge with existing content in `projectPath`, and files overwrite if they already exist.

### Hook Functions

For programmatic customization, define hooks in `hooks.ts`:

```typescript
import type { Hooks } from '../../types.ts';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export default {
  // Before project template is copied (after pre-prepare-trial/ is copied)
  prePrepareTrial: async (args, log) => {
    log.message('Custom pre-preparation');
  },

  // After dependencies are installed (after post-prepare-trial/ is copied)
  postPrepareTrial: async (args, log) => {
    // Install additional dependencies
    await addDependency('some-package', { cwd: args.projectPath, silent: true });
  },

  // Before agent starts (after pre-execute-agent/ is copied)
  preExecuteAgent: async (args, log) => {
    log.message('Starting agent');
  },

  // After agent completes (after post-execute-agent/ is copied)
  postExecuteAgent: async (args, log) => {
    log.message('Agent finished');
  },

  // Before grading runs (after pre-grade/ is copied)
  preGrade: async (args, log) => {
    log.start('Custom pre-grading');
  },

  // After grading completes (after post-grade/ is copied)
  postGrade: async (args, log) => {
    log.success('Custom post-grading');
  },

  // Before results are saved (after pre-save/ is copied)
  preSave: async (args, log) => {
    log.message('Saving results');
  },

  // After results are saved (after post-save/ is copied)
  postSave: async (args, log) => {
    log.success('All done');
  }
} satisfies Hooks;
```

**Execution Order:** For each lifecycle step, the harness first copies files from the hook directory (if it exists), then calls the hook function (if defined).

**Logger Interface:**

Both `taskLog` (verbose) and `spinner` (normal) are wrapped in a unified interface:
- `start(title)`: Start a new task
- `success(message)`: Mark task as successful
- `error(message)`: Mark task as failed
- `message(message)`: Log a message
- `complete(message)`: Complete the entire operation

## Prompt Engineering

### Best Practices

1. **Use `<technical_requirements>`**: Specify exact file paths, component names, and testable criteria
2. **Use MUST/SHOULD/MAY**: Clear requirement priority
3. **Specify test identifiers**: Use `data-testid` for reliable testing
4. **Define exact content**: Specify button text, labels, placeholders
5. **Keep prompts focused**: Use extra prompts for supplementary info

### Example Prompt Structure

```markdown
Build a {component} that includes:

- Feature 1
- Feature 2
- Feature 3

<technical_requirements>
  1. Component MUST be default export in src/components/{Name}.tsx
  2. Component MUST be added to main.tsx
  3. Component MUST take optional onSubmit prop
  4. Element X SHOULD have data-testid="x"
  5. Element Y SHOULD have "Text" as content
</technical_requirements>
```

### Constraints System

The harness automatically appends constraints to all prompts (see `generate-prompt.ts`):

```markdown
<constraints>
  IMPORTANT: Do not run npm, pnpm, yarn, or any package manager commands.
  Dependencies have already been installed. Do not run build, test, or
  dev server commands. Just write the code files.
</constraints>
```

This prevents agents from running unnecessary commands and keeps them focused on code generation.

## Testing Strategy

### Test Infrastructure

Each trial's project includes:

- **Vitest**: For running component tests
- **Playwright**: For browser automation
- **@storybook/addon-vitest**: For story-based testing
- **@storybook/addon-a11y**: For accessibility testing
- **ESLint**: For code quality

### Expected Stories

Tasks should include `pre-grade/stories/*.stories.ts` files that:

1. Import the component
2. Define basic stories (e.g., Default)
3. Use `play` functions for interaction testing
4. Export as default story objects

**Example:**
```typescript
import type { Meta, StoryObj } from '@storybook/react';
import { expect, userEvent, within } from '@storybook/test';
import { FlightBooking } from '../src/components/FlightBooking';

const meta = {
  component: FlightBooking,
  tags: ['test'],
} satisfies Meta<typeof FlightBooking>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByTestId('submit'));
    await expect(canvas.getByText('Success')).toBeInTheDocument();
  }
};
```

### Accessibility Testing

The harness uses `@storybook/addon-a11y` which runs Axe checks on all stories:

- Violations are counted per story
- Total violations across all passing tests are reported
- Failed tests don't contribute to a11y metrics

## Dependencies

### Harness Dependencies

- `commander` - CLI argument parsing with environment variable support
- `@clack/prompts` - Interactive CLI prompts
- `valibot` - Schema validation (for MCP config and context types)
- `tinyexec` - Command execution
- `nypm` - Package manager detection and operations
- `ai-tokenizer` - Token counting for Claude

### Template Dependencies

- **Project template**: Vite + React + TypeScript (minimal)
- **Grading template**: Vitest + Playwright + Storybook + ESLint + a11y

### Agent Dependencies

- `claude-code` - Claude Code CLI (must be installed globally)

## Google Sheets Integration

The harness can optionally upload results to Google Sheets for tracking trials over time.

**How it works:**

1. Uses Google Apps Script web app as proxy
2. Appends row with metrics to spreadsheet
3. Includes git branch/commit for context
4. Respects `--upload-id` / `--no-upload-id` flags

**Setup** (for maintainers):

- Google Apps Script code is in `google-apps-script.js`
- Deployed as web app with spreadsheet access
- URL is hardcoded in `save-to-sheets.ts`

## MCP Server Configuration

### Storybook MCP - Dev Pattern

When using `--context storybook-dev`, the harness:

1. Copies the grading template with `.storybook` config (includes `@storybook/addon-mcp`)
2. Installs Storybook packages in the trial project
3. Starts a Storybook dev server on a random available port
4. Provides MCP config to the agent:
   ```json
   {
     "mcpServers": {
       "storybook-dev-mcp": {
         "type": "http",
         "url": "http://localhost:{PORT}/mcp"
       }
     }
   }
   ```
5. Agent receives MCP tools from `@storybook/addon-mcp`
6. On teardown, the dev server is automatically stopped

### Storybook MCP - Docs Pattern (Component Manifest)

When using `--context storybook-docs`, the harness:

1. Reads the manifest files from the task's `manifests/` subdirectory (e.g. `components.json` and optionally `docs.json`)
2. Creates `.mcp.json` in project with stdio server config:
   ```json
   {
     "mcpServers": {
       "storybook-mcp": {
         "type": "stdio",
         "command": "node",
         "args": ["../../packages/mcp/bin.ts", "--manifestsDir", "/path/to/manifests/dir/"]
       }
     }
   }
   ```
3. Agent receives MCP tools from `@storybook/mcp` package

### Custom MCP Server Pattern

When using `--context mcp.config.json`, the harness:

1. Reads the config file (or parses inline JSON)
2. Validates against `McpServerConfigSchema`
3. Writes to project's `.mcp.json`
4. Agent connects to specified servers (HTTP or stdio)

**Example config:**
```json
{
  "my-server": {
    "type": "http",
    "url": "http://localhost:6006/mcp",
    "headers": { "X-Custom": "value" }
  }
}
```

## Tips for Development

### Debugging Failed Trials

1. **Check `transcript.json`**: See exact agent activity
2. **Review `build-output.txt`**: Build errors
3. **Check `typecheck-output.txt`**: TypeScript issues
4. **Inspect `lint-output.txt`**: Code quality problems
5. **Read `test-results.json`**: Test failures and a11y violations
6. **Compare with `pre-grade/`**: See reference files copied before grading

### Common Issues

- **Dependencies not installed**: Harness handles this, but hooks may need to wait
- **MCP server not trusted**: Harness auto-approves via stdin
- **Tests fail to run**: Check that stories are in `stories/` directory and have `tags: ['test']`
- **Build fails**: Agent may have created invalid TypeScript

### Performance Optimization

- Grading checks run in parallel (build, typecheck, lint, test)
- Use `--verbose` only for debugging (slower)
- Skip `--upload-id` for faster local iteration

## Notes for AI Assistants

- The harness is designed for reproducibility - same inputs should give comparable outputs
- Always check `collect-args.ts` for the canonical list of CLI options
- Hooks are optional - most tasks only need `pre-grade/` for test stories
- Hook directories copy files first, then hook functions run
- Extra prompts are append-only - they don't replace the main prompt
- The `CONSTRAINTS_PROMPT` is always appended to prevent package manager usage
- Agent token counting is approximate - uses client-side tokenizer, not actual API response
- Coverage metrics track quality trends across trials
- Check `transcript.json` for debugging agent behavior
- All trial artifacts are saved - nothing is deleted automatically
- Timestamps use local time with timezone offset for consistent naming
````
