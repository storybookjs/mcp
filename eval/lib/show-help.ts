import { styleText } from 'node:util';

export function showHelp(): void {
	console.log(styleText('bold', '\n🧪 Storybook MCP Evaluation Framework\n'));

	console.log(
		'A CLI tool for testing AI coding agents with Storybook and MCP tools.\n',
	);

	console.log(styleText(['bold', 'cyan'], 'USAGE'));
	console.log('  node eval.ts [options] [eval-name]\n');

	console.log(styleText(['bold', 'cyan'], 'EXAMPLES'));
	console.log('  # Interactive mode (recommended)');
	console.log('  node eval.ts\n');
	console.log('  # Run specific eval with all options');
	console.log(
		'  node eval.ts --agent claude-code --context components.json --upload 100-flight-booking-plain\n',
	);
	console.log('  # Run with extra prompts and verbose output');
	console.log(
		'  node eval.ts -v --context extra-prompt-01.md,extra-prompt-02.md 100-flight-booking-plain\n',
	);
	console.log('  # Run with MCP server config');
	console.log(
		'  node eval.ts --context mcp.config.json 110-flight-booking-reshaped\n',
	);

	console.log(styleText(['bold', 'cyan'], 'ARGUMENTS'));
	console.log(
		`  ${styleText('yellow', 'eval-name')}               Name of the eval directory in evals/ (optional, will prompt if omitted)\n`,
	);

	console.log(styleText(['bold', 'cyan'], 'OPTIONS'));
	console.log(
		`  ${styleText('yellow', '-a, --agent <name>')}      Which coding agent to use (default: will prompt)`,
	);
	console.log(`                           Options: claude-code, copilot`);
	console.log(
		`\n  ${styleText('yellow', '-c, --context <value>')}   Additional context for the agent (default: will prompt)`,
	);
	console.log(`                           Types:`);
	console.log(
		`                             ${styleText('green', 'false')}             - No additional context`,
	);
	console.log(
		`                             ${styleText('green', '*.json')}            - Component manifest file, path relative to the eval (uses @storybook/mcp)`,
	);
	console.log(
		`                             ${styleText('green', 'mcp.config.json')}   - MCP server configuration file, path relative to the eval`,
	);
	console.log(
		`                             ${styleText('green', '*.md,*.md')}         - Comma-separated extra prompt files, paths relative to the eval`,
	);
	console.log(
		`                           Examples: --context components.json, --no-context`,
	);
	console.log(
		`\n  ${styleText('yellow', '-v, --verbose')}          Show detailed logs during execution (default: false)`,
	);
	console.log(
		`\n  ${styleText('yellow', '-s, --storybook')}        Auto-start Storybook after evaluation completes`,
	);
	console.log(
		`      ${styleText('yellow', '--no-storybook')}      Do not auto-start Storybook after evaluation completes`,
	);
	console.log(
		`\n  ${styleText('yellow', '-u, --upload')}           Build Storybook, upload to Chromatic, and save results to Google Sheets (default: true)`,
	);
	console.log(
		`      ${styleText('yellow', '--no-upload')}         Skip uploading results`,
	);
	console.log(
		`\n  ${styleText('yellow', '-h, --help')}             Display this help message and exit\n`,
	);

	console.log(styleText(['bold', 'cyan'], 'CONTEXT MODES'));
	console.log(
		`  ${styleText('bold', 'No Context')}          Agent uses only built-in tools`,
	);
	console.log(
		`  ${styleText('bold', 'Component Manifest')} Provides component documentation via @storybook/mcp`,
	);
	console.log(
		`  ${styleText('bold', 'MCP Server')}         Custom MCP server (HTTP or stdio)`,
	);
	console.log(
		`  ${styleText('bold', 'Extra Prompts')}      Append additional markdown instructions to main prompt\n`,
	);

	console.log(styleText(['bold', 'cyan'], 'EVALUATION METRICS'));
	console.log('  • Build success (can the project build?)');
	console.log('  • Type check errors (TypeScript compilation issues)');
	console.log('  • Lint errors (ESLint violations)');
	console.log('  • Test results (passed/failed story tests)');
	console.log('  • Accessibility violations (Axe checks)');
	console.log('  • Cost, duration, and API turns\n');

	console.log(styleText(['bold', 'cyan'], 'OUTPUT STRUCTURE'));
	console.log('  evals/{eval-name}/experiments/{context}-{agent}-{timestamp}/');
	console.log('  ├── prompt.md              # Full prompt sent to agent');
	console.log('  ├── project/               # Generated project code');
	console.log('  └── results/');
	console.log('      ├── summary.json           # All metrics');
	console.log('      ├── full-conversation.js   # Complete agent logs');
	console.log('      ├── build-output.txt       # Build logs');
	console.log('      ├── typecheck-output.txt   # TypeScript errors');
	console.log('      ├── lint-output.txt        # ESLint output');
	console.log('      └── test-results.json      # Test outcomes\n');

	console.log(styleText(['bold', 'cyan'], 'LEARN MORE'));
	console.log('  Documentation: eval/README.md');
	console.log('  View results:  open conversation-viewer.html\n');

	process.exit(0);
}
