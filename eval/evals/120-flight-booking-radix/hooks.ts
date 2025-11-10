import type { Hooks } from '../../types.ts';
import { addDependency } from 'nypm';

const hooks: Hooks = {
  postPrepareExperiment: async (experimentArgs, log) => {
    log.message('Installing the radix-ui package');
    const options = {
      cwd: experimentArgs.projectPath,
      silent: true,
    };
    await addDependency('radix-ui@^1.4.3', options);
    await addDependency('@radix-ui/react-popover@^1.1.15', options);
    await addDependency('@radix-ui/react-toggle@^1.1.10', options);
    await addDependency('@radix-ui/react-toggle-group@^1.1.0', options);
    await addDependency('@radix-ui/colors@^3.0.0', options);

    log.success('Radix UI package installed');
  },
};

export default hooks;
