import { log } from '@clack/prompts';
import type {
	ExperimentArgs,
	Context,
	EvaluationSummary,
	ExecutionSummary,
} from '../../types.ts';
import * as path from 'path';

const GOOGLE_SHEETS_URL = 'https://script.google.com/macros/s/AKfycbwHa1fbMaGmSZc22yxMZrbFgG4VBKVmcsRivQohoHKX7O9AoDpFB1rL5mhiyj-oCJfEcg/exec';

type SheetsData = {
	timestamp: string;
	evalName: string;
	contextType: string;
	contextDetails: string;
	agent: string;
	description: string;
	buildSuccess: boolean;
	typeCheckErrors: number;
	lintErrors: number;
	testsPassed: number;
	testsFailed: number;
	a11yViolations: number;
	cost: number;
	duration: number;
	durationApi: number;
	turns: number;
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
	}
}

async function saveToGoogleSheets(
	data: SheetsData,
): Promise<void> {
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

export async function saveToSheets(
	experimentArgs: ExperimentArgs,
	evaluationSummary: EvaluationSummary,
	executionSummary: ExecutionSummary,
	environment: { branch: string; commit: string },
): Promise<void> {
	const { experimentPath, description, evalName, context } = experimentArgs;

	const data: SheetsData = {
		timestamp: new Date().toISOString().replace('Z', ''),
		evalName,
		contextType: context.type === false ? 'none' : context.type,
		contextDetails: getContextDetails(context),
		agent: experimentArgs.agent,
		description: description || '',
		buildSuccess: evaluationSummary.buildSuccess,
		typeCheckErrors: evaluationSummary.typeCheckErrors,
		lintErrors: evaluationSummary.lintErrors,
		testsPassed: evaluationSummary.test.passed,
		testsFailed: evaluationSummary.test.failed,
		a11yViolations: evaluationSummary.a11y.violations,
		cost: executionSummary.cost,
		duration: executionSummary.duration,
		durationApi: executionSummary.durationApi,
		turns: executionSummary.turns,
		gitBranch: environment.branch,
		gitCommit: environment.commit,
		experimentPath: path.relative(process.cwd(), experimentPath),
	};

	await saveToGoogleSheets(data);
}
