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
	cost: number;
	duration: number;
	durationApi: number;
	turns: number;
	contextType: string;
	contextDetails: string;
	agent: string;
	gitBranch: string;
	gitCommit: string;
	experimentPath: string;
};

function getContextDetails(context: Context): string {
	switch (context.type) {
		case false:
			return 'None';
		case 'extra-prompts':
			return context.prompts.join(', ');
		case 'mcp-server':
			return Object.keys(context.mcpServerConfig).join(', ');
		case 'components-manifest': {
			// Extract manifest path from MCP server config args
			const mcpConfig = Object.values(context.mcpServerConfig)[0];
			if (mcpConfig?.type === 'stdio' && mcpConfig.args) {
				const manifestIndex = mcpConfig.args.indexOf('--manifestPath');
				const manifestIndexValue = mcpConfig.args[manifestIndex + 1];
				if (manifestIndex !== -1 && manifestIndexValue) {
					return path.basename(manifestIndexValue);
				}
			}
			return 'unknown manifest name';
		}
	}
}

export async function saveToGoogleSheets(
	experimentArgs: ExperimentArgs,
	evaluationSummary: EvaluationSummary,
	executionSummary: ExecutionSummary,
	environment: { branch: string; commit: string },
	chromaticUrl?: string,
): Promise<void> {
	const { experimentPath, evalName, context, uploadId } = experimentArgs;

	const data: SheetsData = {
		uploadId: uploadId || '',
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
		cost: executionSummary.cost,
		duration: executionSummary.duration,
		durationApi: executionSummary.durationApi,
		turns: executionSummary.turns,
		contextType: context.type === false ? 'none' : context.type,
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
