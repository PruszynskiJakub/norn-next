/**
 * `norn status --segment`: one plain line for Herdr's tab bar; inside Herdr a sidebar token on each
 * `<story> orient` workspace and needs-you-first order among them, moving only norn's workspaces.
 */
import { describe, expect, test } from "bun:test";
import { planWorkspaceMoves } from "../../src/runtime/segment.ts";

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
