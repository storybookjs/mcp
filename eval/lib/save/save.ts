import type {
	EvaluationSummary,
	ExperimentArgs,
	ExecutionSummary,
} from '../../types.ts';
import { taskLog } from '@clack/prompts';
import { saveEnvironment } from './environment.ts';
import { saveToGoogleSheets } from './google-sheet.ts';
import { buildStorybook, uploadToChromatic } from './chromatic.ts';
import { runHook } from '../run-hook.ts';

export async function save(
	experimentArgs: ExperimentArgs,
	evaluationSummary: EvaluationSummary,
	executionSummary: ExecutionSummary,
): Promise<string | undefined> {
	const shouldUpload = !!experimentArgs.uploadId;
	const log = taskLog({
		title: `Saving ${shouldUpload ? 'and uploading ' : ''}results`,
		retainLog: experimentArgs.verbose,
	});
	await runHook('pre-save', experimentArgs);

	log.message('Saving environment');
	const environment = await saveEnvironment(experimentArgs);

	if (!shouldUpload) {
		await runHook('post-save', experimentArgs);
		log.success('Save complete, upload disabled!');
		return undefined;
	}

	// Build Storybook and upload to Chromatic
	log.message('Building Storybook');
	const storybookBuildSuccess = await buildStorybook(experimentArgs);
	if (!storybookBuildSuccess) {
		log.error('Storybook build failed, skipping upload.');
		return;
	}
	log.message('Uploading to Chromatic');
	const storybookUrl = await uploadToChromatic(experimentArgs);

	// Save to Google Sheets
	log.message('Uploading to Google Sheets');
	await saveToGoogleSheets(
		experimentArgs,
		evaluationSummary,
		executionSummary,
		environment,
		storybookUrl,
	);

	await runHook('post-save', experimentArgs);
	log.success('Upload complete!');
	return storybookUrl;
}
