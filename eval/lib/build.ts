import { x } from 'tinyexec';

export async function build(projectDir: string): Promise<boolean> {
	const result = await x('pnpm', ['build'], {
		nodeOptions: {
			cwd: projectDir,
		},
	});

  return result.exitCode === 0;
}
