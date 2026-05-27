/**
 * Cheap reverse-import walker for the recorder.
 *
 * Given a list of changed files + a Storybook story index, compute which
 * stories are "affected" by walking import-statements in each story
 * file's source. Depth counts *component* hops: a story file itself
 * being changed is depth 0, the directly-changed component's own story
 * is depth 1, a direct consumer is depth 2, and so on. Hops through
 * re-export barrel files cost 0 so an `index.ts` between two components
 * doesn't inflate the distance. The walker stops at a fixed depth cap.
 *
 * This is intentionally dumb — regex over `import .* from '<spec>'` — but
 * good enough to give the recorder a realistic-looking cascade across
 * small/medium repos without booting Storybook. For accurate cascades on
 * large repos, prefer the live `get-changed-stories` MCP call.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import type { ChangedStory, StoryIndex, CascadeNode } from './schema.ts';

const IMPORT_RE = /(?:^|\n)\s*(?:import|export)\s+[^;]*?from\s+['"]([^'"]+)['"]/g;
const EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs'];

async function fileExists(p: string): Promise<boolean> {
	return fs.access(p).then(() => true).catch(() => false);
}

async function resolveImport(fromFile: string, spec: string): Promise<string | undefined> {
	if (!spec.startsWith('.') && !spec.startsWith('/')) return undefined;
	const base = path.resolve(path.dirname(fromFile), spec);
	for (const ext of ['', ...EXTENSIONS]) {
		const candidate = base + ext;
		if (await fileExists(candidate)) {
			const stat = await fs.stat(candidate);
			if (stat.isFile()) return candidate;
		}
	}
	// index file?
	for (const ext of EXTENSIONS) {
		const candidate = path.join(base, 'index' + ext);
		if (await fileExists(candidate)) return candidate;
	}
	return undefined;
}

async function readImports(file: string): Promise<string[]> {
	let src: string;
	try {
		src = await fs.readFile(file, 'utf-8');
	} catch {
		return [];
	}
	const out: string[] = [];
	for (const m of src.matchAll(IMPORT_RE)) {
		out.push(m[1]!);
	}
	return out;
}

/**
 * A re-export barrel is a file whose whole job is to forward another
 * module's exports — `export * from './Foo'`, `export { Foo } from
 * './Foo'`. Barrels add a spurious hop to the import graph: a component
 * that imports `'../Badge'` (which resolves to `Badge/index.ts`) is a
 * *direct* consumer of Badge, but a naive file-hop count records it one
 * level deeper because of the index file in between. Traversing through
 * a barrel must therefore cost 0 depth.
 *
 * Heuristic: the file has at least one `export … from '…'` re-export
 * and nothing else (comments and whitespace aside). Conservative — an
 * unrecognised shape simply isn't collapsed, which only restores the
 * old, slightly-inflated depth rather than producing a wrong one.
 */
const RE_EXPORT_RE =
	/export\s+(?:\*(?:\s+as\s+[A-Za-z_$][\w$]*)?|(?:type\s+)?\{[^}]*\})\s+from\s+['"][^'"]+['"]\s*;?/g;

export function isReExportBarrel(src: string): boolean {
	const noComments = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
	if (!noComments.match(RE_EXPORT_RE)) return false;
	return noComments.replace(RE_EXPORT_RE, '').trim().length === 0;
}

async function isBarrelFile(file: string, cache: Map<string, boolean>): Promise<boolean> {
	const cached = cache.get(file);
	if (cached !== undefined) return cached;
	let result = false;
	try {
		result = isReExportBarrel(await fs.readFile(file, 'utf-8'));
	} catch {
		result = false;
	}
	cache.set(file, result);
	return result;
}

/**
 * Shortest import-graph distance from a story file down to the nearest
 * changed file. Returns `depth ≥ 0` if reachable, `undefined` otherwise.
 *
 * Depth counts *component* hops, not raw file hops: a hop through a
 * re-export barrel ({@link isReExportBarrel}) costs 0. So:
 *   - `depth 0` — the story file itself was changed.
 *   - `depth 1` — the story of the directly-changed component (`atomic`).
 *   - `depth 2` — a story whose component directly consumes the changed
 *                 component (`consumer`).
 *   - `depth ≥3` — pages / containers further down the graph.
 *
 * Because barrel hops are 0-weight, this is a 0-1 BFS over a deque
 * rather than a plain BFS — 0-cost edges go to the front of the
 * frontier, 1-cost edges to the back, so a node's depth is final the
 * first time it is dequeued. Capped at `maxDepth`.
 */
