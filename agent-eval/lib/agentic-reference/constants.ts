import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Project root on the filesystem, three levels up from this file. Resolved
 * through a URL rather than by joining '..' onto the file's own path, so the
 * parent-directory count stays a single visible segment.
 */
export const AGENT_EVAL_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** Prefix the generated agentic-reference stubs and their results dirs carry. */
export const EXPERIMENT_NAME_PREFIX = 'agentic-ref-';

/** Location of the evals definitions. */
export const EVALS_DIR = join(AGENT_EVAL_ROOT, 'evals');

/** Where an experiment's definition lives, or null when it has none on disk. */
export function experimentDefinition(experiment: string): string | null {
	// Agentic-reference experiments are generated into .agentic-ref/ rather than
	// committed under experiments/, but are otherwise loaded the same way.
	return (
		[
			join(AGENT_EVAL_ROOT, 'experiments', `${experiment}.ts`),
			join(AGENT_EVAL_ROOT, '.agentic-ref', 'experiments', `${experiment}.ts`),
		].find(existsSync) ?? null
	);
}
