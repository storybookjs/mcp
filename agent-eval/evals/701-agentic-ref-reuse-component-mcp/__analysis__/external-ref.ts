// Fetch and cache the pinned upstream ref this eval measures against.
//
// Moved out of scripts/analyze-results.mjs, which is now eval-agnostic: which
// repository to fetch is 701's business, not the runner's.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';

export interface ExternalRepoPin {
	repo: string;
	ref: string;
}

/** Keeps interpolated values shell-safe; mirrors lib/agentic-reference/external-repo.ts. */
const SAFE_GITHUB_PATH = /^[\w./-]+$/;

export function validPin(value: unknown): ExternalRepoPin | null {
	if (typeof value !== 'object' || value === null) return null;
	const { repo, ref } = value as { repo?: unknown; ref?: unknown };
	if (typeof repo !== 'string' || !SAFE_GITHUB_PATH.test(repo)) return null;
	if (typeof ref !== 'string' || !SAFE_GITHUB_PATH.test(ref)) return null;
	return { repo, ref };
}

/**
 * A single directory name for a pin. Both halves have their separators escaped:
 * SAFE_GITHUB_PATH admits refs like `heads/main`, which unescaped would turn the
 * slug into a nested path. SHA pins contain no separator, so existing cache
 * directories keep their names.
 */
export function pinSlug({ repo, ref }: ExternalRepoPin): string {
	return `${repo.replace(/\//g, '__')}@${ref.replace(/\//g, '__')}`;
}

const cache = new Map<string, string>();

/**
 * Download and extract a ref, returning its directory. Extraction happens in a
 * scratch directory that is renamed into place only once it fully succeeded: a
 * half-populated cache directory would be trusted forever and would quietly
 * skew every later diff.
 */
export function prepareRef(cacheDir: string, repo: string, ref: string): string {
	const slug = pinSlug({ repo, ref });
	const cached = cache.get(slug);
	if (cached !== undefined) return cached;

	const dir = join(cacheDir, slug);
	if (!existsSync(dir)) {
		mkdirSync(cacheDir, { recursive: true });
		const scratch = `${dir}.partial-${process.pid}`;
		rmSync(scratch, { recursive: true, force: true });
		mkdirSync(scratch, { recursive: true });
		try {
			// execFile, not a shell: repo and ref never reach a command line.
			const tarball = join(scratch, 'source.tar.gz');
			execFileSync('curl', [
				'-fsSL',
				'-o',
				tarball,
				`https://codeload.github.com/${repo}/tar.gz/${ref}`,
			]);
			// --strip-components=1 drops the tarball's top-level <name>-<ref>/ dir.
			execFileSync('tar', ['xzf', tarball, '--strip-components=1', '-C', scratch]);
			rmSync(tarball);
			renameSync(scratch, dir);
		} catch (error) {
			rmSync(scratch, { recursive: true, force: true });
			throw new Error(
				`Failed to fetch ${repo}@${ref}: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	cache.set(slug, dir);
	return dir;
}
