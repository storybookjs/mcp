/**
 * Tail-friendly streaming log for the `claude` subprocess.
 *
 * Both runners (replay + live-mcp) consume Claude Code's stream-json
 * output one line at a time. While the run is in flight, nothing
 * normally lands on disk until the runner returns and the CLI writes
 * the run record — which means `tail -f` can't show you progress.
 *
 * `openLiveLog(path)` returns a `write(event)` function that appends
 * a pretty-formatted entry per stream-json event, plus `close()` for
 * cleanup. Pass `write` into the runner; pass `close()` in `finally`.
 *
 * Format is opinionated: a `[ts] label:` header line followed by the
 * payload on its own indented line(s), truncated to ~300 chars.
 * Designed for human eyeballing via `tail -f`, not for downstream
 * parsing — the canonical machine-readable transcript is still saved
 * to the run record at the end.
 */
import { createWriteStream, type WriteStream } from 'node:fs';

export interface LiveLog {
	write(event: unknown): void;
	close(): Promise<void>;
}

function ts(): string {
	const d = new Date();
	return (
		`${String(d.getHours()).padStart(2, '0')}:` +
		`${String(d.getMinutes()).padStart(2, '0')}:` +
		`${String(d.getSeconds()).padStart(2, '0')}.` +
		`${String(d.getMilliseconds()).padStart(3, '0')}`
	);
}

function trunc(s: string, n = 300): string {
	const clean = s.replace(/\s+/g, ' ').trim();
	return clean.length <= n ? clean : clean.slice(0, n - 1) + '…';
}

/**
 * One log entry: a `[ts] label:` header line followed by the payload on
 * its own 4-space-indented line(s). Keeping the payload off the header
 * line makes `tail -f` output far easier to scan — the eye can run down
 * the timestamps without long tool args pushing them out of view.
 */
function entry(t: string, label: string, body: string): string {
	const indented = body
		.split('\n')
		.map((l) => `    ${l}`)
		.join('\n');
	return `[${t}] ${label}:\n${indented}`;
}

function formatLine(event: unknown): string {
	const msg = event as any;
	const t = ts();
	if (!msg || typeof msg !== 'object') return `[${t}] (unparseable event)`;

	switch (msg.type) {
		case 'system': {
			const sub = msg.subtype ? ` ${msg.subtype}` : '';
			const tools = Array.isArray(msg.tools) ? ` tools=${msg.tools.length}` : '';
			const mcp = Array.isArray(msg.mcp_servers)
				? ` mcp=${msg.mcp_servers.map((s: any) => s.name).join(',')}`
				: '';
			return `[${t}] system${sub}${tools}${mcp}`;
		}
		case 'assistant': {
			const blocks = msg.message?.content;
			if (!Array.isArray(blocks)) return `[${t}] assistant (empty)`;
			const lines: string[] = [];
			for (const block of blocks) {
				if (block?.type === 'text' && typeof block.text === 'string') {
					lines.push(entry(t, 'assistant', trunc(block.text)));
				} else if (block?.type === 'tool_use' && typeof block.name === 'string') {
					const args =
						block.input && typeof block.input === 'object'
							? trunc(JSON.stringify(block.input), 300)
							: '';
					lines.push(entry(t, 'tool_use', `${block.name}(${args})`));
				} else if (block?.type === 'thinking' && typeof block.thinking === 'string') {
					lines.push(entry(t, 'thinking', trunc(block.thinking)));
				}
			}
			return lines.join('\n');
		}
		case 'user': {
			const blocks = msg.message?.content;
			if (!Array.isArray(blocks)) return `[${t}] user (empty)`;
			const lines: string[] = [];
			for (const block of blocks) {
				if (block?.type === 'tool_result') {
					const content = Array.isArray(block.content)
						? block.content
								.map((c: any) => (typeof c?.text === 'string' ? c.text : JSON.stringify(c)))
								.join(' ')
						: typeof block.content === 'string'
							? block.content
							: JSON.stringify(block.content ?? '');
					const label = block.is_error ? 'tool_result (ERROR)' : 'tool_result';
					lines.push(entry(t, label, trunc(content)));
				}
			}
			return lines.length > 0 ? lines.join('\n') : `[${t}] user (no tool results)`;
		}
		case 'result': {
			const cost = typeof msg.total_cost_usd === 'number' ? `$${msg.total_cost_usd.toFixed(4)}` : '?';
			const inT = msg.usage?.input_tokens ?? '?';
			const outT = msg.usage?.output_tokens ?? '?';
			const dur = typeof msg.duration_ms === 'number' ? `${(msg.duration_ms / 1000).toFixed(1)}s` : '';
			return `[${t}] result: cost=${cost} tokens=in:${inT}/out:${outT}${dur ? ' duration=' + dur : ''}`;
		}
		default:
			return `[${t}] ${msg.type ?? 'unknown'}`;
	}
}

export function openLiveLog(path: string): LiveLog {
	const stream: WriteStream = createWriteStream(path, { flags: 'a' });
	stream.write(`# live agent log — started ${new Date().toISOString()}\n`);
	return {
		write(event) {
			try {
				stream.write(formatLine(event) + '\n');
			} catch {
				// best-effort — never break the run because of a log write
			}
		},
		close() {
			return new Promise((resolve) => {
				stream.end(`# closed ${new Date().toISOString()}\n`, () => resolve());
			});
		},
	};
}
