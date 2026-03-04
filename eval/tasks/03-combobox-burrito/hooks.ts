import type { Hooks } from "../../types.ts";
import { addDependency } from "nypm";
import { log } from "@clack/prompts";
import { fromComponentUsage } from "../../lib/quality/index.ts";
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { createRequire } from "node:module";

const hooks: Hooks = {
  postPrepareTrial: async (trialArgs) => {
    log.message("Installing the @janeapp/burrito-design-system package");

    await addDependency("@janeapp/burrito-design-system@latest", {
      cwd: trialArgs.projectPath,
      silent: true,
    });

    log.success("Burrito Design System installed successfully.");

    log.message("Installing Playwright browsers");
    const require = createRequire(import.meta.url);
    const playwrightCli = join(dirname(require.resolve("playwright")), "cli.js");
    const result = spawnSync("node", [playwrightCli, "install", "chromium"], {
      stdio: "pipe",
    });
    if (result.status !== 0) {
      const stderr = result.stderr?.toString() ?? "";
      log.warn(`Playwright install warning: ${stderr || result.error?.message}`);
    } else {
      log.success("Playwright browsers installed.");
    }
  },

  calculateQuality: fromComponentUsage,
};

export default hooks;
