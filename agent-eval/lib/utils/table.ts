// Box-drawn tables for the console, in place of console.table.
//
// console.table renders every cell through util.inspect, so a string cell
// comes out quoted — '29.59%' rather than 29.59%. This renders strings bare
// and right-aligns numbers instead.
//
// Columns are the union of the rows' keys, in the order first seen, so the
// caller controls column order by the order it builds its rows in.

/** A value as it should read in a cell, and whether it aligns as a number. */
function render(value: unknown): { text: string; numeric: boolean } {
	if (typeof value === 'number') {
		return { text: String(value), numeric: true };
	}
	if (typeof value === 'string') {
		return { text: value, numeric: false };
	}
	if (value === null) {
		return { text: 'null', numeric: false };
	}
	if (value === undefined) {
		return { text: '', numeric: false };
	}
	// Rendered as JSON rather than the [object Object] a bare String() gives.
	if (typeof value === 'object') {
		return { text: JSON.stringify(value) ?? '', numeric: false };
	}
	return { text: String(value as boolean | bigint | symbol), numeric: false };
}

function columnsOf(rows: ReadonlyArray<Record<string, unknown>>): string[] {
	const columns: string[] = [];
	for (const row of rows) {
		for (const key of Object.keys(row)) {
			if (!columns.includes(key)) {
				columns.push(key);
			}
		}
	}
	return columns;
}

function rule(widths: number[], left: string, middle: string, right: string): string {
	return left + widths.map((width) => '─'.repeat(width + 2)).join(middle) + right;
}

function line(cells: string[], widths: number[], numeric: boolean[]): string {
	const padded = cells.map((cell, index) =>
		numeric[index] ? cell.padStart(widths[index]!) : cell.padEnd(widths[index]!),
	);
	return `│ ${padded.join(' │ ')} │`;
}

/**
 * Renders `rows` as a table. An empty row set renders as the empty string, so a
 * caller can print the result unconditionally without leaving a bare frame.
 */
export function formatTable(rows: ReadonlyArray<Record<string, unknown>>): string {
	const columns = columnsOf(rows);
	if (rows.length === 0 || columns.length === 0) {
		return '';
	}

	const cells = rows.map((row) => columns.map((column) => render(row[column])));
	// A column aligns right only when every value in it is a number.
	const numeric = columns.map((_, index) =>
		cells.every((row) => row[index]!.numeric || row[index]!.text === ''),
	);
	const widths = columns.map((column, index) =>
		Math.max(column.length, ...cells.map((row) => row[index]!.text.length)),
	);

	return [
		rule(widths, '┌', '┬', '┐'),
		line(
			columns,
			widths,
			columns.map(() => false),
		),
		rule(widths, '├', '┼', '┤'),
		...cells.map((row) =>
			line(
				row.map((cell) => cell.text),
				widths,
				numeric,
			),
		),
		rule(widths, '└', '┴', '┘'),
	].join('\n');
}

/** Prints what {@link formatTable} renders; an empty row set prints nothing. */
export function printTable(rows: ReadonlyArray<Record<string, unknown>>): void {
	const rendered = formatTable(rows);
	if (rendered !== '') {
		console.log(rendered);
	}
}
