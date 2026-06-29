import { parseTranscript, type EvalRunData } from '@vercel/agent-eval';
import { parseJsonl } from './utils.ts';

export type AgentRunAnalysis = {
	skillInvocations: string[];
	workflow: {
		browserUrls: string[];
		shellCommands: string[];
	};
	transcript: {
		totalRawEvents: number;
		totalParsedToolCalls: number;
		filesRead: string[];
		filesModified: string[];
	};
};

// Codex consults a skill by reading its SKILL.md; Claude invokes it via the
// `Skill` tool. Both are observable without modifying the skill itself.
const SKILL_DOC_PATTERN = /(?:\.claude|\.agents)\/skills\/([a-z0-9-]+)\/SKILL\.md/i;

const BROWSER_TOOL_PATTERN = /browser|playwright|puppeteer|chrome/i;

function commandFromEvent(event: unknown): string | undefined {
	if (!event || typeof event !== 'object') return undefined;

	const record = event as {
		item?: { type?: unknown; command?: unknown };
		tool?: { args?: Record<string, unknown> };
	};

	if (record.item?.type === 'command_execution' && typeof record.item.command === 'string') {
		return record.item.command;
	}

	const command = record.tool?.args?._extractedCommand ?? record.tool?.args?.command;
	return typeof command === 'string' ? command : undefined;
}

/**
 * Agents often run commands through a shell wrapper (`/bin/bash -lc '<cmd>'`,
 * `sh -c "..."`). Unwrap to the inner command so detectors match the real command
 * instead of having to tolerate the wrapper's quoting.
 */
