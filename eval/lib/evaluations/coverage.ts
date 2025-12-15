import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import type { EvaluationSummary } from '../../types';
import type { CoverageFiles, CoverageSummary } from './result-types';
import { createCoverageMap } from 'istanbul-lib-coverage';
import { log } from '@clack/prompts';

export async function computeCoverage(
	projectPath: string,
	resultsPath: string,
): Promise<{
	coverage?: EvaluationSummary['coverage'];
	coverageFiles?: CoverageFiles;
}> {
	let coverage: EvaluationSummary['coverage'];
	let coverageFiles: CoverageFiles | undefined;

	const finalCoveragePath = path.join(
		projectPath,
		'coverage',
		'coverage-final.json',
	);

	try {
		let normalizedTotal: CoverageSummary | undefined;

		const { default: coverageData } = await import(finalCoveragePath, {
			with: { type: 'json' },
		});

		// Derive from coverage-final using istanbul-lib-coverage
		const coverageMap = createCoverageMap(coverageData);
		const summary = coverageMap.getCoverageSummary().toJSON();
		const coverageJson = coverageMap.toJSON();

		coverageFiles = {};

		for (const filePath of Object.keys(coverageJson)) {
			if (filePath === 'total') continue;
			const fileCoverage = coverageMap.fileCoverageFor(filePath);
			const fileSummary = fileCoverage.toSummary().toJSON();
			let source: string | undefined;
			try {
				source = await fs.readFile(filePath, 'utf8');
			} catch {
				source = undefined;
			}

			let lineHits: Record<string, number> | undefined;
			let branchesByLine:
				| Record<string, { covered: number | null; total: number | null }>
				| undefined;
			try {
				lineHits = fileCoverage.getLineCoverage() as Record<string, number>;
				const branches = fileCoverage.getBranchCoverageByLine?.();
				if (branches && typeof branches === 'object') {
					branchesByLine = {};
					for (const [line, data] of Object.entries(
						branches as Record<string, any>,
					)) {
						branchesByLine[line] = {
							covered: data.covered ?? null,
							total: data.total ?? null,
						};
					}
				}
			} catch {
				log.warning(`Failed to get branch coverage for file ${filePath}`);
			}

			coverageFiles[filePath] = {
				branches: { pct: fileSummary.branches.pct },
				functions: { pct: fileSummary.functions.pct },
				lines: { pct: fileSummary.lines.pct },
				statements: { pct: fileSummary.statements.pct },
				lineHits,
				branchesByLine,
				source,
			};
		}
		normalizedTotal = {
			branches: { pct: summary.branches.pct },
			functions: { pct: summary.functions.pct },
			lines: { pct: summary.lines.pct },
			statements: { pct: summary.statements.pct },
		};

		coverage = {
			branches: normalizedTotal.branches?.pct ?? null,
			functions: normalizedTotal.functions?.pct ?? null,
			lines: normalizedTotal.lines?.pct ?? null,
			statements: normalizedTotal.statements?.pct ?? null,
		};

		const targetCoveragePath = path.join(
			resultsPath,
			'coverage',
			'coverage-summary.json',
		);
		await fs.mkdir(path.dirname(targetCoveragePath), { recursive: true });
		await fs.writeFile(
			targetCoveragePath,
			JSON.stringify({ total: normalizedTotal }, null, 2),
		);

		await fs.writeFile(
			path.join(resultsPath, 'coverage', 'coverage-final.json'),
			JSON.stringify(coverageFiles, null, 2),
		);
	} catch {
		log.warning(`Failed to compute coverage for project ${projectPath}`);
		coverage = undefined;
		coverageFiles = undefined;
	}

	return { coverage, coverageFiles };
}
