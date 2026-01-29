# Storybook MCP Eval Harness

A CLI-based eval harness for testing AI coding agents' ability to build UI components with Storybook and MCP tools.

## What is this?

This eval harness runs automated trials where AI coding agents (Claude Code CLI or GitHub Copilot CLI) are given prompts to build UI components. Each trial:

1. **Prepares** a fresh Vite + React + Storybook project
2. **Executes** the agent with a prompt and optional context (MCP servers, component manifests, or extra prompts)
3. **Grades** the results using automated metrics: build success, type checking, linting, tests, and accessibility

The goal is to measure how well agents can use Storybook's MCP tools to build production-quality components.

> [!NOTE]
> All task results that are uploaded (opt-outable) are publicly available in [this Google Sheet](https://docs.google.com/spreadsheets/d/1TAvPyK6S6J-Flc1-gNrQpwmd6NWVXoTrQhaQ35y13vw/edit?usp=sharing).

## Requirements

- Node.js 24+
- pnpm 10.19.0+
- Playwright (`npx playwright install`)
- Claude Code CLI (`npm install -g @anthropic-ai/claude-code`) - for `claude-code` agent
- GitHub Copilot CLI (`gh extension install github/gh-copilot`) - for `copilot-cli` agent

## Quick Start

```bash
# Interactive mode (recommended)
node eval.ts

# Orchestrate multiple runs across variants
node orchestrate.ts

# With all options specified
node eval.ts --agent claude-code --model claude-sonnet-4.5 --context components.json --upload-id batch-1 100-flight-booking-plain
```

## CLI Options

| Option           | Short | Type    | Description                                                                                               |
| ---------------- | ----- | ------- | --------------------------------------------------------------------------------------------------------- |
| `--agent`        | `-a`  | string  | Which agent to use (`claude-code` or `copilot-cli`)                                                       |
| `--model`        | `-m`  | string  | Which model to use (see [Model Selection](#model-selection) below)                                        |
| `--context`      | `-c`  | string  | Context type: `false`, `storybook-dev`, `*.json` (manifest), `mcp.config.json`, or `*.md` (extra prompts) |
| `--verbose`      | `-v`  | boolean | Show detailed logs during execution                                                                       |
| `--storybook`    | `-s`  | boolean | Auto-start Storybook after completion                                                                     |
| `--upload-id`    | `-u`  | string  | Upload results to Google Sheets with this ID for grouping/filtering                                       |
| `--no-upload-id` |       | -       | Skip uploading results (default if no upload ID provided)                                                 |
| `--run-id`       |       | string  | Run identifier to group uploads together                                                                  |
| `--help`         | `-h`  | -       | Display help information                                                                                  |

**Positional argument:** The task directory name (e.g., `100-flight-booking-plain`)

### Model Selection

Different agents support different models:

| Model                  | Claude Code CLI | Copilot CLI |
| ---------------------- | :-------------: | :---------: |
| `claude-sonnet-4.5`    |       ✅        |     ✅      |
| `claude-opus-4.5`      |       ✅        |     ✅      |
| `claude-haiku-4.5`     |       ✅        |     ✅      |
| `gpt-5.1-codex`        |       ❌        |     ✅      |
| `gpt-5.1-codex-max`    |       ❌        |     ✅      |
| `gpt-5.2`              |       ❌        |     ✅      |
| `gemini-3-pro-preview` |       ❌        |     ✅      |

**Example usage:**

```bash
# Claude Code with Opus
node eval.ts --agent claude-code --model claude-opus-4.5 100-flight-booking-plain

# Copilot CLI with GPT-5.2
node eval.ts --agent copilot-cli --model gpt-5.2 100-flight-booking-plain
```

> [!IMPORTANT]
> **GitHub Copilot CLI Model Configuration**
>
> To use models other than `claude-sonnet-4.5` with the Copilot CLI, you must first enable them in your GitHub account settings:
>
> 1. Go to [GitHub Copilot Features Settings](https://github.com/settings/copilot/features)
> 2. Enable the models you want to use (e.g., GPT-5.1 Codex Max, GPT-5.2, Claude Opus 4.5)
> 3. Save your settings
> 4. Wait up to 30 minutes
>
> Without enabling these models, the Copilot CLI will fail when attempting to use them.

### Context Types

The harness supports five context modes:

1. **No context** (`--no-context`): Agent uses only default tools
2. **Storybook MCP - Dev** (`--context storybook-dev`): Sets up local Storybook dev server with MCP endpoint
3. **Storybook MCP - Docs** (`--context components.json`): Provides component documentation via the `@storybook/mcp` package
4. **MCP server config** (`--context mcp.config.json` or inline JSON): Custom MCP server setup (use this for fully custom MCP servers, not for Storybook MCP)
5. **Extra prompts** (`--context extra-prompt-01.md,extra-prompt-02.md`): Additional markdown files appended to main prompt

## Orchestrator

Use the orchestrator to run multiple trials across context variants and compare results.

```bash
# Interactive orchestration
node orchestrate.ts

# Orchestrate via pnpm script
pnpm orchestrate

# Advanced mode (only for internal usage - more prompt options available)
node orchestrate.ts --advanced-mode
```

### Orchestration configs

Orchestrator configs live under `eval/orchestrations/` and define a base setup plus variants:

```ts
// eval/orchestrations/storybook-mcp-comparison.ts
const base = {
	agent: 'claude-code',
	model: 'claude-sonnet-4.5',
};

export default {
	name: 'storybook-mcp-comparison',
	variants: [
		{
			...base,
			id: 'with-mcp',
			label: 'With Storybook MCP',
			context: [{ type: 'storybook-mcp-docs' }],
		},
		{
			...base,
			id: 'without-mcp',
			label: 'Without MCP',
			context: [{ type: false }],
		},
	],
};
```

## Project Structure

```
eval/
├── tasks/                          # Task definitions
│   └── 100-flight-booking-plain/
│       ├── prompt.md               # Main prompt for the agent
│       ├── components.json         # Optional: component manifest
│       ├── mcp.config.json         # Optional: MCP server config
│       ├── extra-prompt-*.md       # Optional: additional context
│       ├── hooks.ts                # Optional: lifecycle hooks
│       └── trials/                 # Generated trial runs
│           └── {context}-{agent}-{timestamp}-{unique}/
│               ├── prompt.md       # Full prompt sent to agent
│               ├── project/        # Generated project code
│               └── results/        # Grading results
│                   ├── summary.json
│                   ├── transcript.json
│                   ├── build-output.txt
│                   ├── typecheck-output.txt
│                   ├── lint-output.txt
│                   └── test-results.json
├── templates/
│   ├── project/                    # Base Vite + React + Storybook template
│   └── grading/                    # Test/lint configs for grading
├── orchestrations/                 # Orchestrator configs
└── lib/
    ├── agents/                     # Agent implementations
    ├── graders/                    # Grading runners (build, test, lint, etc.)
    └── *.ts                        # Core harness logic
```

## Creating a Task

1. **Create task directory:**

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
   - `components.json` - Component manifest for Storybook MCP
   - `mcp.config.json` - Custom MCP server configuration
   - `extra-prompt-*.md` - Supplementary instructions

4. **Optional: Create `hooks.ts`:**

   ```typescript
   import type { Hooks } from '../../types.ts';

   export default {
   	async postPrepareTrial(args, log) {
   		// Custom setup (e.g., copy fixtures)
   	},
   } satisfies Hooks;
   ```

## Grading Metrics

Each trial produces:

- **Build success**: Can the project build without errors?
- **Type check**: TypeScript compilation errors count
- **Lint**: ESLint errors count
- **Tests**: Storybook story results (passed/failed) including play functions
- **Accessibility**: Axe violations count
- **Coverage**: Vite/Vitest coverage summary (lines/statements/branches/functions)
- **Cost**: API usage cost in USD
- **Duration**: Total time and API time in seconds
- **Turns**: Number of agent transcript turns

## Output Files

### `summary.json`

Complete metrics from execution and grading:

```json
{
	"cost": 0.1234,
	"duration": 45,
	"turns": 8,
	"buildSuccess": true,
	"typeCheckErrors": 0,
	"lintErrors": 0,
	"test": { "passed": 3, "failed": 0 },
	"a11y": { "violations": 1 },
	"coverage": {
		"lines": 87.5,
		"statements": 86.9,
		"branches": 75.0,
		"functions": 80.0
	}
}
```

### `transcript.json`

Complete transcript log with:

- All assistant and user messages
- Tool calls with arguments
- Token counts and costs per message
- Todo list progress

### Test Results

- `test-results.json` - Detailed test outcomes
- `build-output.txt` - Build logs
- `typecheck-output.txt` - TypeScript errors
- `lint-output.txt` - ESLint output

## Lifecycle Hooks

Customize trial behavior with `hooks.ts`:

```typescript
export default {
	prePrepareTrial: async (args, log) => {
		// Before project template copy
	},
	postPrepareTrial: async (args, log) => {
		// After dependencies installed
	},
	preExecuteAgent: async (args, log) => {
		// Before agent starts
	},
	postExecuteAgent: async (args, log) => {
		// After agent completes
	},
	preGrade: async (args, log) => {
		// Before grading runs
	},
	postGrade: async (args, log) => {
		// After grading completes
	},
} satisfies Hooks;
```

## Viewing Results

**Inspect generated project:**

```bash
cd tasks/100-flight-booking-plain/trials/{trial-name}/project
pnpm storybook
```

**View transcript:** Open `results/transcript.json` to see agent activity.

## Tips

- Use `--verbose` to see detailed agent activity and tool calls
- Check `transcript.json` to debug agent behavior
- Use extra prompts to guide agent without modifying main prompt
- Component manifests work best when agents need library documentation
