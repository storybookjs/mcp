import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { x } from 'tinyexec';
import type { TrialArgs, SupportedModel } from '../../types.ts';
import { CLAUDE_MODEL_MAP } from '../../types.ts';
import type { TranscriptProps } from '../../templates/result-docs/transcript.types.ts';

const JUDGE_RESULT_FILENAME = 'judge.json';
const DEFAULT_JUDGE_PROMPT_FILE = 'judge.md';
const MAX_EVIDENCE_CHARS = 12_000;
const PLACEHOLDER_REGEX = /{{\s*([A-Z_]+)(?::([^}]+))?\s*}}/g;

type JudgeEvaluation = {
	score: number;
	reason: string;
};

type JudgeArtifact = {
	agent: string;
	model: SupportedModel;
	score: number;
	reason: string;
	raw?: string;
	prompt?: {
		judgeInstruction: string;
		renderedTaskPrompt: string;
		effectivePrompt: string;
		fullJudgePrompt: string;
	};
	evidence?: {
		finalAssistantText: string;
		lastUserToolResults?: string;
	};
};

async function fileExists(filePath: string): Promise<boolean> {
	return await fs
		.access(filePath)
		.then(() => true)
		.catch(() => false);
}

function extractFinalAssistantText(transcript: TranscriptProps): string | undefined {
	for (const message of transcript.messages.toReversed()) {
		if (message.type !== 'assistant') continue;
		const text = message.message.content
			.filter((c) => c.type === 'text')
			.map((c) => c.text)
			.join('')
			.trim();
		if (text) return text;
	}
	return undefined;
}

function stripCodeFences(text: string): string {
	const trimmed = text.trim();
	// ```json ... ``` or ``` ... ```
	if (trimmed.startsWith('```')) {
		return trimmed
			.replace(/^```[a-zA-Z]*\s*/m, '')
			.replace(/\s*```\s*$/m, '')
			.trim();
	}
	return trimmed;
}

function extractJsonObject(text: string): string | undefined {
	const cleaned = stripCodeFences(text);
	const firstBrace = cleaned.indexOf('{');
	const lastBrace = cleaned.lastIndexOf('}');
	if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) return undefined;
	return cleaned.slice(firstBrace, lastBrace + 1);
}

export function parseJudgeResult(rawOutput: string): JudgeEvaluation {
	const jsonText = extractJsonObject(rawOutput);
	if (!jsonText) {
		throw new Error('Judge did not return a JSON object');
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(jsonText);
	} catch {
		throw new Error('Judge returned invalid JSON');
	}
	const score = (parsed as any)?.score;
	if (typeof score !== 'number' || Number.isNaN(score)) {
		throw new Error('Judge JSON must include a numeric "score"');
	}

	const reason = (parsed as any)?.reason;
	if (typeof reason !== 'string' || reason.trim().length === 0) {
		throw new Error('Judge JSON must include a non-empty string "reason"');
	}

	return {
		score: Math.max(0, Math.min(1, score)),
		reason: reason.trim(),
	};
}

export async function resolveJudgePromptFile(taskPath: string): Promise<string | undefined> {
	const defaultPath = path.resolve(path.join(taskPath, DEFAULT_JUDGE_PROMPT_FILE));
	return (await fileExists(defaultPath)) ? defaultPath : undefined;
}

function truncateEvidence(content: string, maxChars = MAX_EVIDENCE_CHARS): string {
	if (content.length <= maxChars) return content;
	return `${content.slice(0, maxChars)}\n\n[TRUNCATED ${content.length - maxChars} chars]`;
}

function extractLastUserToolResults(transcript: TranscriptProps): string | undefined {
	for (const message of transcript.messages.toReversed()) {
		if (message.type !== 'user') continue;
		const toolResultText = message.message.content
			.filter((c) => c.type === 'tool_result')
			.map((c) => {
				if (typeof c.content === 'string') return c.content;
				if (Array.isArray(c.content)) {
					return c.content
						.filter((r) => r.type === 'text' && r.text)
						.map((r) => r.text)
						.join('\n');
				}
				return '';
			})
			.filter(Boolean)
			.join('\n\n')
			.trim();

		if (toolResultText) {
			return toolResultText;
		}
	}
	return undefined;
}

function ensureWithinBase(basePath: string, targetPath: string): string {
	const relative = path.relative(basePath, targetPath);
	if (relative.startsWith('..') || path.isAbsolute(relative)) {
		throw new Error(`Path escapes base directory: ${targetPath}`);
	}
	return targetPath;
}

type PromptTemplateContext = {
	projectPath: string;
	resultsPath: string;
	transcript: TranscriptProps;
	finalAssistantText: string;
};

async function readTemplateFile(basePath: string, relativePath: string): Promise<string> {
	const resolvedPath = path.resolve(path.join(basePath, relativePath.trim()));
	ensureWithinBase(basePath, resolvedPath);
	const content = await fs.readFile(resolvedPath, 'utf-8');
	return truncateEvidence(content);
}

