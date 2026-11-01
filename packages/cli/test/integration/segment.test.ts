/**
 * `norn status --segment`: one plain line for Herdr's tab bar; inside Herdr a sidebar token on each
 * `<story> orient` workspace and needs-you-first order among them, moving only norn's workspaces.
 */
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { herdr } from "@norn/adapters";
import { fakeHerdr } from "../../../../test/support/fake-herdr.ts";
import { createHarness, type Harness, issue } from "../../../../test/support/harness.ts";
import { runChecked } from "../../../../test/support/harness.ts";

setDefaultTimeout(30_000);

describe("norn status --segment", () => {
  let c: Harness;
  const wt = () => `${c.root}-worktrees/gh-5-pay-invoices`;
  beforeAll(async () => {
    c = await createHarness();
    expect((await c.norn("init")).exit).toBe(0);
    c.git(["add", "-A"]);
    c.git(["commit", "-q", "-m", "norn init"]);
    c.git(["push", "-q", "origin", "main"]);
    c.remote.issues = [issue(5, "Pay invoices"), issue(6, "Export report")];
    for (let i = 0; i < 3; i++) {
      c.clock.advance(60_000);
      await c.tick();
    }
  });
  afterAll(() => c.cleanup());

  test("one plain line; outside a repository an empty one", async () => {
    const r = await runChecked(["status", "--segment"], { ...c.deps, herdr: null });
    expect(r.exit).toBe(0);
    expect(r.stdout).toMatch(/^norn·[^\n]+ ▶ 2 your turn\n$/);
    const away = mkdtempSync(join(tmpdir(), "norn-segment-"));
    try {
      const out = await runChecked(["status", "--segment"], { ...c.deps, cwd: away, herdr: null });
      expect(out.exit).toBe(0);
      expect(out.stdout).toBe("\n");
    } finally {
      rmSync(away, { recursive: true, force: true });
    }
  });

  test("inside Herdr: a token on each orient workspace of this repo, none on another repo's", async () => {
    const ws = (id: string, label: string, cwd: string): herdr.HerdrWorkspace => ({ workspace_id: id, label, pane_ids: [`${id}:p1`], cwds: [cwd] });
    // w3 is another repo's gh-5: not ours, never labelled or moved
    const h = fakeHerdr([], [ws("w1", "repo", c.root), ws("w2", "gh-6 orient", `${c.root}-worktrees/gh-6-export-report`), ws("w3", "gh-5 orient", "/other-repo-worktrees/gh-5-x"), ws("w4", "gh-5 orient", wt())]);
    const r = await runChecked(["status", "--segment", "--json", "--ttl", "20s"], { ...c.deps, herdr: h.cockpit });
    expect(r.value).toMatchObject({ tokens: 2, moves: 0 });
    expect(h.calls).toEqual([`report workspace w4 {"norn":"▶ your turn"} 20000`, `report workspace w2 {"norn":"▶ your turn"} 20000`]);
  });
});
