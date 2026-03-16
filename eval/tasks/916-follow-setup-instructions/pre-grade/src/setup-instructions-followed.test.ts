import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import * as path from 'node:path';

function collectSourceFiles(dirPath: string): string[] {
	return readdirSync(dirPath).flatMap((entry) => {
		const entryPath = path.join(dirPath, entry);
		const stats = statSync(entryPath);
		if (stats.isDirectory()) {
			return collectSourceFiles(entryPath);
		}

		return /\.(ts|tsx|css)$/.test(entry) ? [entryPath] : [];
	});
}

function readProjectSource(): string {
	const srcDir = path.join(process.cwd(), 'src');
	return collectSourceFiles(srcDir)
		.map((filePath) => readFileSync(filePath, 'utf-8'))
		.join('\n');
}

describe('setup instructions were applied', () => {
	const sourceText = readProjectSource();

	it('imports the Acme UI stylesheet', () => {
		expect(sourceText).toContain('@acme/ui/styles.css');
	});

	it('wraps the app in AcmeProvider with the documented props', () => {
		expect(sourceText).toContain('AcmeProvider');
		expect(sourceText).toMatch(/theme\s*=\s*(?:\{)?["']midnight["']\}?/);
		expect(sourceText).toMatch(/density\s*=\s*(?:\{)?["']comfortable["']\}?/);
	});

	it('renders inside the documented Acme app root container', () => {
		expect(sourceText).toMatch(/data-acme-app\s*=\s*(?:\{)?["']true["']\}?/);
	});

	it('uses LaunchButton for the requested CTA', () => {
		expect(sourceText).toContain('LaunchButton');
		expect(sourceText).toContain('Mission control');
		expect(sourceText).toContain('Open dashboard');
	});
});
