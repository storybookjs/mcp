import { log } from '@clack/prompts';
import type {
	ExperimentArgs,
	Context,
	EvaluationSummary,
	ExecutionSummary,
} from '../../types.ts';
import * as path from 'path';

const GOOGLE_SHEETS_URL =
	'https://script.google.com/macros/s/AKfycbxVIMk1tyvZN5Wb_vWrcZMRmV0rl0cibNfiveOScwKxIQjPH7QBN6IMGDdagn2ENg_0wQ/exec';

type SheetsData = {
	uploadId: string;
	runId: string;
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
	componentUsageScore: number | null;
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
			case 'inline-prompt':
				details.push(`Prompt`);
				break;
			case 'extra-prompts':
				details.push(`Extra prompts: ${ctx.prompts.join(', ')}`);
				break;
			case 'mcp-server':
				details.push(`MCP: ${Object.keys(ctx.mcpServerConfig).join(', ')}`);
				break;
			case 'storybook-mcp-dev':
				details.push('Storybook Dev MCP');
				break;
			case 'storybook-mcp-docs': {
				details.push('Storybook MCP');
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
		runId: experimentArgs.runId ?? '',
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
		componentUsageScore: evaluationSummary.componentUsage?.score ?? null,
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
