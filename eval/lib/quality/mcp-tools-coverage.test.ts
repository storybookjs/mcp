import { describe, it, expect } from 'vitest';
import type { TrialArgs, ExecutionSummary, McpToolsSummary, McpToolMetrics } from '../../types.ts';
import { fromMcpToolsCoverage } from './mcp-tools-coverage.ts';

function createTool(
	name: string,
	validation?: { inputMatch?: boolean; outputTokensWithinLimit?: boolean },
): McpToolMetrics {
	return {
		name,
		fullName: `mcp__sb__${name}`,
		callCount: 1,
		totalOutputTokens: 100,
		invocations: [{ input: {}, outputTokens: 100 }],
		validation,
	};
}

function createSummary(opts: {
	tools?: McpToolMetrics[];
	expectedToolCount?: number;
	calledExpectedToolCount?: number;
	allExpectationsPassed?: boolean;
}): McpToolsSummary {
	const tools = opts.tools ?? [];
	return {
		tools,
		totalCalls: tools.length,
		totalOutputTokens: tools.reduce((sum, t) => sum + t.totalOutputTokens, 0),
		expectedToolCount: opts.expectedToolCount,
		calledExpectedToolCount: opts.calledExpectedToolCount,
		allExpectationsPassed: opts.allExpectationsPassed,
	};
}

function calculate(mcpTools: McpToolsSummary | undefined) {
	return fromMcpToolsCoverage({
		trialArgs: {} as TrialArgs,
		execution: {} as ExecutionSummary,
		grading: {
			buildSuccess: true,
			typeCheckErrors: 0,
			lintErrors: 0,
			test: { passed: 0, failed: 0 },
			a11y: { violations: 0 },
			mcpTools,
		},
	});
}

