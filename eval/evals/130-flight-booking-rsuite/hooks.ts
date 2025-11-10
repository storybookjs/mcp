import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import type { Hooks } from '../../types.ts';
import { addDependency } from 'nypm';

const hooks: Hooks = {
  postPrepareExperiment: async (experimentArgs, log) => {
    log.message('Installing the rsuite package');
    await addDependency('rsuite@latest', {
      cwd: experimentArgs.projectPath,
      silent: true,
    });
    log.success('Rsuite package installed');
  },
};

export default hooks;
