/**
 * Overlap between open stories on real git: two stories in flight whose heads change the same
 * file outside their spec folders show one `overlap:<a>:<b>` Check item in `norn status`, read
 * through the view from the cache observe writes (`overlap.json`). The cache is kept per pair of
 * heads: a tick with neither head moved merges nothing again, and moving one head recomputes it.
 */
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { StoryOverlap } from "@norn/core";
import { SPECS_DIR } from "@norn/schema";
import { readOverlapFacts, workflowsDir, writeOverlapFacts } from "@norn/store";
import { createHarness, type Harness, issue } from "../../../../test/support/harness.ts";
import { runStateOf } from "../../../../test/support/run-state.ts";

setDefaultTimeout(60_000);

const HELD = `name: held
start: ready
steps:
  ready:
    type: gate
    outcomes: { approve: $done, reject: $stuck }
`;

const A = "gh-7-add-login-form";
const B = "gh-8-add-signup-form";

describe("overlap between open stories", () => {
  let h: Harness;
  const runs = (dir: string) => runStateOf(join(h.worktree(dir), `${SPECS_DIR}/${dir}`));
  const parked = (dir: string) => h.state(runs(dir))?.step === "ready" && h.state(runs(dir))?.status === "parked";
  const tick = async () => {
    h.clock.advance(10_000);
    await h.tick();
  };
  const commit = (dir: string, text: string) => {
    writeFileSync(join(h.worktree(dir), "shared.txt"), text);
    h.git(["add", "-A"], h.worktree(dir));
    h.git(["commit", "-q", "-m", `edit shared.txt: ${text.trim()}`], h.worktree(dir));
    return h.git(["rev-parse", "HEAD"], h.worktree(dir)).trim();
  };
  const checks = async () => {
    const r = await h.norn("status", "--json");
    expect(r.exit).toBe(0);
    const v = r.value as { groups: Record<string, Array<{ id: string; group: string; title: string }>> };
    return Object.values(v.groups)
      .flat()
      .filter((i) => i.id.startsWith("overlap:"));
  };

  beforeAll(async () => {
    h = await createHarness();
    h.config("provider: gh\nworkflow: held\nmode: auto\n");
    h.recordVersion();
    h.write(join(workflowsDir(h.root), "held.yaml"), HELD);
    writeFileSync(join(h.root, "shared.txt"), "base\n");
    h.git(["add", "-A"]);
    h.git(["commit", "-q", "-m", "norn init"]);
    h.git(["push", "-q", "origin", "main"]);
    h.remote.issues = [issue(7, "Add login form"), issue(8, "Add signup form")];
  });
  afterAll(() => h.cleanup());

  test("one Check item names both stories and the path; the pair is cached per pair of heads", async () => {
    await h.tick();
    h.clock.advance(10_000);
    await h.tick("--sync");
    for (let i = 0; i < 20 && !(parked(A) && parked(B)); i++) await tick();
    expect(parked(A) && parked(B)).toBe(true);
    // in flight with no commits of their own: never compared
    expect(await checks()).toEqual([]);

    const headA = commit(A, "login side\n");
    const headB = commit(B, "signup side\n");
    await tick();
    const items = await checks();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: "overlap:gh-7:gh-8", group: "check" });
    expect(items[0]?.title).toContain("gh-7 and gh-8 both change shared.txt");
    const cached = readOverlapFacts(h.root);
    expect(cached).toEqual([{ stories: ["gh-7", "gh-8"], heads: [headA, headB], paths: ["shared.txt"] }]);

    // neither head moved: the cached entry is used as is, so a marker path in it survives the tick
    const marked: StoryOverlap[] = [{ stories: ["gh-7", "gh-8"], heads: [headA, headB], paths: ["marker.txt"] }];
    writeOverlapFacts(h.root, marked);
    await tick();
    expect(readOverlapFacts(h.root)).toEqual(marked);
    expect((await checks())[0]?.title).toContain("both change marker.txt");

    // one head moves: the pair is merged again, and the marker is gone
    const movedB = commit(B, "login side\n");
    await tick();
    expect(readOverlapFacts(h.root)).toEqual([{ stories: ["gh-7", "gh-8"], heads: [headA, movedB], paths: [] }]);
    // the heads stopped conflicting: the item clears on its own
    expect(await checks()).toEqual([]);
  });
});
