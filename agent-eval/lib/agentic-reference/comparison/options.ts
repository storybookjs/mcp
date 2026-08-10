export interface CompareOptions {
	control: string | undefined;
	cases: string | undefined;
	workflows: string | undefined;
	minRuns: number;
	allBatches: boolean;
	out: string | undefined;
}

export function parseCompareArgs(argv: string[]): CompareOptions {
	const options: CompareOptions = {
		control: undefined,
		cases: undefined,
		workflows: undefined,
		minRuns: 10,
		allBatches: false,
		out: undefined,
	};
	for (const arg of argv) {
		const [flag, value] = arg.split('=');
		if (flag === '--all-batches') options.allBatches = true;
		else if (flag === '--control' && value) options.control = value;
		else if (flag === '--cases' && value) options.cases = value;
		else if (flag === '--workflows' && value) options.workflows = value;
		else if (flag === '--out' && value) options.out = value;
		else if (flag === '--min-runs' && value) {
			const parsed = Number.parseInt(value, 10);
			if (!Number.isInteger(parsed) || parsed < 1) {
				throw new Error(`--min-runs must be a positive integer; received "${value}"`);
			}
			options.minRuns = parsed;
		} else throw new Error(`Unknown argument "${arg}"`);
	}
	return options;
}
