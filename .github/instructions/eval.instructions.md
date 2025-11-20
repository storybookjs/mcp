````instructions
---
applyTo: 'eval/**'
---

# Copilot Instructions for Storybook MCP Eval Framework

## Project Overview

This is an evaluation framework for testing AI coding agents' ability to build UI components using Storybook and MCP tools. The framework automates the process of running experiments, executing agents with prompts, and evaluating the results through multiple quality metrics.

**Core Purpose**: Measure how effectively AI agents can use Storybook's MCP tools to build production-quality UI components.

## Architecture

### Framework Flow

1. **Prepare**: Create fresh Vite + React + Storybook project from template
2. **Execute**: Run AI agent (Claude Code CLI) with prompt and optional context
3. **Evaluate**: Run automated checks (build, typecheck, lint, tests, a11y)
4. **Report**: Generate metrics, save results, optionally upload to Google Sheets

### Key Components

- **CLI Interface**: Interactive and non-interactive modes via `eval.ts`
- **Context System**: Four context modes (none, component manifest, MCP server, extra prompts)
- **Agent Abstraction**: Pluggable agent implementations (currently Claude Code CLI)
- **Evaluation Pipeline**: Parallel execution of multiple quality checks
- **Hooks System**: Lifecycle hooks for custom experiment logic
- **Telemetry**: Optional results upload to Google Sheets for tracking

### File Structure

```
eval/
├── eval.ts                          # Main CLI entry point
├── types.ts                         # Core types and schemas
├── lib/
│   ├── collect-args.ts              # Interactive CLI argument collection
│   ├── show-help.ts                 # Help text formatting
│   ├── generate-prompt.ts           # Combines prompt parts
│   ├── prepare-experiment.ts        # Project template setup
│   ├── agents/
│   │   └── claude-code-cli.ts       # Claude Code CLI agent implementation
│   └── evaluations/
│       ├── evaluate.ts              # Main evaluation orchestrator
│       ├── prepare-evaluations.ts   # Install test dependencies
│       ├── build.ts                 # Vite build check
│       ├── typecheck.ts             # TypeScript checking
│       ├── lint.ts                  # ESLint execution
│       ├── test-stories.ts          # Vitest + a11y testing
│       ├── environment.ts           # Git branch/commit tracking
│       └── save-to-sheets.ts        # Google Sheets upload
├── evals/                           # Evaluation definitions
│   └── {number}-{name}/
│       ├── prompt.md                # Main prompt
│       ├── hooks.ts                 # Optional lifecycle hooks
│       ├── components.json          # Optional component manifest
│       ├── mcp.config.json          # Optional MCP server config
│       ├── *.md                     # Optional additional context
│       ├── expected/                # Expected output for reference
│       └── experiments/             # Generated experiment runs
└── templates/
    ├── project/                     # Base Vite + React template
    └── evaluation/                  # Test/lint configs
```

### Context Modes

The framework supports four distinct context types:

1. **No Context** (`--no-context`):
   - Agent uses only built-in tools
   - Tests baseline agent capabilities

2. **Component Manifest** (`--context components.json`):
   - Provides component documentation via `@storybook/mcp` package
   - Uses stdio transport with `packages/mcp/bin.ts`
   - Best for testing agents with library/component documentation
   - This uses the Storybook MCP server, not a custom MCP server

3. **MCP Server** (`--context mcp.config.json` or inline JSON):
   - Custom MCP server configuration (HTTP or stdio)
   - Supports multiple named servers
   - Flexible for testing different MCP tool combinations
   - Use this for fully custom MCP servers; use components.json for Storybook MCP

4. **Extra Prompts** (`--context extra-prompt-01.md,extra-prompt-02.md`):
   - Appends additional markdown files to main prompt
   - Useful for providing supplementary instructions
   - Keeps main prompt clean while testing variations

## Development Workflow

### Prerequisites

- Node.js 24+ (see root `.nvmrc`)
- pnpm 10.19.0+ (monorepo root enforces this)
- Claude Code CLI: `npm install -g claude-code`

### Running Evaluations

**Interactive mode (recommended):**
```bash
cd eval
node eval.ts
```

**Non-interactive mode:**
```bash
node eval.ts --agent claude-code --context components.json --upload --no-storybook 100-flight-booking-plain
```

**IMPORTANT**: Always use the `--no-storybook` flag when running evals to prevent the process from hanging at the end waiting for user input about starting Storybook.

**Get help:**
```bash
node eval.ts --help
```

### Creating a New Eval

1. **Create directory:**
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
   - `components.json` - Component manifest for `@storybook/mcp`
   - `mcp.config.json` - Custom MCP server configuration
   - `extra-prompt-*.md` - Supplementary instructions

4. **Optional: Create `hooks.ts`:**
   ```typescript
   import type { Hooks } from '../../types.ts';

   export default {
     async postPrepareExperiment(args, log) {
       // Custom setup (e.g., copy fixture data)
       await fs.cp(
         path.join(args.evalPath, 'fixtures'),
         path.join(args.projectPath, 'public/fixtures'),
         { recursive: true }
       );
     }
   } satisfies Hooks;
   ```

