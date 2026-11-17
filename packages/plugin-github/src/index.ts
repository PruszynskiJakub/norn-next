/**
 * The GitHub plugin: a tracker over issues and a forge over pull requests, both through the `gh` CLI
 * the host runs. Neither is a state store; labels it writes are display for people.
 */
import { defineNornPlugin, type ForgeFactory, type TrackerFactory } from "@norn/plugin-api";
import { GithubConfig } from "./config.ts";
import { createGithubForge } from "./forge.ts";
import { createGithubTracker } from "./tracker.ts";

export { GithubConfig, REPO_PATTERN } from "./config.ts";
export { classify } from "./failure.ts";
export { BRANCHES_PER_QUERY, changesQuery, createGithubForge, summarize } from "./forge.ts";
export { GH_TIMEOUT_MS } from "./gh.ts";
export { hasMarker, isReceiptId, RECEIPT_ID_PATTERN, receiptMarker, stripMarkers } from "./marker.ts";
export { createGithubTracker, GITHUB_KEY_PREFIX } from "./tracker.ts";

export const PLUGIN_NAME = "norn-github";

export const githubTrackerFactory: TrackerFactory<typeof GithubConfig> = Object.freeze({
  configSchema: GithubConfig,
  create: createGithubTracker,
});

export const githubForgeFactory: ForgeFactory<typeof GithubConfig> = Object.freeze({
  configSchema: GithubConfig,
  create: createGithubForge,
});

/** `^1.1`: the tracker and forge slots joined the plugin API in 1.1. */
export const githubPlugin = defineNornPlugin({
  name: PLUGIN_NAME,
  api: "^1.1",
  provides: { tracker: { github: githubTrackerFactory }, forge: { github: githubForgeFactory } },
});