describe('fromMcpToolsCoverage', () => {
	describe('base/edge cases', () => {
		it('returns undefined when no MCP tools used', () => {
			expect(calculate(undefined)).toBeUndefined();
		});

		it('returns undefined when tools array is empty', () => {
			const summary = createSummary({ tools: [] });
			expect(calculate(summary)).toBeUndefined();
		});

		it('returns 1.0 when tools used but no expectations configured', () => {
			const summary = createSummary({
				tools: [createTool('get-documentation')],
			});
			const result = calculate(summary);
			expect(result?.score).toBe(1.0);
		});
	});

	describe('tool presence', () => {
		it('scores 100% when all expected tools called (2/2)', () => {
			const summary = createSummary({
				tools: [createTool('get-documentation', {}), createTool('list-all-documentation', {})],
				expectedToolCount: 2,
				calledExpectedToolCount: 2,
				allExpectationsPassed: true,
			});
			const result = calculate(summary);
			expect(result?.score).toBe(1.0);
		});

		it('scores 50% when some expected tools called (1/2)', () => {
			const summary = createSummary({
				tools: [createTool('get-documentation', {})],
				expectedToolCount: 2,
				calledExpectedToolCount: 1,
				allExpectationsPassed: false,
			});
			const result = calculate(summary);
			expect(result?.score).toBe(0.5);
		});

		it('scores 0% when no expected tools called (0/2)', () => {
			const summary = createSummary({
				tools: [createTool('some-other-tool', {})],
				expectedToolCount: 2,
				calledExpectedToolCount: 0,
				allExpectationsPassed: false,
			});
			const result = calculate(summary);
			expect(result?.score).toBe(0);
		});
	});

	describe('input matching', () => {
		it('scores 100% when all input matches pass (2/2)', () => {
			const summary = createSummary({
				tools: [
					createTool('tool-a', { inputMatch: true }),
					createTool('tool-b', { inputMatch: true }),
				],
				expectedToolCount: 2,
				calledExpectedToolCount: 2,
				allExpectationsPassed: true,
			});
			const result = calculate(summary);
			expect(result?.score).toBe(1.0);
		});

		it('scores 50% input when some matches pass (1/2)', () => {
			const summary = createSummary({
				tools: [
					createTool('tool-a', { inputMatch: true }),
					createTool('tool-b', { inputMatch: false }),
				],
				expectedToolCount: 2,
				calledExpectedToolCount: 2,
				allExpectationsPassed: false,
			});
			const result = calculate(summary);
			expect(result?.score).toBeCloseTo(0.75, 10);
		});

		it('scores 0% input when no matches pass (0/2)', () => {
			const summary = createSummary({
				tools: [
					createTool('tool-a', { inputMatch: false }),
					createTool('tool-b', { inputMatch: false }),
				],
				expectedToolCount: 2,
				calledExpectedToolCount: 2,
				allExpectationsPassed: false,
			});
			const result = calculate(summary);
			expect(result?.score).toBe(0.5);
		});

		it('excludes input weight when not configured', () => {
			const summary = createSummary({
				tools: [createTool('tool-a', {}), createTool('tool-b', {})],
				expectedToolCount: 2,
				calledExpectedToolCount: 2,
				allExpectationsPassed: true,
			});
			const result = calculate(summary);
			expect(result?.score).toBe(1.0);
		});
	});

	describe('token limits', () => {
		it('scores 100% when all token limits pass (2/2)', () => {
			const summary = createSummary({
				tools: [
					createTool('tool-a', { outputTokensWithinLimit: true }),
					createTool('tool-b', { outputTokensWithinLimit: true }),
				],
				expectedToolCount: 2,
				calledExpectedToolCount: 2,
				allExpectationsPassed: true,
			});
			const result = calculate(summary);
			expect(result?.score).toBe(1.0);
		});

		it('scores 50% tokens when some limits pass (1/2)', () => {
			const summary = createSummary({
				tools: [
					createTool('tool-a', { outputTokensWithinLimit: true }),
					createTool('tool-b', { outputTokensWithinLimit: false }),
				],
				expectedToolCount: 2,
				calledExpectedToolCount: 2,
				allExpectationsPassed: false,
			});
			const result = calculate(summary);
			expect(result?.score).toBeCloseTo(0.833, 2);
		});

		it('scores 0% tokens when no limits pass (0/2)', () => {
			const summary = createSummary({
				tools: [
					createTool('tool-a', { outputTokensWithinLimit: false }),
					createTool('tool-b', { outputTokensWithinLimit: false }),
				],
				expectedToolCount: 2,
				calledExpectedToolCount: 2,
				allExpectationsPassed: false,
			});
			const result = calculate(summary);
			expect(result?.score).toBeCloseTo(0.667, 2);
		});

		it('excludes token weight when not configured', () => {
			const summary = createSummary({
				tools: [createTool('tool-a', {}), createTool('tool-b', {})],
				expectedToolCount: 2,
				calledExpectedToolCount: 2,
				allExpectationsPassed: true,
			});
			const result = calculate(summary);
			expect(result?.score).toBe(1.0);
		});
	});

	describe('weight normalization', () => {
		it('normalizes to 100% presence when only presence active', () => {
			const summary = createSummary({
				tools: [createTool('tool-a', {})],
				expectedToolCount: 2,
				calledExpectedToolCount: 1,
				allExpectationsPassed: false,
			});
			const result = calculate(summary);
			expect(result?.score).toBe(0.5);
		});

		it('normalizes presence + input to 50%/50%', () => {
			const summary = createSummary({
				tools: [
					createTool('tool-a', { inputMatch: true }),
					createTool('tool-b', { inputMatch: true }),
				],
				expectedToolCount: 2,
				calledExpectedToolCount: 2,
				allExpectationsPassed: true,
			});
			const result = calculate(summary);
			expect(result?.score).toBe(1.0);
		});

		it('normalizes presence + tokens', () => {
			const summary = createSummary({
				tools: [createTool('tool-a', { outputTokensWithinLimit: false })],
				expectedToolCount: 1,
				calledExpectedToolCount: 1,
				allExpectationsPassed: false,
			});
			const result = calculate(summary);
			expect(result?.score).toBeCloseTo(0.667, 2);
		});

		it('scores 1.0 when all three active and all pass', () => {
			const summary = createSummary({
				tools: [
					createTool('tool-a', { inputMatch: true, outputTokensWithinLimit: true }),
					createTool('tool-b', { inputMatch: true, outputTokensWithinLimit: true }),
				],
				expectedToolCount: 2,
				calledExpectedToolCount: 2,
				allExpectationsPassed: true,
			});
			const result = calculate(summary);
			expect(result?.score).toBe(1.0);
		});

		it('scores 0.0 when all three active and all fail', () => {
			const summary = createSummary({
				tools: [
					createTool('tool-a', { inputMatch: false, outputTokensWithinLimit: false }),
					createTool('tool-b', { inputMatch: false, outputTokensWithinLimit: false }),
				],
				expectedToolCount: 4,
				calledExpectedToolCount: 0,
				allExpectationsPassed: false,
			});
			const result = calculate(summary);
			expect(result?.score).toBe(0);
		});

		it('calculates weighted combo when all three have mixed results', () => {
			const summary = createSummary({
				tools: [
					createTool('tool-a', { inputMatch: true, outputTokensWithinLimit: false }),
					createTool('tool-b', { inputMatch: false, outputTokensWithinLimit: false }),
				],
				expectedToolCount: 2,
				calledExpectedToolCount: 2,
				allExpectationsPassed: false,
			});
			const result = calculate(summary);
			expect(result?.score).toBeCloseTo(0.6, 10);
		});
	});

	describe('combined realistic scenarios', () => {
		it('1/2 tools called, the one called has passing input match', () => {
			const summary = createSummary({
				tools: [createTool('tool-a', { inputMatch: true })],
				expectedToolCount: 2,
				calledExpectedToolCount: 1,
				allExpectationsPassed: false,
			});
			const result = calculate(summary);
			expect(result?.score).toBeCloseTo(0.75, 10);
		});

		it('2/2 tools called, one passes input, one fails token limit', () => {
			const summary = createSummary({
				tools: [
					createTool('tool-a', { inputMatch: true }),
					createTool('tool-b', { outputTokensWithinLimit: false }),
				],
				expectedToolCount: 2,
				calledExpectedToolCount: 2,
				allExpectationsPassed: false,
			});
			const result = calculate(summary);
			expect(result?.score).toBe(0.8);
		});
	});
});
