/**
 * `norn status --segment`: one plain line for Herdr's tab bar; inside Herdr a sidebar token on each
 * `<story> orient` workspace and needs-you-first order among them, moving only norn's workspaces.
 */
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { herdr } from "@norn/adapters";
import { planWorkspaceMoves } from "../src/runtime/segment.ts";
import { fakeHerdr } from "./fake-herdr.ts";
import { createHarness, type Harness, issue } from "./harness.ts";
import { runChecked } from "./harness.ts";

setDefaultTimeout(30_000);

/** Apply moves the way Herdr's `workspace.move` does: `index` is a gap in the order with the workspace still in it. */
function apply(order: string[], moves: Array<{ workspace_id: string; index: number }>): string[] {
  const now = [...order];
  for (const m of moves) {
    const from = now.indexOf(m.workspace_id);
    now.splice(from, 1);
    now.splice(m.index > from ? m.index - 1 : m.index, 0, m.workspace_id);
  }
  return now;
}

describe("planWorkspaceMoves", () => {
  test("ours needing you first, inside the slots ours hold; the others stay put; none when the order holds", () => {
    const order = ["a", "o1", "x", "o2", "o3", "y"];
    const moves = planWorkspaceMoves(order, ["o1", "o2", "o3"], new Set(["o3"]));
    expect(apply(order, moves)).toEqual(["a", "o3", "x", "o1", "o2", "y"]);
    expect(moves.every((m) => m.workspace_id.startsWith("o"))).toBe(true);
    expect(planWorkspaceMoves(apply(order, moves), ["o1", "o2", "o3"], new Set(["o3"]))).toEqual([]);
    expect(planWorkspaceMoves(order, [], new Set())).toEqual([]);
    // as recorded on herdr 0.9.5: [w5X w5Y w5Z], w5Z needs you → moves to the front of the three
    expect(apply(["w5X", "w5Y", "w5Z"], planWorkspaceMoves(["w5X", "w5Y", "w5Z"], ["w5X", "w5Y", "w5Z"], new Set(["w5Z"])))).toEqual(["w5Z", "w5X", "w5Y"]);
  });

  test("holds for any order (random)", () => {
    for (let t = 0; t < 2000; t++) {
      const order = Array.from({ length: 1 + (t % 8) }, (_, i) => `w${i}`).sort(() => Math.random() - 0.5);
      const ours = order.filter(() => Math.random() < 0.5);
      const needs = new Set(ours.filter(() => Math.random() < 0.5));
      const after = apply(order, planWorkspaceMoves(order, ours, needs));
      const mine = new Set(ours);
      const others = (a: string[]) => a.flatMap((id, i) => (mine.has(id) ? [] : [`${id}@${i}`]));
      expect(others(after)).toEqual(others(order));
      const oursNow = after.filter((id) => mine.has(id));
      expect(oursNow).toEqual([...oursNow.filter((id) => needs.has(id)), ...oursNow.filter((id) => !needs.has(id))]);
    }
  });
});

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
