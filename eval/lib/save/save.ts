import type {
	GradingSummary,
	TrialArgs,
	ExecutionSummary,
} from '../../types.ts';
import { taskLog } from '@clack/prompts';
import { saveEnvironment } from './environment.ts';
import { saveToGoogleSheets } from './google-sheet.ts';
import { buildStorybook, uploadToChromatic } from './chromatic.ts';
import { runHook } from '../run-hook.ts';

export async function save(
	trialArgs: TrialArgs,
	gradingSummary: GradingSummary,
	executionSummary: ExecutionSummary,
): Promise<string | undefined> {
	const shouldUpload = trialArgs.uploadId !== false;
	const log = taskLog({
		title: `Saving ${shouldUpload ? 'and uploading ' : ''}results`,
		retainLog: trialArgs.verbose,
	});
	await runHook('pre-save', trialArgs);

	log.message('Saving environment');
	const environment = await saveEnvironment(trialArgs);

	if (!shouldUpload) {
		await runHook('post-save', trialArgs);
		log.success('Save complete, upload disabled!');
		return undefined;
	}

	// Build Storybook and upload to Chromatic
	log.message('Building Storybook');
	const storybookBuildSuccess = await buildStorybook(trialArgs);

	let storybookUrl: string | undefined = undefined;

	if (!storybookBuildSuccess) {
		log.error('Storybook build failed, skipping Chromatic upload.');
	} else {
		log.message('Uploading to Chromatic');
		storybookUrl = await uploadToChromatic(trialArgs);
	}

	// Save to Google Sheets
	log.message('Uploading to Google Sheets');
	await saveToGoogleSheets(
		trialArgs,
		gradingSummary,
		executionSummary,
		environment,
		storybookUrl,
	);

	await runHook('post-save', trialArgs);
	log.success('Upload complete!');
	return storybookUrl;
}
