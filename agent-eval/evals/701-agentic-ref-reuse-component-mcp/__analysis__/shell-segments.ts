// Split a shell command into independently classifiable segments.
//
// Compound commands are the norm in agent transcripts: a single Bash call
// routinely chains exploration, an edit and a verification run. Classifying
// the call as a whole would attribute all of it to one bucket, so the tool
// taxonomy needs the parts.
//
// The pipe distinction is the subtle one. `;`, `&&` and `||` separate
// independent commands, but `|` does not: `npx tsc | tail -20` is one act of
// verification whose output is filtered, not verification plus exploration.
// Counting the `tail` as exploration would inflate a lower-is-better metric
// every time an agent trimmed noisy output — penalising the careful ones.
import { tokenizeShellCommand } from '../../../lib/shell-parse.ts';

export interface ShellSegment {
	tokens: string[];
	/** A `>` or `>>` redirect into a path: a write regardless of head binary. */
	redirectsToFile: boolean;
	/** This segment consumes the previous segment's stdout. */
	piped: boolean;
}

const SEPARATORS = new Set(['&&', '||', ';', '|']);

// Heredoc bodies are data, not commands. Left in place, a payload containing
// `rm -rf /` would be tokenised and classified as an edit.
const HEREDOC = /<<-?\s*'?"?(\w+)'?"?[\s\S]*?^\1$/gm;

function stripHeredocBodies(command: string): string {
	return command.replace(HEREDOC, '<<HEREDOC');
}

// `2>&1` and `&>` duplicate a descriptor rather than naming a file; only a
// bare `>`/`>>` (optionally prefixed by a single digit) creates or truncates one.
const FILE_REDIRECT = /^\d?>>?$/;

/**
 * A newline separates commands just as `;` does, but the tokenizer collapses it
 * into ordinary whitespace. Lines are therefore split before tokenising, so
 * that everything after a heredoc — or after any line break — starts a fresh
 * segment instead of being absorbed into the previous command.
 *
 * Backslash continuations are rejoined first: they are one command written
 * across several lines, not several commands.
 */
function commandLines(command: string): string[] {
	return command
		.replace(/\\\n/g, ' ')
		.split('\n')
		.filter((line) => line.trim() !== '');
}

export function splitCommandSegments(command: string): ShellSegment[] {
	const segments: ShellSegment[] = [];

	for (const line of commandLines(stripHeredocBodies(command))) {
		let current: string[] = [];
		let redirectsToFile = false;
		// A line break ends any pipeline, so each line starts unpiped.
		let piped = false;

		const flush = () => {
			if (current.length > 0) {
				segments.push({ tokens: current, redirectsToFile, piped });
			}
			current = [];
			redirectsToFile = false;
		};

		for (const token of tokenizeShellCommand(line)) {
			if (SEPARATORS.has(token)) {
				flush();
				piped = token === '|';
				continue;
			}
			if (FILE_REDIRECT.test(token)) {
				redirectsToFile = true;
				continue;
			}
			// An attached form such as `>/tmp/out` survives tokenisation as one token.
			if (/^\d?>>?[^&]/.test(token)) {
				redirectsToFile = true;
				continue;
			}
			current.push(token);
		}
		flush();
	}

	return segments;
}
