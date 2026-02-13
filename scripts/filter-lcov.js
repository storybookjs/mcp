/**
 * Filters an lcov file to only include source files matching a pattern.
 * Used to strip non-src files (config, dist, etc.) from the e2e coverage report.
 *
 * Usage: node scripts/filter-lcov.js <lcov-file> <pattern>
 * Example: node scripts/filter-lcov.js ./e2e-coverage-report/lcov.info '/src/.+\.tsx?$'
 */
import { readFileSync, writeFileSync } from 'node:fs';

const [file, pattern] = process.argv.slice(2);
const regex = new RegExp(pattern);
const lcov = readFileSync(file, 'utf8');

const filtered = lcov
	.split('end_of_record\n')
	.filter((section) => {
		const match = section.match(/^SF:(.+)$/m);
		return match && regex.test(match[1]);
	})
	.join('end_of_record\n');

writeFileSync(file, filtered + 'end_of_record\n');