function unwrapShellCommand(command: string): string {
	const match = command.match(
		/^\s*(?:\/\S*\/)?(?:bash|sh|zsh|dash)\s+-\S*c\b\s*(['"])([\s\S]*)\1\s*$/i,
	);
	return match ? match[2] : command;
}

function parseArguments(value: unknown): Record<string, unknown> | undefined {
	if (!value) return undefined;

	if (typeof value === 'string') {
		try {
			const parsed = JSON.parse(value);
			return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
				? (parsed as Record<string, unknown>)
				: undefined;
		} catch {
			return undefined;
		}
	}

	return typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function urlFromArgs(args: Record<string, unknown> | undefined): string | undefined {
	if (!args) return undefined;

	const url = args._extractedUrl ?? args.url ?? args.uri ?? args.href ?? args.endpoint;
	return typeof url === 'string' ? url : undefined;
}

function maybeBrowserUrl(
	toolName: unknown,
	args: Record<string, unknown> | undefined,
): string | undefined {
	return typeof toolName === 'string' && BROWSER_TOOL_PATTERN.test(toolName)
		? urlFromArgs(args)
		: undefined;
}

function browserUrlFromParsedEvent(event: unknown): string | undefined {
	if (!event || typeof event !== 'object') return undefined;

	const record = event as {
		tool?: { args?: Record<string, unknown>; originalName?: unknown };
	};

	return maybeBrowserUrl(record.tool?.originalName, record.tool?.args);
}

function browserUrlFromRawEvent(event: unknown): string | undefined {
	if (!event || typeof event !== 'object') return undefined;

	const record = event as {
		action?: unknown;
		arguments?: unknown;
		function?: { arguments?: unknown; name?: unknown } | string;
		input?: unknown;
		item?: { action?: unknown; type?: unknown; url?: unknown };
		message?: { content?: unknown; tool_calls?: unknown };
		name?: unknown;
		params?: unknown;
		tool?: { args?: Record<string, unknown>; name?: unknown; originalName?: unknown } | string;
	};

	if (record.item?.type && BROWSER_TOOL_PATTERN.test(String(record.item.type))) {
		const itemUrl = record.item.url;
		if (typeof itemUrl === 'string') return itemUrl;
	}

	if (record.tool && typeof record.tool === 'object') {
		const toolUrl = maybeBrowserUrl(record.tool.originalName ?? record.tool.name, record.tool.args);
		if (toolUrl) return toolUrl;
	}

	const directToolName =
		typeof record.function === 'object'
			? record.function.name
			: (record.function ?? record.tool ?? record.name ?? record.action ?? record.item?.action);
	const directArgs =
		typeof record.function === 'object'
			? parseArguments(record.function.arguments)
			: (parseArguments(record.arguments) ??
				parseArguments(record.input) ??
				parseArguments(record.params));
	const directUrl = maybeBrowserUrl(directToolName, directArgs);
	if (directUrl) return directUrl;

	const content = record.message?.content;
	if (Array.isArray(content)) {
		for (const block of content) {
			if (!block || typeof block !== 'object') continue;

			const toolUse = block as { input?: unknown; name?: unknown; type?: unknown };
			if (toolUse.type === 'tool_use') {
				const url = maybeBrowserUrl(toolUse.name, parseArguments(toolUse.input));
				if (url) return url;
			}
		}
	}

	const toolCalls = record.message?.tool_calls;
	if (Array.isArray(toolCalls)) {
		for (const call of toolCalls) {
			if (!call || typeof call !== 'object') continue;

			const toolCall = call as {
				arguments?: unknown;
				function?: { arguments?: unknown; name?: unknown };
				input?: unknown;
				name?: unknown;
			};
			const url = maybeBrowserUrl(
				toolCall.function?.name ?? toolCall.name,
				parseArguments(toolCall.function?.arguments) ??
					parseArguments(toolCall.arguments) ??
					parseArguments(toolCall.input),
			);
			if (url) return url;
		}
	}

	return undefined;
}

function skillName(args: unknown): string | undefined {
	const skill = parseArguments(args)?.skill ?? (args as { skill?: unknown })?.skill;
	return typeof skill === 'string' && skill.trim() ? skill : undefined;
}

/** Claude invokes a skill via a `Skill` tool call in the parsed transcript. */
function skillFromParsedEvent(event: unknown): string | undefined {
	const tool = (event as { tool?: { name?: unknown; originalName?: unknown; args?: unknown } })
		.tool;
	if (!tool || (tool.originalName !== 'Skill' && tool.name !== 'Skill')) return undefined;
	return skillName(tool.args);
}

/** The same `Skill` tool call, read from the raw transcript events. */
function skillFromRawEvent(event: unknown): string | undefined {
	const content = (event as { message?: { content?: unknown } }).message?.content;
	if (!Array.isArray(content)) return undefined;

	for (const block of content) {
		if (!block || typeof block !== 'object') continue;
		const toolUse = block as { type?: unknown; name?: unknown; input?: unknown };
		if (toolUse.type === 'tool_use' && toolUse.name === 'Skill') {
			const skill = skillName(toolUse.input);
			if (skill) return skill;
		}
	}

	return undefined;
}

/** Codex has no skill primitive; it reads `.../skills/<name>/SKILL.md` via a shell command. */
function skillsFromCommand(command: string): string[] {
	return [...command.matchAll(new RegExp(SKILL_DOC_PATTERN, 'gi'))]
		.map((match) => match[1])
		.filter((skill): skill is string => Boolean(skill));
}

export function analyzeAgentRun(runData: EvalRunData, agent: string): AgentRunAnalysis {
	const rawEvents = parseJsonl(runData.transcript);
	const parsed = runData.transcript ? parseTranscript(runData.transcript, agent) : undefined;
	const browserUrls = [
		...(parsed?.events
			.map(browserUrlFromParsedEvent)
			.filter((url): url is string => Boolean(url)) ?? []),
		...rawEvents.map(browserUrlFromRawEvent).filter((url): url is string => Boolean(url)),
	];
	const shellCommands = [
		...(parsed?.summary.shellCommands.map(({ command }) => command) ?? []),
		...rawEvents.map(commandFromEvent).filter((command): command is string => Boolean(command)),
	].map(unwrapShellCommand);
	const uniqueBrowserUrls = [...new Set(browserUrls)];
	const uniqueCommands = [...new Set(shellCommands)];
	const skillInvocations = [
		...new Set([
			...(parsed?.events
				.map(skillFromParsedEvent)
				.filter((skill): skill is string => Boolean(skill)) ?? []),
			...rawEvents.map(skillFromRawEvent).filter((skill): skill is string => Boolean(skill)),
			...uniqueCommands.flatMap(skillsFromCommand),
		]),
	].sort();

	return {
		skillInvocations,
		workflow: {
			browserUrls: uniqueBrowserUrls,
			shellCommands: uniqueCommands,
		},
		transcript: {
			totalRawEvents: rawEvents.length,
			totalParsedToolCalls: parsed?.summary.totalToolCalls ?? 0,
			filesRead: parsed?.summary.filesRead ?? [],
			filesModified: parsed?.summary.filesModified ?? [],
		},
	};
}
