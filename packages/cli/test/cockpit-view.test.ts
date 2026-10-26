/** The cockpit frame (HC4): aligned rows cut to the width, colour only when asked, full text on `d <n>`. */
import { describe, expect, test } from "bun:test";
import type { InboxEntry, ProjectView } from "@norn/view";
import { parseCockpitLine, planCockpit, toneOf } from "../src/runtime/cockpit.ts";
import { fit, frameItems, freshNotes, itemDetails, newestNote, renderFrame, wrap } from "../src/runtime/cockpit-view.ts";

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
  const groups = { your_turn: [items[2]], answer: [], approve: [], unblock: [items[0], items[1]], check: [], unclaimed: [], running: [], notes: [], recently_done: [] };
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

describe("group headers and styles (NT5)", () => {
  const ESC = "\x1b[";
  const running = entry({ id: "r", group: "running", slice: "gh-1/02", step: "implement", title: "implement #1 (auto)", command: "norn trace gh-1/02" });
  const note = (id: string) => entry({ id, group: "notes", slice: "gh-1/01", step: "qa", title: "qa note on gh-1/01: title length", command: "norn why gh-1/01 --receipt r", cleared_by: "cleared by gh-1 human-qa approval" });
  const done = entry({ id: "d", group: "recently_done", slice: "gh-1/01", step: "$done", title: "done", command: "norn trace gh-1/01" });
  const rows = [running, note("n1"), note("n2"), done];
  function frame(color: boolean) {
    const v = view();
    v.inbox.groups = { ...v.inbox.groups, your_turn: [], unblock: [], running: [running], notes: rows.slice(1, 3), recently_done: [done] };
    return renderFrame(v, rows, { ...opts, color });
  }

  test("each header says what the group holds; NOTES, below RUNNING, says which approval clears it", () => {
    const lines = frame(false).split("\n");
    const header = (g: string) => lines.findIndex((l) => l.startsWith(g));
    expect(lines[header("RUNNING")]).toBe("RUNNING 1  agents and checks at work");
    expect(lines[header("NOTES")]).toBe("NOTES 2  agents' notes for you, no action needed · cleared by gh-1 human-qa approval");
    expect(header("RUNNING")).toBeLessThan(header("NOTES"));
    expect(header("NOTES")).toBeLessThan(header("RECENTLY DONE"));
  });

  test("RUNNING and NOTES rows are not dim; RECENTLY DONE rows are", () => {
    const f = frame(true);
    const row = (title: string) => f.split("\n").find((l) => l.includes(title)) ?? "";
    expect(f).toContain(`${ESC}36mRUNNING${ESC}0m`);
    expect(f).toContain(`${ESC}33mNOTES${ESC}0m`);
    expect(row("implement #1 (auto)")).not.toContain(`${ESC}2mimplement #1`);
    expect(row("implement #1 (auto)")).toContain(`${ESC}1mgh-1/02`);
    expect(row("qa note on gh-1/01")).toContain(`${ESC}1mgh-1/01`);
    expect(row(`${ESC}2mdone${ESC}0m`)).toContain(`${ESC}2mgh-1/01`);
  });
});

describe("Notes as an accordion (HC16)", () => {
  const running = entry({ id: "r", group: "running", slice: "gh-1/07", step: "implement", title: "implement #1 (auto)", command: "norn trace gh-1/07" });
  const note = (id: string, slice: string, since: string) =>
    entry({ id, group: "notes", slice, step: "qa", title: `qa note on ${slice}: ${id}`, command: `norn why ${slice} --receipt r`, since, cleared_by: "cleared by gh-1 human-qa approval" });
  const n1 = note("n1", "gh-1/01", "2026-10-25T10:00:00.000Z");
  const n2 = note("n2", "gh-1/05", "2026-10-25T11:00:00.000Z");
  const n3 = note("n3", "gh-1/01", "2026-10-25T12:00:00.000Z");
  const n4 = note("n4", "gh-1/05", "2026-10-25T11:30:00.000Z");
  const done = entry({ id: "d", group: "recently_done", slice: "gh-1/05", step: "$done", title: "done", command: "norn trace gh-1/05" });
  const all = [running, n1, n2, n3, n4, done];
  function frame(open: boolean, fresh: number) {
    const v = view();
    v.inbox.groups = { ...v.inbox.groups, your_turn: [], unblock: [], running: [running], notes: [n1, n2, n3, n4], recently_done: [done] };
    return renderFrame(v, frameItems(all, open), { ...opts, width: 120, notes: { open, fresh } }).split("\n");
  }

  test("collapsed: one header line with the count, the new ones and how to open; no rows, so nothing to number", () => {
    expect(frameItems(all, false).map((i) => i.id)).toEqual(["r", "d"]);
    const lines = frame(false, 2);
    expect(lines).toContain("▸ NOTES 4 · 2 new  agents' notes for you, no action needed · cleared by gh-1 human-qa approval · o to open");
    expect(lines.some((l) => l.includes("qa note on"))).toBe(false);
    expect(lines.find((l) => l.includes("done") && l.includes("gh-1/05"))).toMatch(/^ {2}2 {2}/);
  });

  test("open: grouped by unit, the unit with the newest note first, each unit's notes in the order left", () => {
    expect(frameItems(all, true).map((i) => i.id)).toEqual(["r", "n1", "n3", "n2", "n4", "d"]);
    const lines = frame(true, 0);
    expect(lines).toContain("▾ NOTES 4  agents' notes for you, no action needed · cleared by gh-1 human-qa approval · o to close");
    expect(lines.find((l) => l.includes("qa note on gh-1/01: n1"))).toMatch(/^ {2}2 {2}gh-1\/01/);
    expect(lines.find((l) => l.includes("qa note on gh-1/05: n4"))).toMatch(/^ {2}5 {2}gh-1\/05/);
  });

  test("new = left after the newest note seen; o toggles", () => {
    expect(freshNotes(all, undefined)).toBe(4);
    expect(freshNotes(all, "2026-10-25T11:00:00.000Z")).toBe(2);
    expect(freshNotes(all, newestNote(all))).toBe(0);
    expect(newestNote(all)).toBe("2026-10-25T12:00:00.000Z");
    expect(newestNote([running])).toBeUndefined();
    expect(planCockpit(parseCockpitLine("o"), all)).toEqual({ kind: "notes" });
    expect(planCockpit(parseCockpitLine("?"), all)).toMatchObject({ text: expect.stringContaining("open or close Notes") });
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
