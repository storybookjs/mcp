import type { ExperimentArgs } from '../../types';
import envinfo from 'envinfo';
import * as fs from 'fs/promises';
import * as path from 'path';
import { x } from 'tinyexec';

export async function saveEnvironment({
	resultsPath,
	agent,
}: ExperimentArgs) {
	const info = JSON.parse(
		await envinfo.run(
			{
				System: ['OS', 'CPU', 'Memory', 'Shell'],
				Binaries: ['Node', 'Yarn', 'npm', 'pnpm', 'claude'],
			},
			{
				json: true,
				showNotFound: true,
			},
		),
	);

	const commit =
		(await x('git', ['rev-parse', 'HEAD'])).stdout.trim() ?? 'unknown';
	const branch =
		(await x('git', ['rev-parse', '--abbrev-ref', 'HEAD'])).stdout.trim() ??
		'unknown';

	await fs.writeFile(
		path.join(resultsPath, 'environment.json'),
		JSON.stringify(
			{
				agent,
				date: new Date().toISOString(),
				branch,
				commit,
				...info,
			},
			null,
			2,
		),
	);

	return { branch, commit };
}
