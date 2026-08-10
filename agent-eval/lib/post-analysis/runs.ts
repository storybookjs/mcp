import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// Layout: results/<experiment>[/<model>]/<timestamp>/<eval>/run-N/project.
// The model segment only appears in legacy trees; current agentic-ref runs
// have none, so `model` is '' for them.
export interface Run {
	runDir: string;
	projectDir: string;
	experiment: string;
	model: string;
	timestamp: string;
	evalName: string;
	run: number;
}

export function findRuns(resultsDir: string): Run[] {
	if (!existsSync(resultsDir)) return [];
	const runs: Run[] = [];
	const walk = (current: string) => {
		for (const entry of readdirSync(current, { withFileTypes: true })) {
			if (!entry.isDirectory()) {
				continue;
			}
			const path = join(current, entry.name);
			if (!/^run-\d+$/.test(entry.name) || !existsSync(join(path, 'project'))) {
				walk(path);
				continue;
			}
			const parts = path.slice(resultsDir.length + 1).split('/');
			runs.push({
				runDir: path,
				projectDir: join(path, 'project'),
				experiment: parts[0]!,
				model: parts.slice(1, -3).join('/'),
				timestamp: parts.at(-3)!,
				evalName: parts.at(-2)!,
				run: Number.parseInt(entry.name.slice('run-'.length), 10),
			});
		}
	};
	walk(resultsDir);
	return runs;
}

/** On-disk timestamps replace the time's ':' with '-'; undo that for Date.parse. */
export function parseTimestamp(value: string): number {
	return Date.parse(value.replace(/T(\d\d)-(\d\d)-(\d\d)/, 'T$1:$2:$3'));
}
