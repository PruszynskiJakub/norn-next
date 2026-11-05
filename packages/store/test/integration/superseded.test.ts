/**
 * gh-195 D11 (B27), review#1 F6: what a crash between a rename aside and its delete leaves — a dot-named
 * `.drop` folder beside the stories' run state or under `superseded/` — is swept by the next tidy prune
 * (never by a dry one) and the next set-aside; a copy with a broken `superseded.json` is still listed.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ulid } from "@norn/schema";
import { bindNornHome, listSuperseded, machineRunsDir, pruneSuperseded, setAsideRecord, storyRunStateDir, supersededDir } from "../../src/index.ts";
import { tmp } from "../helpers.ts";

function checkout(): string {
  const root = tmp();
  Bun.spawnSync(["git", "init", "-q", root]);
  bindNornHome(root, join(tmp("norn-home-"), ".norn"));
  return root;
}
const STORY = { key: "gh-9", spec_dir: ".agents/specs/gh-9-x" };
function leftovers(root: string): string[] {
  const a = join(machineRunsDir(root), ".gh-9.drop-01JFFFFFFFFFFFFFFFFFFFFFFF");
  const b = join(supersededDir(root), `.gh-9-${ulid()}.drop`);
  for (const d of [a, b]) {
    mkdirSync(join(d, "_story"), { recursive: true });
    writeFileSync(join(d, "_story", "state.json"), "{}");
  }
  return [a, b];
}

describe("superseded copies (review#1 F6)", () => {
  test("tidy's prune sweeps .drop leftovers; a dry prune leaves them", () => {
    const root = checkout();
    const left = leftovers(root);
    pruneSuperseded(root, "2026-01-01T00:00:00.000Z", true);
    expect(left.map(existsSync)).toEqual([true, true]);
    pruneSuperseded(root, "2026-01-01T00:00:00.000Z", false);
    expect(left.map(existsSync)).toEqual([false, false]);
  });

  test("a set-aside sweeps them too; a copy whose superseded.json is broken is listed with its holder unknown", () => {
    const root = checkout();
    const left = leftovers(root);
    mkdirSync(join(storyRunStateDir(root, STORY), "_story"), { recursive: true });
    writeFileSync(join(storyRunStateDir(root, STORY), "_story", "state.json"), "{}");
    const name = `gh-9-${ulid()}`;
    const dir = setAsideRecord(root, STORY, name, { story: "gh-9", holder: "bob@b", last_receipt: null, superseded_at: "2026-11-01T00:00:00.000Z" });
    expect(left.map(existsSync)).toEqual([false, false]);
    writeFileSync(join(dir, "superseded.json"), "{ broken");
    expect(listSuperseded(root)).toEqual([expect.objectContaining({ name, story: "gh-9", holder: null })]);
  });
});
