declare module 'istanbul-lib-coverage' {
	export interface CoverageSummarySection {
		pct: number | null;
	}

	export interface CoverageSummaryData {
		branches: CoverageSummarySection;
		functions: CoverageSummarySection;
		lines: CoverageSummarySection;
		statements: CoverageSummarySection;
		toJSON(): CoverageSummaryData;
	}

	export interface CoverageMap {
		getCoverageSummary(): CoverageSummaryData;
		toJSON(): Record<string, unknown>;
		fileCoverageFor(filePath: string): any;
	}

	export function createCoverageMap(data: unknown): CoverageMap;
}
