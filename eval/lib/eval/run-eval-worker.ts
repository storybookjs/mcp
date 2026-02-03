import {
	runTask,
	type RunTaskParams,
	type RunTaskResult,
} from '../run-task.ts';

type WorkerResult =
	| { ok: true; result: RunTaskResult }
	| { ok: false; error: string; stack?: string };

async function readStdin(): Promise<string> {
	const chunks: Buffer[] = [];
	for await (const chunk of process.stdin) {
		chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
	}
	return Buffer.concat(chunks).toString('utf8');
}

const LOG_PREFIX = '__LOG__:';

/**
 * Intercept stdout/stderr and forward lines to stderr with a prefix so the parent
 * process can capture worker logs while keeping the JSON response clean on stdout.
 */
function interceptOutput(): () => void {
	const originalStdout = process.stdout.write.bind(process.stdout);
	const originalStderr = process.stderr.write.bind(process.stderr);

	const forward = (data: Buffer | string, stream: 'stdout' | 'stderr') => {
		const text = typeof data === 'string' ? data : data.toString('utf8');
		for (const line of text.split(/\r?\n/)) {
			if (!line) continue;
			originalStderr(`${LOG_PREFIX}${stream}:${line}\n`);
		}
		return true;
	};

	process.stdout.write = (chunk: Buffer | string) => forward(chunk, 'stdout');
	process.stderr.write = (chunk: Buffer | string) => forward(chunk, 'stderr');

	return () => {
		process.stdout.write = originalStdout;
		process.stderr.write = originalStderr;
	};
}

try {
	const payloadRaw = await readStdin();
	const params = JSON.parse(payloadRaw) as RunTaskParams;

	const restoreOutput = interceptOutput();
	try {
		const result = await runTask({ ...params, quiet: true });
		const response: WorkerResult = { ok: true, result };
		restoreOutput();
		process.stdout.write(JSON.stringify(response));
	} catch (error) {
		restoreOutput();
		throw error;
	}
} catch (error) {
	const response: WorkerResult = {
		ok: false,
		error: error instanceof Error ? error.message : String(error),
		stack: error instanceof Error ? error.stack : undefined,
	};
	process.stdout.write(JSON.stringify(response));
	process.exit(1);
}
