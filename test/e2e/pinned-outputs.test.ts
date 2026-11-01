/** gh-118 B18, B19: the helpers name their pinned outputs from the repo root, so helpers and outputs can move apart. */
import { expect, test } from "bun:test";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { OBSERVE_SNAPSHOTS_DIR } from "../support/observe-snapshot.ts";
import { REPO_ROOT } from "../support/repo-root.ts";
import { TRANSCRIPTS_DIR } from "../support/transcript.ts";

test("the repo root is the workspace root, found from anywhere below it", () => {
  expect(existsSync(join(REPO_ROOT, "packages", "cli", "package.json"))).toBe(true);
  expect(REPO_ROOT).toBe(join(import.meta.dir, "..", ".."));
});

test("transcripts and observe snapshots are read from their folders under the repo root", () => {
  expect(TRANSCRIPTS_DIR).toBe(join(REPO_ROOT, "test", "e2e", "transcripts"));
  expect(OBSERVE_SNAPSHOTS_DIR).toBe(join(REPO_ROOT, "test", "e2e", "observe-snapshots"));
  expect(readdirSync(TRANSCRIPTS_DIR).sort()).toEqual(["base-sync.txt", "e2e-slice-workflow.txt", "recovery-claim-lost.txt"]);
  expect(readdirSync(OBSERVE_SNAPSHOTS_DIR).sort()).toEqual([
    "fresh-intake.json",
    "gate-waiting.json",
    "merged.json",
    "parked-ask.json",
    "running-slice.json",
  ]);
});
