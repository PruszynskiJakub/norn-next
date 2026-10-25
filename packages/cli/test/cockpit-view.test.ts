/** The cockpit frame (HC4): aligned rows cut to the width, colour only when asked, full text on `d <n>`. */
import { describe, expect, test } from "bun:test";
import type { InboxEntry, ProjectView } from "@norn/view";
import { parseCockpitLine, planCockpit, toneOf } from "../src/runtime/cockpit.ts";
import { fit, itemDetails, renderFrame, wrap } from "../src/runtime/cockpit-view.ts";

const entry = (p: Partial<InboxEntry>): InboxEntry => ({
  id: "i",
  group: "unblock",
  story: "gh-1",
  slice: null,
  step: "slices",
  title: "slices.stuck → $stuck",
  command: "norn unstick gh-1",
  since: "2026-10-25T12:00:00.000Z",
  age: "51m",
  ...p,
});

const LONG = entry({ id: "l", slice: "gh-1/01", step: "implement", title: `implement: ${"the test check runs bun test, but this slice's checks are npm ones ".repeat(4)}`, command: "norn unstick gh-1/01", detail: "more", url: "https://github.com/o/r/issues/1" });
const items = [LONG, entry({}), entry({ id: "w", group: "your_turn", step: "refine", title: "refine: the agent is waiting for you", command: "cd /wt" })];

function view(down = false): ProjectView {
  const groups = { your_turn: [items[2]], answer: [], approve: [], unblock: [items[0], items[1]], check: [], unclaimed: [], running: [], recently_done: [] };
  return {
    at: "2026-10-25T12:51:00.000Z",
    repo: "/src/todoist-app",
    holder: "me@mac",
    runner: "herdr",
    heartbeat: { holder: "me@mac", last_tick_at: "2026-10-25T12:50:00.000Z", age: "1m", down },
    stories: [],
    inbox: { at: "2026-10-25T12:51:00.000Z", groups, pending: 3 },
    runs: [],
    timeline: {},
    recently_done: [],
    errors: [],
  } as unknown as ProjectView;
}

const ordered = [items[2], items[0], items[1]] as InboxEntry[];
const opts = { width: 90, color: false, clock: "13:51:00", interval: "5s", herdr: true };

describe("cockpit frame (HC4)", () => {
  test("groups in O1 order, numbered across groups, one line each within the width, the step not repeated", () => {
    const f = renderFrame(view(), ordered, opts);
    const lines = f.split("\n");
    expect(lines[0]).toStartWith("norn · todoist-app  3 need you");
    expect(lines[0]).toEndWith("tick 1m ago  13:51:00 · every 5s");
    expect(f.indexOf("YOUR TURN 1")).toBeLessThan(f.indexOf("UNBLOCK 2"));
    expect(f).toMatch(/ 1 {2}gh-1 {5}refine {5}the agent is waiting for you/);
    expect(f).toMatch(/ 2 {2}gh-1\/01 {2}implement {2}the test check runs bun test/);
    expect(f).not.toContain("implement  implement:");
    for (const l of lines) expect(l.length).toBeLessThanOrEqual(90);
    expect(f).toContain("→ norn unstick gh-1/01");
    expect(f).not.toContain("\x1b[");
  });

  test("colour per group when asked; a down heartbeat says so; a message keeps its tone", () => {
    const f = renderFrame(view(true), ordered, { ...opts, color: true, message: { text: "refused: norn approve gh-1 — no", tone: "error" } });
    expect(f).toContain("\x1b[1;32mYOUR TURN\x1b[0m");
    expect(f).toContain("\x1b[1;31mUNBLOCK\x1b[0m");
    expect(f).toContain("\x1b[31mno heartbeat for 1m — norn watch\x1b[0m");
    expect(f).toContain("\x1b[31mrefused: norn approve gh-1 — no\x1b[0m");
  });

  test("output wraps at spaces under the rows; outside Herdr the frame says go only shows commands", () => {
    const f = renderFrame(view(), ordered, { ...opts, herdr: false, output: itemDetails(LONG) });
    expect(f).toContain("gh-1/01 · implement · Unblock · 51m");
    expect(f).toContain("$ norn unstick gh-1/01");
    expect(f).toContain("https://github.com/o/r/issues/1");
    expect(f).toContain("outside Herdr: go shows the command (HC8)");
    for (const l of f.split("\n")) expect(l.length).toBeLessThanOrEqual(90);
  });

  test("fit and wrap", () => {
    expect(fit("a  b\nc", 10)).toBe("a b c");
    expect(fit("abcdefgh", 5)).toBe("abcd…");
    expect(wrap("    one two three four", 12)).toEqual(["    one two", "    three", "    four"]);
  });
});

describe("cockpit commands", () => {
  test("d <n> shows the item's full text; ? lists every command", () => {
    expect(planCockpit(parseCockpitLine("d 2"), ordered)).toEqual({ kind: "output", text: itemDetails(LONG) });
    expect(planCockpit(parseCockpitLine("?"), ordered)).toMatchObject({ kind: "output", text: expect.stringContaining("d <n>") });
  });

  test("result tones", () => {
    expect(toneOf("ok: norn approve gh-1")).toBe("ok");
    expect(toneOf("focused w1:p2 (gh-1)")).toBe("ok");
    expect(toneOf("refused: norn take gh-2 — held")).toBe("error");
    expect(toneOf("[1] is not a gate (Approve)")).toBe("error");
    expect(toneOf("$ cd /wt")).toBe("info");
  });
});
