import type { Hooks } from "../../types.ts";
import { addDependency } from "nypm";
import { log } from "@clack/prompts";
import { fromComponentUsage } from "../../lib/quality/index.ts";
import { execSync } from "node:child_process";

const hooks: Hooks = {
  postPrepareTrial: async (trialArgs) => {
    log.message("Installing the @janeapp/burrito-design-system package");

    await addDependency("@janeapp/burrito-design-system@latest", {
      cwd: trialArgs.projectPath,
      silent: true,
    });

    log.success("Burrito Design System installed successfully.");

    log.message("Installing Playwright browsers");
    execSync(
      `node node_modules/playwright/cli.js install chromium`,
      { cwd: trialArgs.projectPath, stdio: "ignore" }
    );
    log.success("Playwright browsers installed.");
  },

  calculateQuality: fromComponentUsage,
};

export default hooks;
