// import * as path from 'node:path';
// import * as fs from 'node:fs/promises';
import type { Hooks } from "../../types.ts";
import { addDependency } from "nypm";
import { log } from "@clack/prompts";

const hooks: Hooks = {
  postPrepareTrial: async (trialArgs) => {
    log.message("Installing the @janeapp/burrito-design-system package");

    await addDependency("@janeapp/burrito-design-system@latest", {
      cwd: trialArgs.projectPath,
      silent: true,
    });

    log.success("Burrito Design System installed successfully.");
  },
};

export default hooks;
