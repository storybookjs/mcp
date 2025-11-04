import type { ExperimentArgs } from "../../types";
import envinfo from 'envinfo';
import * as fs from 'fs/promises';
import * as path from 'path';
import { x } from 'tinyexec';

export async function saveEnvironment({resultsPath}: ExperimentArgs, agent: string) {
  const info = JSON.parse(await envinfo.run({
    System: ['OS', 'CPU', 'Memory', 'Shell'],
    Binaries: ['Node', 'Yarn', 'npm', 'pnpm', 'claude'],
  }, {
    json: true,
    showNotFound: true,
  }));

  const commit = (await x('git', ['rev-parse', 'HEAD'])).stdout.trim() ?? 'unknown';

  await fs.writeFile(path.join(resultsPath, 'environment.json'), JSON.stringify({
    agent,
    date: new Date().toISOString(),
    commit,
    ...info,
  }, null, 2));
}
