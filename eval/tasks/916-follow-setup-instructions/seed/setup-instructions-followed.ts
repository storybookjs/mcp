import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';

function readSourceFile(relativePath: string): string {
	return readFileSync(path.join(process.cwd(), relativePath), 'utf-8');
}

describe('setup instructions were applied', () => {
	const mainSource = readSourceFile(path.join('src', 'main.tsx'));
	const componentSource = readSourceFile(path.join('src', 'components', 'MissionControl.tsx'));

	it('imports the Acme UI stylesheet from the app entry', () => {
		expect(mainSource).toContain('@acme/ui/styles.css');
	});

	it('wraps the app in AcmeProvider with the documented props', () => {
		expect(mainSource).toContain('AcmeProvider');
		expect(mainSource).toMatch(/theme\s*=\s*(?:\{)?["']midnight["']\}?/);
		expect(mainSource).toMatch(/density\s*=\s*(?:\{)?["']comfortable["']\}?/);
	});

	it('renders inside the documented Acme app root container', () => {
		expect(mainSource).toMatch(/data-acme-app\s*=\s*(?:\{)?["']true["']\}?/);
	});

	it('renders the MissionControl component from the app entry', () => {
		expect(mainSource).toContain('MissionControl');
	});

	it('uses LaunchButton for the requested CTA in the component file', () => {
		expect(componentSource).toContain('LaunchButton');
		expect(componentSource).toContain('Mission control');
		expect(componentSource).toContain('Open dashboard');
	});
});
