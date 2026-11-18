/**
 * The local tracker: stories as files in the repo's machine folder, for a repo with no host. It
 * mints `lt-<id>` keys unless configured otherwise.
 */
import { defineNornPlugin, type TrackerFactory } from "@norn/plugin-api";
import { LocalTrackerConfig } from "./config.ts";
import { createLocalTracker } from "./tracker.ts";

export { DEFAULT_KEY_PREFIX, LocalTrackerConfig } from "./config.ts";
export { type ItemComment, type ItemFile, ItemFrontmatter, isReceiptId, type ParsedItem, parseItem, RECEIPT_ID_PATTERN, renderItem } from "./item-file.ts";
export { createLocalTracker } from "./tracker.ts";

export const PLUGIN_NAME = "norn-tracker-local";

export const localTrackerFactory: TrackerFactory<typeof LocalTrackerConfig> = Object.freeze({
  configSchema: LocalTrackerConfig,
  create: createLocalTracker,
});

export const localTrackerPlugin = defineNornPlugin({ name: PLUGIN_NAME, api: "^1.1", provides: { tracker: { local: localTrackerFactory } } });
