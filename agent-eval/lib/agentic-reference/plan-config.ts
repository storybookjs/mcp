// Locating and loading plan configs (plans/<name>.plan.ts), shared by the
// plan runner (scripts/run-plan.ts) and results:compare's --plan scoping.
import { existsSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { AGENT_EVAL_ROOT } from './constants.ts';
import type { RunPlan } from './run-plan.ts';

/**
 * The file a plan spelling names: a bare name (`1-levels-edit`) expands to
 * plans/<name>.plan.ts, and a relative path resolves against the repo root.
 */
export function resolvePlanPath(input: string): string {
	const path = /^[\w-]+$/.test(input) ? join('plans', `${input}.plan.ts`) : input;
	return isAbsolute(path) ? path : resolve(AGENT_EVAL_ROOT, path);
}

/** Loads a plan config module and returns its default-exported RunPlan. */
export async function loadPlanConfig(configPath: string): Promise<RunPlan> {
	if (!existsSync(configPath)) {
		throw new Error(`no plan config at ${relative(AGENT_EVAL_ROOT, configPath)}.`);
	}
	const module: unknown = await import(pathToFileURL(configPath).href);
	const plan = (module as { default?: unknown }).default;
	if (plan === undefined || plan === null || typeof plan !== 'object') {
		throw new Error(
			`${relative(AGENT_EVAL_ROOT, configPath)} must default-export a RunPlan object.`,
		);
	}
	return plan as RunPlan;
}
