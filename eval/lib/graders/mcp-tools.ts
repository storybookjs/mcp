import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type {
	TranscriptMessage,
	ToolUseContent,
	UserMessage,
} from '../../templates/result-docs/transcript.types.ts';
import type { TranscriptProps } from '../../templates/result-docs/transcript.types.ts';
import type {
	McpToolInvocation,
	McpToolMetrics,
	McpToolsSummary,
	McpToolExpectation,
	TrialArgs,
	TaskConfig,
} from '../../types.ts';

function deepPartialEqual(expected: unknown, actual: unknown): boolean {
	if (Object.is(expected, actual)) {
		return true;
	}

	if (expected === null || actual === null) {
		return expected === actual;
	}

	if (typeof expected !== 'object' || typeof actual !== 'object') {
		return expected === actual;
	}

	if (Array.isArray(expected)) {
		if (!Array.isArray(actual)) return false;
		if (expected.length !== actual.length) return false;
		for (let i = 0; i < expected.length; i++) {
			if (!deepPartialEqual(expected[i], actual[i])) return false;
		}
		return true;
	}

	if (Array.isArray(actual)) {
		return false;
	}

	const expectedRecord = expected as Record<string, unknown>;
	const actualRecord = actual as Record<string, unknown>;

	for (const [key, expectedValue] of Object.entries(expectedRecord)) {
		if (!(key in actualRecord)) return false;
		if (!deepPartialEqual(expectedValue, actualRecord[key])) return false;
	}

	return true;
}

/**
 * Extract the short tool name from a full MCP tool name.
 * E.g., "mcp__storybook__list_components" -> "list_components"
 */
function getShortToolName(fullName: string): string {
	const parts = fullName.split('__');
	return parts.at(-1) ?? fullName;
}

/**
 * Extracts all MCP tool invocations from a transcript.
 * Returns an array of invocations with tool name, input, and output token count.
 */
export function extractMcpToolInvocations(messages: TranscriptMessage[]): McpToolInvocation[] {
	const invocations: McpToolInvocation[] = [];

	for (let i = 0; i < messages.length; i++) {
		const message = messages[i];
		if (message?.type !== 'assistant') continue;

		for (const content of message.message.content) {
			if (content.type !== 'tool_use' || !content.isMCP) continue;

			const toolUse = content as ToolUseContent;

			// Find the corresponding tool_result in a subsequent user message.
			// Due to streaming, there may be multiple assistant message chunks
			// before the user message with tool results arrives.
			let outputTokens = 0;
			for (let j = i + 1; j < messages.length; j++) {
				const candidateMessage = messages[j];
				if (candidateMessage?.type !== 'user') continue;

				const userMsg = candidateMessage as UserMessage;
				const toolResult = userMsg.message.content.find(
					(c) => c.type === 'tool_result' && c.tool_use_id === toolUse.id,
				);
				if (toolResult) {
					// Use the user message's tokenCount as proxy for tool output size
					// Or estimate from content length if no tokenCount available
					if (userMsg.tokenCount !== undefined) {
						// tokenCount includes all tool results in the message,
						// so we divide by number of results for rough estimate
						const resultCount = userMsg.message.content.length;
						outputTokens = Math.round(userMsg.tokenCount / resultCount);
					} else if (typeof toolResult.content === 'string') {
						// Rough estimate: ~4 characters per token
						outputTokens = Math.round(toolResult.content.length / 4);
					} else if (Array.isArray(toolResult.content)) {
						const textContent = toolResult.content
							.filter((c) => c.type === 'text' && c.text)
							.map((c) => c.text ?? '')
							.join('');
						outputTokens = Math.round(textContent.length / 4);
					}
					break; // Found the result, stop searching
				}
			}

			invocations.push({
				name: toolUse.name,
				input: toolUse.input,
				outputTokens,
			});
		}
	}

	return invocations;
}

/**
 * Aggregates MCP tool invocations into metrics per unique tool.
 */
