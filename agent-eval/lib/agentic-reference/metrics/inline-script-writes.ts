// Detect file writes made through inline interpreter scripts.
//
// Agents routinely edit files via `node -e "fs.writeFileSync(...)"` or
// `python3 - <<'EOF' ... EOF` heredocs instead of the structured edit tools.
// Those writes are invisible to both the churn tracker and the tool taxonomy:
// shell-segments deliberately strips heredoc bodies (they are data, not
// commands), and an inline `-e`/`-c` script is a single opaque token.
//
// This is a best-effort static scan, not an interpreter. It recognises the
// write idioms observed in real transcripts — a literal path in write
// position, or one level of variable indirection to a literal — and reports
// `hasWrite` even when no path could be extracted, so callers can still
// classify the act without knowing its target.
import { splitCommandSegments } from '../../utils/shell-segments.ts';

export interface InlineScriptWrites {
	/** The command runs an inline script that writes at least one file. */
	hasWrite: boolean;
	/** Raw path literals found in write position; unresolved targets are omitted. */
	paths: string[];
}

/** Binaries whose inline scripts these patterns understand. */
const INTERPRETERS = new Set(['node', 'python', 'python3']);
/** Flags that carry the script as their next argument, by interpreter. */
const SCRIPT_FLAGS = new Set(['-e', '--eval', '-c']);

const ENV_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

function basename(token: string): string {
	return token.replace(/^.*\//, '');
}

/**
 * Same shape as the segment splitter's heredoc rule, but capturing the
 * invoking line and the body instead of discarding them.
 */
const HEREDOC_WITH_BODY = /^([^\n]*?<<-?\s*['"]?(\w+)['"]?[^\n]*)\n([\s\S]*?)^\t*\2$/gm;

/**
 * Write idioms in write position. Each entry either captures a literal path
 * (`path` group) or an identifier (`ident` group) to resolve against a
 * single-assignment of a string literal elsewhere in the script.
 */
const WRITE_PATTERNS = [
	// fs.writeFileSync('src/a.tsx', ...) / writeFile / appendFileSync
	/\b(?:writeFileSync|writeFile|appendFileSync)\s*\(\s*(?:['"`](?<path>[^'"`]+)['"`]|(?<ident>[A-Za-z_$][\w$.[\]]*))/g,
	// open('src/a.ts', 'w') / open(p, 'a')
	/\bopen\s*\(\s*(?:['"](?<path>[^'"]+)['"]|(?<ident>[A-Za-z_]\w*))\s*,\s*['"][wax]\+?b?['"]/g,
	// Path('src/a.ts').write_text(...) / p.write_text(...)
	/(?:['"](?<path>[^'"]+)['"]\s*\)|\b(?<ident>[A-Za-z_]\w*))\s*\.write_text\s*\(/g,
];

/** The string literal a script assigns to `ident`, or null. */
function resolveAssignment(script: string, ident: string): string | null {
	// `p='src/a.ts'` / `const p = "src/a.ts"` — the first assignment wins; a
	// second one means the variable is reused and the guess is unsafe.
	const assignment = new RegExp(
		`(?:^|[;\\s])(?:const\\s+|let\\s+|var\\s+)?${ident}\\s*=\\s*(['"\`])([^'"\`]+)\\1`,
		'g',
	);
	const matches = [...script.matchAll(assignment)];
	const literal = matches[0]?.[2];
	return matches.length === 1 && literal !== undefined ? literal : null;
}

function collectScriptWrites(script: string, into: InlineScriptWrites): void {
	for (const pattern of WRITE_PATTERNS) {
		for (const match of script.matchAll(pattern)) {
			into.hasWrite = true;
			const { path, ident } = match.groups ?? {};
			if (path !== undefined) {
				into.paths.push(path);
				continue;
			}
			// `Path(...)` in the ident slot is the pathlib constructor whose
			// argument the path group already handles, not a variable.
			if (ident === undefined || ident === 'Path') continue;
			const resolved = resolveAssignment(script, ident);
			if (resolved !== null) into.paths.push(resolved);
		}
	}
}

/** Interpreter heredoc bodies: `python3 - <<'EOF' ... EOF`. */
function collectHeredocScripts(command: string, into: InlineScriptWrites): void {
	for (const match of command.matchAll(HEREDOC_WITH_BODY)) {
		const [, invocation = '', , body = ''] = match;
		const head = invocation
			.trim()
			.split(/\s+/)
			.filter((token) => !ENV_ASSIGNMENT.test(token))
			.at(0);
		if (head !== undefined && INTERPRETERS.has(basename(head))) {
			collectScriptWrites(body, into);
		}
	}
}

/** Inline flag scripts: `node -e '...'`, `python3 -c '...'`. */
function collectFlagScripts(command: string, into: InlineScriptWrites): void {
	for (const segment of splitCommandSegments(command)) {
		const { tokens } = segment;
		const interpreterAt = tokens.findIndex((token) => INTERPRETERS.has(basename(token)));
		if (interpreterAt === -1) continue;
		const flagAt = tokens.findIndex(
			(token, index) => index > interpreterAt && SCRIPT_FLAGS.has(token),
		);
		const script = flagAt === -1 ? undefined : tokens[flagAt + 1];
		if (script !== undefined) collectScriptWrites(script, into);
	}
}

export function detectInlineScriptWrites(command: string): InlineScriptWrites {
	const found: InlineScriptWrites = { hasWrite: false, paths: [] };
	collectHeredocScripts(command, found);
	collectFlagScripts(command, found);
	found.paths = [...new Set(found.paths)];
	return found;
}
