import type { ScoringAnalysis, ScoringRunData } from './types.ts';

export function parseJson(content: string | undefined): unknown {
	if (!content) return undefined;

	try {
		return JSON.parse(content);
	} catch {
		return undefined;
	}
}

export function parseGeneratedJson(runData: ScoringRunData, path: string): unknown {
	return parseJson(runData.generatedFiles?.[path]);
}

export function generatedFileContent(runData: ScoringRunData, path: string): string | undefined {
	return runData.generatedFiles?.[path];
}

export function findGeneratedFileContent(
	runData: ScoringRunData,
	pattern: RegExp,
): string | undefined {
	const match = Object.entries(runData.generatedFiles ?? {}).find(([path]) => pattern.test(path));
	return match?.[1];
}

export function generatedFilePaths(runData: ScoringRunData): string[] {
	return Object.keys(runData.generatedFiles ?? {});
}

export function hasGeneratedFile(runData: ScoringRunData, pattern: RegExp): boolean {
	return generatedFilePaths(runData).some((path) => pattern.test(path));
}

export function hasCommand(analysis: ScoringAnalysis, pattern: RegExp): boolean {
	return analysis.workflow.shellCommands.some((command) => pattern.test(command));
}

export function hasBrowserUrl(analysis: ScoringAnalysis, pattern: RegExp): boolean {
	return analysis.workflow.browserUrls.some((url) => pattern.test(url));
}

export function hasSkillInvocation(analysis: ScoringAnalysis, skill: string): boolean {
	return analysis.skillInvocations.includes(skill);
}

export function collectObjectList(data: unknown, keys: string[]): Array<Record<string, unknown>> {
	if (Array.isArray(data)) {
		return data.filter(
			(item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object',
		);
	}

	if (!data || typeof data !== 'object') {
		return [];
	}

	const record = data as Record<string, unknown>;
	for (const key of keys) {
		const value = record[key];
		if (Array.isArray(value)) {
			return value.filter(
				(item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object',
			);
		}
	}

	return [];
}

export function collectClaudeLaunchConfigs(data: unknown): Array<Record<string, unknown>> {
	return collectObjectList(data, ['configurations', 'launches', 'entries', 'launch']);
}
