import { log } from '@clack/prompts';
import type {
	ExperimentArgs,
	Context,
	EvaluationSummary,
	ExecutionSummary,
} from '../../types.ts';
import * as path from 'path';

const GOOGLE_SHEETS_URL =
	'https://script.google.com/macros/s/AKfycbwAbn91zsf9V2UKyLqtJb-NQ1CFbqqEyed_lc-AhauGu4zWflET_NDwMkD02xzvKVjCow/exec';

type SheetsData = {
	uploadId: string;
	timestamp: string;
	evalName: string;
	chromaticUrl: string;
	buildSuccess: boolean;
	typeCheckErrors: number;
	lintErrors: number;
	testsPassed: number;
	a11yViolations: number;
	cost: number | 'unknown';
	duration: number;
	durationApi: number;
	turns: number;
	coverageLines: number | null;
	contextType: string;
	contextDetails: string;
	agent: string;
	gitBranch: string;
	gitCommit: string;
	experimentPath: string;
};

function getContextDetails(context: Context): string {
	if (
		context.length === 0 ||
		(context.length === 1 && context[0]!.type === false)
	) {
		return 'None';
	}

	const details: string[] = [];
	for (const ctx of context) {
		if (ctx.type === false) {
			continue;
		}
		switch (ctx.type) {
			case 'extra-prompts':
				details.push(`Extra prompts: ${ctx.prompts.join(', ')}`);
				break;
			case 'mcp-server':
				details.push(`MCP: ${Object.keys(ctx.mcpServerConfig).join(', ')}`);
				break;
			case 'storybook-mcp-dev':
				details.push('Storybook Dev Server');
				break;
			case 'components-manifest': {
				// Extract manifest path from MCP server config args
				const mcpConfig = Object.values(ctx.mcpServerConfig)[0];
				if (mcpConfig?.type === 'stdio' && mcpConfig.args) {
					const manifestIndex = mcpConfig.args.indexOf('--manifestPath');
					const manifestIndexValue = mcpConfig.args[manifestIndex + 1];
					if (manifestIndex !== -1 && manifestIndexValue) {
						details.push(`Manifest: ${path.basename(manifestIndexValue)}`);
					} else {
						details.push('unknown manifest name');
					}
				} else {
					details.push('unknown manifest name');
				}
				break;
			}
		}
	}
	return details.join('; ');
}

export async function saveToGoogleSheets(
	experimentArgs: ExperimentArgs,
	evaluationSummary: EvaluationSummary,
	executionSummary: ExecutionSummary,
	environment: { branch: string; commit: string },
	chromaticUrl?: string,
): Promise<void> {
	const { experimentPath, evalName, context, uploadId } = experimentArgs;

	if (!uploadId) {
		throw new Error('saveToGoogleSheets called without an uploadId');
	}

	const data: SheetsData = {
		uploadId,
		timestamp: new Date().toISOString().replace('Z', ''),
		evalName,
		chromaticUrl: chromaticUrl || '',
		buildSuccess: evaluationSummary.buildSuccess,
		typeCheckErrors: evaluationSummary.typeCheckErrors,
		lintErrors: evaluationSummary.lintErrors,
		testsPassed:
			evaluationSummary.test.passed /
			(evaluationSummary.test.passed + evaluationSummary.test.failed),
		a11yViolations: evaluationSummary.a11y.violations,
		coverageLines: evaluationSummary.coverage?.lines
			? evaluationSummary.coverage.lines / 100
			: null,
		cost: executionSummary.cost ?? 'unknown',

		duration: executionSummary.duration,
		durationApi: executionSummary.durationApi,
		turns: executionSummary.turns,
		contextType:
			context.length === 0 ||
			(context.length === 1 && context[0]!.type === false)
				? 'none'
				: context
						.map((ctx) => (ctx.type === false ? 'none' : ctx.type))
						.join('-'),
		contextDetails: getContextDetails(context),
		agent: experimentArgs.agent,
		gitBranch: environment.branch,
		gitCommit: environment.commit,
		experimentPath: path.relative(process.cwd(), experimentPath),
	};

	try {
		const response = await fetch(GOOGLE_SHEETS_URL, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify(data),
			redirect: 'manual',
		});
		log.info(response.status.toString());

		// Google Apps Script may return HTML on redirect, so check content type
		const contentType = response.headers.get('content-type');
		if (!contentType?.includes('application/json')) {
			// If not JSON, assume success (Google Apps Script quirk)
			return;
		}

		const result = (await response.json()) as {
			success: boolean;
			error?: string;
		};
		log.info(JSON.stringify(result, null, 2));

		if (!result.success) {
			log.error(JSON.stringify(result, null, 2));
			throw new Error(
				`Google Sheets API error: ${result.error || 'Unknown error'}`,
			);
		}
	} catch (error) {
		console.error(error);
		throw new Error(
			`Failed to save to Google Sheets: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}
