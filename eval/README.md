# Storybook MCP Evaluation Framework

A CLI-based evaluation framework for testing AI coding agents' ability to build UI components with Storybook and MCP tools.

## What is this?

This framework runs automated experiments where AI coding agents (Claude Code CLI or GitHub Copilot CLI) are given prompts to build UI components. Each experiment:

1. **Prepares** a fresh Vite + React + Storybook project
2. **Executes** the agent with a prompt and optional context (MCP servers, component manifests, or extra prompts)
3. **Evaluates** the results using automated checks: build success, type checking, linting, tests, and accessibility

The goal is to measure how well agents can use Storybook's MCP tools to build production-quality components.

> [!NOTE]
> All eval results that are uploaded (opt-outable) are publicly available in [this Google Sheet](https://docs.google.com/spreadsheets/d/1TAvPyK6S6J-Flc1-gNrQpwmd6NWVXoTrQhaQ35y13vw/edit?usp=sharing).

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
| `--help`         | `-h`  | -       | Display help information                                                                                  |

**Positional argument:** The eval directory name (e.g., `100-flight-booking-plain`)

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

The framework supports five context modes:

1. **No context** (`--no-context`): Agent uses only default tools
2. **Storybook MCP - Dev** (`--context storybook-dev`): Sets up local Storybook dev server with MCP endpoint
3. **Storybook MCP - Docs** (`--context components.json`): Provides component documentation via the `@storybook/mcp` package
4. **MCP server config** (`--context mcp.config.json` or inline JSON): Custom MCP server setup (use this for fully custom MCP servers, not for Storybook MCP)
5. **Extra prompts** (`--context extra-prompt-01.md,extra-prompt-02.md`): Additional markdown files appended to main prompt

## Project Structure

```
eval/
├── evals/                          # Evaluation definitions
│   └── 100-flight-booking-plain/
│       ├── prompt.md               # Main prompt for the agent
│       ├── components.json         # Optional: component manifest
│       ├── mcp.config.json         # Optional: MCP server config
│       ├── extra-prompt-*.md       # Optional: additional context
│       ├── hooks.ts                # Optional: lifecycle hooks
│       └── experiments/            # Generated experiment runs
│           └── {context}-{agent}-{timestamp}/
│               ├── prompt.md       # Full prompt sent to agent
│               ├── project/        # Generated project code
│               └── results/        # Evaluation results
│                   ├── summary.json
│                   ├── full-conversation.js
│                   ├── build-output.txt
│                   ├── typecheck-output.txt
│                   ├── lint-output.txt
│                   └── test-results.json
├── templates/
│   ├── project/                    # Base Vite + React + Storybook template
│   └── evaluation/                 # Test/lint configs for evaluations
└── lib/
    ├── agents/                     # Agent implementations
    ├── evaluations/                # Evaluation runners (build, test, lint, etc.)
    └── *.ts                        # Core framework logic
```

## Creating an Eval

1. **Create eval directory:**

   ```bash
   mkdir evals/200-my-component
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
   	async postPrepareExperiment(args, log) {
   		// Custom setup (e.g., copy fixtures)
   	},
   } satisfies Hooks;
   ```

## Evaluation Metrics

Each experiment produces:

- **Build success**: Can the project build without errors?
- **Type check**: TypeScript compilation errors count
- **Lint**: ESLint errors count
- **Tests**: Storybook story results (passed/failed) including play functions
- **Accessibility**: Axe violations count
- **Coverage**: Vite/Vitest coverage summary (lines/statements/branches/functions)
- **Cost**: API usage cost in USD
- **Duration**: Total time and API time in seconds
- **Turns**: Number of agent conversation turns

## Output Files

### `summary.json`

Complete metrics from execution and evaluation:

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

### `full-conversation.js`

Complete conversation log viewable in `conversation-viewer.html`:

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

Customize experiment behavior with `hooks.ts`:

```typescript
export default {
	prePrepareExperiment: async (args, log) => {
		// Before project template copy
	},
	postPrepareExperiment: async (args, log) => {
		// After dependencies installed
	},
	preExecuteAgent: async (args, log) => {
		// Before agent starts
	},
	postExecuteAgent: async (args, log) => {
		// After agent completes
	},
	preEvaluate: async (args, log) => {
		// Before evaluation runs
	},
	postEvaluate: async (args, log) => {
		// After evaluation completes
	},
} satisfies Hooks;
```

## Viewing Results

**Conversation viewer:**

```bash
# Open the HTML file and select the full-conversation.js file
open conversation-viewer.html
```

**Storybook:**

```bash
cd evals/100-flight-booking-plain/experiments/{experiment-name}/project
pnpm storybook
```

## Tips

- Use `--verbose` to see detailed agent activity and tool calls
- Check `full-conversation.js` to debug agent behavior
- Use extra prompts to guide agent without modifying main prompt
- Component manifests work best when agents need library documentation
