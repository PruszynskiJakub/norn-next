/** The plugins the binary ships: a fresh install runs on these without `norn plugin add`. */
import { forgeNonePlugin } from "@norn/forge-none";
import { claudePlugin } from "@norn/harness-claude";
import { labPlugin } from "@norn/harness-lab";
import { piPlugin } from "@norn/harness-pi";
import { packSdlcPlugin } from "@norn/pack-sdlc";
import type { NornPlugin } from "@norn/plugin-api";
import { githubPlugin } from "@norn/plugin-github";
import { headlessRunnerPlugin } from "@norn/runner-headless";
import { herdrRunnerPlugin } from "@norn/runner-herdr";
import { stepsForgePlugin } from "@norn/runtime";
import { localStorePlugin } from "@norn/store-local";
import { refsStorePlugin } from "@norn/store-refs";
import { localTrackerPlugin } from "@norn/tracker-local";
import { vcsGitPlugin } from "@norn/vcs-git";

export const BUNDLED_PLUGINS: readonly NornPlugin[] = Object.freeze([
  vcsGitPlugin,
  githubPlugin,
  localTrackerPlugin,
  forgeNonePlugin,
  localStorePlugin,
  refsStorePlugin,
  claudePlugin,
  piPlugin,
  labPlugin,
  headlessRunnerPlugin,
  herdrRunnerPlugin,
  packSdlcPlugin,
  stepsForgePlugin,
]);

export const bundledNames = (): string[] => BUNDLED_PLUGINS.map((p) => p.name);