export async function renderJudgePromptTemplate(
	taskPrompt: string,
	ctx: PromptTemplateContext,
): Promise<{ renderedPrompt: string; usedPlaceholders: boolean }> {
	let usedPlaceholders = false;
	let output = '';
	let lastIndex = 0;

	for (const match of taskPrompt.matchAll(PLACEHOLDER_REGEX)) {
		const [fullMatch, rawKey, rawArg] = match;
		if (!fullMatch || rawKey === undefined || match.index === undefined) {
			continue;
		}

		output += taskPrompt.slice(lastIndex, match.index);
		lastIndex = match.index + fullMatch.length;

		const key = rawKey.trim();
		const arg = rawArg?.trim();
		usedPlaceholders = true;

		switch (key) {
			case 'TRANSCRIPT_LAST_ASSISTANT_MESSAGE':
				output += truncateEvidence(ctx.finalAssistantText);
				break;
			case 'TRANSCRIPT_LAST_USER_TOOL_RESULTS': {
				const text = extractLastUserToolResults(ctx.transcript) ?? '[No user tool results found]';
				output += truncateEvidence(text);
				break;
			}
			case 'PROJECT_FILE': {
				if (!arg) {
					output += '[Missing PROJECT_FILE path]';
					break;
				}
				output += await readTemplateFile(ctx.projectPath, arg);
				break;
			}
			case 'RESULTS_FILE': {
				if (!arg) {
					output += '[Missing RESULTS_FILE path]';
					break;
				}
				output += await readTemplateFile(ctx.resultsPath, arg);
				break;
			}
			default:
				output += `[Unknown placeholder: ${key}${arg ? `:${arg}` : ''}]`;
				break;
		}
	}

	output += taskPrompt.slice(lastIndex);

	return {
		renderedPrompt: output,
		usedPlaceholders,
	};
}

function buildJudgePrompt(taskPrompt: string): string {
	return `You are an automated evaluator (judge) for an agent run.

TASK-SPECIFIC JUDGING INSTRUCTIONS:
${taskPrompt.trim()}

RESPONSE FORMAT (required):
- Reply with ONLY a single JSON object.
- It MUST have a numeric field "score" between 0 and 1 (inclusive).
- It MUST have a string field "reason" explaining why this score was assigned (short or long paragraph).
- Do not include markdown, code fences, or any other text.

Example:
{"score":0.75,"reason":"The response followed the rubric and clearly handled the semantic vs visual a11y distinction."}`;
}

async function writeJudgeArtifact(resultsPath: string, artifact: JudgeArtifact): Promise<void> {
	await fs.writeFile(
		path.join(resultsPath, JUDGE_RESULT_FILENAME),
		JSON.stringify(artifact, null, 2),
	);
}

async function runJudgeWithCopilotCli({
	prompt,
	model,
	cwd,
}: {
	prompt: string;
	model: SupportedModel;
	cwd: string;
}): Promise<string> {
	const args = ['-p', prompt, '--model', model];
	// Intentionally do NOT pass --allow-all-tools
	const result = await x('copilot', args, {
		nodeOptions: { cwd, stdio: ['ignore', 'pipe', 'pipe'] },
	});
	return String(result.stdout ?? '').trim();
}

async function runJudgeWithClaudeCodeCli({
	prompt,
	model,
	cwd,
}: {
	prompt: string;
	model: SupportedModel;
	cwd: string;
}): Promise<string> {
	const modelFlag =
		model in CLAUDE_MODEL_MAP
			? CLAUDE_MODEL_MAP[model as keyof typeof CLAUDE_MODEL_MAP]
			: undefined;
	if (!modelFlag) {
		throw new Error(`Claude Code judge does not support model: ${model}`);
	}

	const args = ['--print', '--dangerously-skip-permissions', '--model', modelFlag, prompt];
	const result = await x('claude', args, {
		nodeOptions: { cwd, stdio: ['ignore', 'pipe', 'pipe'] },
	});
	return String(result.stdout ?? '').trim();
}

export async function gradeJudge(
	trialArgs: TrialArgs,
): Promise<{ score: number; reason: string; model: SupportedModel; agent: string } | undefined> {
	const { resultsPath, taskPath, projectPath, agent, model } = trialArgs;

	const promptFilePath = await resolveJudgePromptFile(taskPath);
	if (!promptFilePath) {
		return undefined;
	}

	// Read transcript
	const transcriptPath = path.join(resultsPath, 'transcript.json');
	const transcriptContent = await fs.readFile(transcriptPath, 'utf-8');
	const transcript = JSON.parse(transcriptContent) as TranscriptProps;

	const finalAssistantText = extractFinalAssistantText(transcript);
	if (!finalAssistantText) {
		return undefined;
	}

	// Read judge prompt file
	const taskPrompt = await fs.readFile(promptFilePath, 'utf-8');

	const { renderedPrompt, usedPlaceholders } = await renderJudgePromptTemplate(taskPrompt, {
		projectPath,
		resultsPath,
		transcript,
		finalAssistantText,
	});

	const effectivePrompt = usedPlaceholders
		? renderedPrompt
		: `${renderedPrompt.trim()}\n\nEVIDENCE (final assistant response):\n${truncateEvidence(finalAssistantText)}`;

	const judgePrompt = buildJudgePrompt(effectivePrompt);

	let rawOutput = '';
	if (agent === 'copilot-cli') {
		rawOutput = await runJudgeWithCopilotCli({
			prompt: judgePrompt,
			model,
			cwd: projectPath,
		});
	} else if (agent === 'claude-code') {
		rawOutput = await runJudgeWithClaudeCodeCli({
			prompt: judgePrompt,
			model,
			cwd: projectPath,
		});
	} else {
		throw new Error(`Unsupported judge agent: ${String(agent)}`);
	}

	const { score, reason } = parseJudgeResult(rawOutput);
	const lastUserToolResults = extractLastUserToolResults(transcript);

	await writeJudgeArtifact(resultsPath, {
		agent,
		model,
		score,
		reason,
		raw: rawOutput,
		prompt: {
			judgeInstruction: taskPrompt,
			renderedTaskPrompt: renderedPrompt,
			effectivePrompt,
			fullJudgePrompt: judgePrompt,
		},
		evidence: {
			finalAssistantText,
			lastUserToolResults,
		},
	});

	return { score, reason, model, agent };
}