export function aggregateMcpToolMetrics(
	invocations: McpToolInvocation[],
	expectations?: Record<string, McpToolExpectation>,
): McpToolMetrics[] {
	const metricsMap = new Map<string, McpToolMetrics>();

	for (const invocation of invocations) {
		const shortName = getShortToolName(invocation.name);
		let metrics = metricsMap.get(shortName);

		if (!metrics) {
			metrics = {
				name: shortName,
				fullName: invocation.name,
				callCount: 0,
				totalOutputTokens: 0,
				invocations: [],
			};
			metricsMap.set(shortName, metrics);
		}

		metrics.callCount++;
		metrics.totalOutputTokens += invocation.outputTokens;
		metrics.invocations.push({
			input: invocation.input,
			outputTokens: invocation.outputTokens,
		});
	}

	// Apply validation if expectations exist
	if (expectations) {
		for (const [expectedName, expectation] of Object.entries(expectations)) {
			// Find tool that matches using includes()
			for (const [shortName, metrics] of metricsMap.entries()) {
				if (shortName.includes(expectedName) || metrics.fullName.includes(expectedName)) {
					metrics.validation = {};

					if (expectation.minCalls !== undefined) {
						metrics.validation.minCallsMet = metrics.callCount >= expectation.minCalls;
					}
					if (expectation.maxCalls !== undefined) {
						metrics.validation.maxCallsMet = metrics.callCount <= expectation.maxCalls;
					}

					// Check expected calls if configured (all must be present)
					if (expectation.expectedCalls !== undefined && expectation.expectedCalls.length > 0) {
						// Check if each expected call pattern matches at least one invocation.
						// This uses deep partial matching so callers can validate specific inputs (e.g. { a11y: false })
						// without having to specify full, path-dependent arguments.
						metrics.validation.inputMatch = expectation.expectedCalls.every((expectedInput) =>
							metrics.invocations.some((inv) => deepPartialEqual(expectedInput, inv.input)),
						);
					}

					// Check output tokens limit if configured
					if (expectation.maxOutputTokens !== undefined) {
						metrics.validation.outputTokensWithinLimit =
							metrics.totalOutputTokens <= expectation.maxOutputTokens;
					}

					// Once a matching tool is found for this expectation, stop searching other tools
					break;
				}
			}
		}
	}

	return Array.from(metricsMap.values());
}

/**
 * Creates a complete MCP tools summary from transcript messages.
 */
export function extractMcpToolsSummary(
	messages: TranscriptMessage[],
	expectations?: Record<string, McpToolExpectation>,
): McpToolsSummary {
	const invocations = extractMcpToolInvocations(messages);
	const tools = aggregateMcpToolMetrics(invocations, expectations);

	const totalCalls = invocations.length;
	const totalOutputTokens = invocations.reduce((sum, inv) => sum + inv.outputTokens, 0);

	// Check if all expectations passed and count expected vs called tools
	let allExpectationsPassed: boolean | undefined;
	let expectedToolCount: number | undefined;
	let calledExpectedToolCount: number | undefined;

	if (expectations && Object.keys(expectations).length > 0) {
		allExpectationsPassed = true;
		expectedToolCount = Object.keys(expectations).length;
		calledExpectedToolCount = 0;

		for (const expectedName of Object.keys(expectations)) {
			// Find if the expected tool was called
			const matchingTool = tools.find(
				(t) => t.name.includes(expectedName) || t.fullName.includes(expectedName),
			);

			if (!matchingTool) {
				// Expected tool was not called
				allExpectationsPassed = false;
				continue;
			}

			calledExpectedToolCount++;

			if (matchingTool.validation) {
				if (
					matchingTool.validation.minCallsMet === false ||
					matchingTool.validation.maxCallsMet === false ||
					matchingTool.validation.inputMatch === false ||
					matchingTool.validation.outputTokensWithinLimit === false
				) {
					allExpectationsPassed = false;
				}
			}
		}
	}

	return {
		tools,
		totalCalls,
		totalOutputTokens,
		allExpectationsPassed,
		expectedToolCount,
		calledExpectedToolCount,
	};
}

/**
 * Grader function that extracts MCP tools metrics from the transcript.
 * Follows the pattern of other graders in this directory.
 */
export async function gradeMcpTools(trialArgs: TrialArgs): Promise<McpToolsSummary | undefined> {
	const { resultsPath, taskPath } = trialArgs;

	try {
		// Read the transcript
		const transcriptPath = path.join(resultsPath, 'transcript.json');
		const transcriptContent = await fs.readFile(transcriptPath, 'utf-8');
		const transcript: TranscriptProps = JSON.parse(transcriptContent);

		// Load task config to check for expectedMcpTools
		const configPath = path.join(taskPath, 'config.json');
		let taskConfig: TaskConfig = {};
		try {
			const configModule = await import(configPath, { with: { type: 'json' } });
			taskConfig = configModule.default as TaskConfig;
		} catch {
			// No config.json or invalid - that's fine
		}

		const mcpToolsSummary = extractMcpToolsSummary(
			transcript.messages,
			taskConfig.expectedMcpTools,
		);

		// Only return if there were any MCP tool calls
		if (mcpToolsSummary.totalCalls > 0) {
			return mcpToolsSummary;
		}

		return undefined;
	} catch {
		// Transcript may not exist or be invalid - return undefined
		return undefined;
	}
}
