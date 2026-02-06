import type { GradingSummary } from '../../types.ts';

export type TestSummary = Pick<GradingSummary['test'], 'passed' | 'failed'>;

export type StoryResult = {
	storyId: string;
	status: 'passed' | 'failed';
};

export type A11yViolations = Record<string, any[]>;

export type CoverageSummary = {
	branches: { pct: number | null };
	functions: { pct: number | null };
	lines: { pct: number | null };
	statements: { pct: number | null };
};

export type CoverageFiles = Record<
	string,
	{
		lineHits?: Record<string, number>;
		branchesByLine?: Record<string, { covered: number | null; total: number | null }>;
		source?: string;
	} & CoverageSummary
>;