export async function reachableDepth(
	storyFileAbs: string,
	changedSet: Set<string>,
	repoRoot: string,
	maxDepth: number,
	barrelCache: Map<string, boolean> = new Map(),
): Promise<{ depth: number; chain: string[] } | undefined> {
	if (changedSet.has(storyFileAbs)) return { depth: 0, chain: [] };
	type Item = { file: string; depth: number; chain: string[] };
	const rel = (f: string) => path.relative(repoRoot, f);
	const best = new Map<string, number>([[storyFileAbs, 0]]);
	const deque: Item[] = [{ file: storyFileAbs, depth: 0, chain: [] }];
	while (deque.length > 0) {
		const cur = deque.shift()!;
		// A node may sit in the deque more than once; only the first
		// dequeue (its shortest depth) counts.
		if (cur.depth > (best.get(cur.file) ?? Infinity)) continue;
		if (changedSet.has(cur.file)) {
			// Dequeued ⇒ this is the shortest depth to a changed file.
			return { depth: cur.depth, chain: cur.chain.slice(0, -1) };
		}
		if (cur.depth >= maxDepth) continue;
		const specs = await readImports(cur.file);
		for (const spec of specs) {
			const resolved = await resolveImport(cur.file, spec);
			if (!resolved) continue;
			const stepCost = (await isBarrelFile(resolved, barrelCache)) ? 0 : 1;
			const nextDepth = cur.depth + stepCost;
			if (nextDepth >= (best.get(resolved) ?? Infinity)) continue;
			best.set(resolved, nextDepth);
			const item: Item = {
				file: resolved,
				depth: nextDepth,
				chain: [...cur.chain, rel(resolved)],
			};
			if (stepCost === 0) deque.unshift(item);
			else deque.push(item);
		}
	}
	return undefined;
}

export interface ComputeCascadeResult {
	changedStories: ChangedStory[];
	cascade: CascadeNode[];
}

/**
 * Walks every story in `storyIndex.entries`, computes reachable depth to
 * the nearest changed file. Stories with `depth === 0` get status
 * `modified`; stories reached transitively get `affected`. Stories not
 * reachable within `maxDepth` are excluded.
 */
export async function computeCascade(
	repoRoot: string,
	changedFiles: string[],
	storyIndex: StoryIndex,
	maxDepth = 4,
): Promise<ComputeCascadeResult> {
	const changedAbs = new Set(
		changedFiles.map((f) => path.resolve(repoRoot, f)),
	);
	const changedStories: ChangedStory[] = [];
	const cascade: CascadeNode[] = [];
	// Shared across every story's BFS so each barrel file is read + classified once.
	const barrelCache = new Map<string, boolean>();

	for (const [storyId, entry] of Object.entries(storyIndex.entries)) {
		// Some Storybook index entries are MDX docs — skip those.
		if (!entry.importPath.match(/\.(t|j)sx?$/)) continue;
		const storyAbs = path.resolve(repoRoot, entry.importPath);
		const reachable = await reachableDepth(storyAbs, changedAbs, repoRoot, maxDepth, barrelCache);
		if (!reachable) continue;
		const statusValue =
			reachable.depth === 0 ? 'status-value:modified' : 'status-value:affected';
		changedStories.push({
			storyId,
			statusValue,
			title: entry.title,
			name: entry.name,
			importPath: entry.importPath,
		});
		cascade.push({
			storyId,
			depth: reachable.depth,
			chain: reachable.chain.length > 0 ? reachable.chain : undefined,
		});
	}

	changedStories.sort((a, b) => a.storyId.localeCompare(b.storyId));
	cascade.sort((a, b) => a.depth - b.depth || a.storyId.localeCompare(b.storyId));
	return { changedStories, cascade };
}
