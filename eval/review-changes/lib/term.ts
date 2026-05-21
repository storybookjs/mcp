/**
 * Minimal ANSI styling for CLI output.
 *
 * No-ops when stdout is not a TTY or `NO_COLOR` is set, so piped or
 * redirected output stays plain text. Kept deliberately small — a few
 * weights and colours, used sparingly: bold for section headers, a
 * green/red/yellow accent on outcomes and warnings, dim for scaffolding.
 */
const enabled = !!process.stdout.isTTY && !process.env.NO_COLOR;
const wrap = (code: number) => (s: string) => (enabled ? `\x1b[${code}m${s}\x1b[0m` : s);

export const bold = wrap(1);
export const dim = wrap(2);
export const red = wrap(31);
export const green = wrap(32);
export const yellow = wrap(33);
export const cyan = wrap(36);