5. **Optional: Create `expected/` directory:**
   - Add reference implementation in `expected/src/components/`
   - Add expected stories in `expected/stories/`
   - Used for comparison during evaluation

### Viewing Results

**Conversation viewer (visualize agent activity):**
```bash
open conversation-viewer.html
# Select the full-conversation.js file from results/
```

**Inspect generated project:**
```bash
cd evals/{eval-name}/experiments/{experiment-name}/project
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
- Functions: camelCase (e.g., `collectArgs`, `prepareExperiment`)
- Types/Interfaces: PascalCase (e.g., `ExperimentArgs`, `Context`)

### Argument Parsing Pattern

The `collect-args.ts` module demonstrates a robust pattern for handling CLI arguments:

1. Parse raw args with `node:util.parseArgs`
2. Validate with Valibot schemas (including async transformations)
3. Prompt for missing values using `@clack/prompts`
4. Build rerun command incrementally for user convenience
5. Return fully-resolved arguments

**Example:**
```typescript
const parsedArgValues = await v.parseAsync(ArgValuesSchema, nodeParsedArgs.values);

const result = await p.group({
  agent: async () => {
    if (parsedArgValues.agent) return parsedArgValues.agent;
    return await p.select({ message: '...', options: [...] });
  }
});
```

## Important Files

### Core Framework

- `eval.ts` - Main entry point, orchestrates entire flow
- `types.ts` - All TypeScript types and Valibot schemas
- `lib/collect-args.ts` - CLI argument parsing and validation
- `lib/show-help.ts` - Help text formatting
- `lib/generate-prompt.ts` - Combines prompt parts with constraints
- `lib/prepare-experiment.ts` - Project template setup

### Agent Integration

- `lib/agents/claude-code-cli.ts` - Claude Code CLI wrapper
  - Streams JSON messages from Claude
  - Parses tool calls and todo lists
  - Calculates token counts using `ai-tokenizer`
  - Tracks conversation for debugging

### Evaluation Pipeline

- `lib/evaluations/evaluate.ts` - Main orchestrator
  - Runs checks in parallel: build, typecheck, lint, test, environment
  - Creates unified logging interface (verbose vs. normal)
  - Formats results and optionally uploads
- `lib/evaluations/prepare-evaluations.ts` - Installs test dependencies
- `lib/evaluations/build.ts` - Vite build verification
- `lib/evaluations/typecheck.ts` - TypeScript compilation check
- `lib/evaluations/lint.ts` - ESLint execution
- `lib/evaluations/test-stories.ts` - Vitest + a11y testing
- `lib/evaluations/save-to-sheets.ts` - Google Sheets upload

### Templates

- `templates/project/` - Base Vite + React + Storybook template
  - Minimal setup with TypeScript
  - `src/main.tsx` - React root (agents modify this)
  - `vite.config.ts` - Vite configuration
- `templates/evaluation/` - Testing infrastructure
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
6. **Conversation logging**: Saves complete conversation with metadata to `full-conversation.js`

**Message Types:**

- `SystemInitMessage`: Session start, tools available, MCP servers
- `AssistantMessage`: Agent responses with text and/or tool calls
- `UserMessage`: Tool results from user
- `ResultMessage`: Final summary with usage stats

**Output Format:**

The agent generates `full-conversation.js` that's viewable in `conversation-viewer.html`:
```javascript
const prompt = `...`;
const promptTokenCount = 1234;
const promptCost = 0.0123;
const messages = [...]; // All messages with metadata
globalThis.loadConversation?.({ prompt, promptTokenCount, promptCost, messages });
```

### Adding a New Agent

To add support for a new coding agent:

1. Create `lib/agents/my-agent.ts`
2. Implement the `Agent` interface from `types.ts`:
   ```typescript
   export const myAgent: Agent = {
     async execute(prompt, experimentArgs, mcpServerConfig) {
       // 1. Setup MCP config if provided
       // 2. Execute agent with prompt
       // 3. Stream/parse output
       // 4. Save conversation log
       // 5. Return ExecutionSummary
       return { cost, duration, durationApi, turns };
     }
   };
   ```
3. Add to `agents` object in `eval.ts`
4. Update `ArgValuesSchema` in `collect-args.ts` to include new agent option

## Evaluation Metrics

Each experiment produces comprehensive metrics:

### Execution Metrics (from agent)

- **cost**: Total API cost in USD
- **duration**: Total execution time in seconds
- **durationApi**: API request time in seconds
- **turns**: Number of conversation turns

### Quality Metrics (from evaluation)

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

**`full-conversation.js`**: Complete conversation log for debugging
**`test-results.json`**: Detailed Vitest results with a11y violations
**`build-output.txt`**: Vite build logs
**`typecheck-output.txt`**: TypeScript compiler output
**`lint-output.txt`**: ESLint output

## Lifecycle Hooks

Evals can define lifecycle hooks in `hooks.ts` to customize behavior:

```typescript
import type { Hooks } from '../../types.ts';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export default {
  // Before project template is copied
  prePrepareExperiment: async (args, log) => {
    log.message('Custom pre-preparation');
  },

  // After dependencies are installed
  postPrepareExperiment: async (args, log) => {
    // Copy fixture files
    await fs.cp(
      path.join(args.evalPath, 'fixtures'),
      path.join(args.projectPath, 'public/fixtures'),
      { recursive: true }
    );
  },

  // Before agent starts execution
  preExecuteAgent: async (args, log) => {
    log.message('Starting agent');
  },

  // After agent completes
  postExecuteAgent: async (args, log) => {
    log.message('Agent finished');
  },

  // Before evaluation runs
  preEvaluate: async (args, log) => {
    log.start('Custom pre-evaluation');
  },

  // After evaluation completes
  postEvaluate: async (args, log) => {
    log.success('Custom post-evaluation');
  }
} satisfies Hooks;
```

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

The framework automatically appends constraints to all prompts (see `generate-prompt.ts`):

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

Each experiment's project includes:

- **Vitest**: For running component tests
- **Playwright**: For browser automation
- **@storybook/addon-vitest**: For story-based testing
- **@storybook/addon-a11y**: For accessibility testing
- **ESLint**: For code quality

### Expected Stories

Evals should include `expected/stories/*.stories.ts` files that:

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
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByTestId('submit'));
    await expect(canvas.getByText('Success')).toBeInTheDocument();
  }
};
```

### Accessibility Testing

The framework uses `@storybook/addon-a11y` which runs Axe checks on all stories:

- Violations are counted per story
- Total violations across all passing tests are reported
- Failed tests don't contribute to a11y metrics

## Dependencies

### Framework Dependencies

- `@clack/prompts` - Interactive CLI prompts
- `valibot` - Schema validation
- `tinyexec` - Command execution
- `nypm` - Package manager detection and operations
- `ai-tokenizer` - Token counting for Claude

### Template Dependencies

- **Project template**: Vite + React + TypeScript (minimal)
- **Evaluation template**: Vitest + Playwright + Storybook + ESLint + a11y

### Agent Dependencies

- `claude-code` - Claude Code CLI (must be installed globally)

## Google Sheets Integration

The framework can optionally upload results to Google Sheets for tracking experiments over time.

**How it works:**

1. Uses Google Apps Script web app as proxy
2. Appends row with metrics to spreadsheet
3. Includes git branch/commit for context
4. Respects `--upload` / `--no-upload` flag

**Setup** (for maintainers):

- Google Apps Script code is in `google-apps-script.js`
- Deployed as web app with spreadsheet access
- URL is hardcoded in `save-to-sheets.ts`

## Conversation Viewer

The `conversation-viewer.html` file provides a web-based interface for viewing agent conversations:

**Features:**

- Timeline view of all messages
- Token counts and costs per message
- Tool call visualization
- Todo list progress tracking
- Collapsible message details

**Usage:**

1. Open `conversation-viewer.html` in browser
2. Select `results/full-conversation.js` file
3. Browse conversation chronologically

## MCP Server Configuration

### Component Manifest Pattern

When using `--context components.json`, the framework:

1. Reads the manifest file from the eval directory
2. Creates `.mcp.json` in project with stdio server config:
   ```json
   {
     "mcpServers": {
       "storybook-mcp": {
         "type": "stdio",
         "command": "node",
         "args": ["../../packages/mcp/bin.ts", "--manifestPath", "/path/to/components.json"]
       }
     }
   }
   ```
3. Agent receives MCP tools from `@storybook/mcp` package

### Custom MCP Server Pattern

When using `--context mcp.config.json`, the framework:

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

### Debugging Failed Experiments

1. **Check `full-conversation.js`**: See exact agent activity
2. **Review `build-output.txt`**: Build errors
3. **Check `typecheck-output.txt`**: TypeScript issues
4. **Inspect `lint-output.txt`**: Code quality problems
5. **Read `test-results.json`**: Test failures and a11y violations
6. **Compare with `expected/`**: See reference implementation

### Common Issues

- **Dependencies not installed**: Framework handles this, but hooks may need to wait
- **MCP server not trusted**: Framework auto-approves via stdin
- **Tests fail to run**: Check that stories are in `stories/` directory and have `tags: ['test']`
- **Build fails**: Agent may have created invalid TypeScript

### Performance Optimization

- Evaluations run in parallel (build, typecheck, lint, test)
- Use `--verbose` only for debugging (slower)
- Skip `--upload` for faster local iteration

## Notes for AI Assistants

- The framework is designed for reproducibility - same inputs should give comparable outputs
- Always check `collect-args.ts` for the canonical list of CLI options
- Hooks are optional - most evals don't need them
- Extra prompts are append-only - they don't replace the main prompt
- The `CONSTRAINTS_PROMPT` is always appended to prevent package manager usage
- Agent token counting is approximate - uses client-side tokenizer, not actual API response
- Coverage metrics track quality trends across experiments
- The conversation viewer is critical for debugging agent behavior
- All experiment artifacts are saved - nothing is deleted automatically
- Timestamps use local time with timezone offset for consistent naming
````
