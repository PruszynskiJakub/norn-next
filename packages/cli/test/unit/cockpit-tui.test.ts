/**
 * The terminal cockpit over a hand-built view (SPEC-cockpit CP6, CP7): three tabs, each story once, a
 * closed story reads done, section counts, `]` `[` `n`, a NEEDS YOU row says what the story is, and the
 * list takes about 60% of the width.
 */
import { describe, expect, test } from "bun:test";
import type { InboxGroup, RemoteIssue } from "@norn/core";
import { type CockpitModel, cockpitModel, type InboxEntry, type ProjectView, type StoryView } from "@norn/view";
import { handleKey, initialState, parseKeys, renderCockpit, type TuiState } from "../../src/runtime/cockpit-tui.ts";

const AT = "2026-11-01T12:00:00.000Z";

function story(n: number, title: string, over: Partial<StoryView> = {}): StoryView {
  const key = `gh-${n}`;
  return {
    key,
    story: key,
    slice: null,
    title,
    url: `https://github.com/o/r/issues/${n}`,
    workflow: "quick",
    round: 1,
    mode: "auto",
    effective_mode: "auto",
    mode_downgraded: false,
    claim: { state: "mine", holder: "me@box", expires_at: AT, unclaimed: false },
    status: "parked",
    step: "ready",
    step_type: "gate",
    attempt: 1,
    counters: [],
    park: null,
    since: AT,
    age: "1h",
    last_outcome: null,
    next: null,
    updated_at: AT,
    errors: [],
    act_failure: null,
    steps_left: 0,
    branch: `${key}-x`,
    pr: null,
    notes: [],
    base_sync: null,
    story_status: "active",
    spec_dir: `.agents/specs/${key}-x`,
    root: `/repo-worktrees/${key}-x`,
    slices: [],
    ...over,
  };
}

const entry = (group: InboxGroup, n: number, over: Partial<InboxEntry> = {}): InboxEntry => ({
  id: `${group}:gh-${n}`,
  group,
  story: `gh-${n}`,
  slice: null,
  step: "ready",
  title: `${group} instruction of gh-${n}`,
  command: "norn run list x",
  since: AT,
  age: "30m",
  ...over,
});

const issue = (number: number, title: string, assignees: string[]): RemoteIssue => ({
  provider: "gh",
  number,
  url: `https://github.com/o/r/issues/${number}`,
  title,
  body: "",
  state: "open",
  assignees,
  labels: ["norn", "bug"],
  updated_at: AT,
});

function model(backlog?: RemoteIssue[]): CockpitModel {
  const none = { your_turn: [], answer: [], approve: [], unblock: [], check: [], unclaimed: [], running: [], notes: [], recently_done: [] };
  const view: ProjectView = {
    at: AT,
    repo: "/repo",
    holder: "me@box",
    runner: "herdr",
    heartbeat: { holder: "me@box", last_tick_at: AT, age: "0s", down: false },
    stories: [
      story(1, "Pay invoices"),
      story(2, "Ship the export"),
      story(3, "Pick a CSV dialect", { step: "refine", step_type: "agent" }),
      story(4, "Rename the flag", { status: "running", step: "implement", steps_left: 4 }),
      story(5, "Bump the parser", { status: "parked", step: "ci", steps_left: 1, pr: { number: 9, url: "https://github.com/o/r/pull/9", state: "open", is_draft: false, seen_at: AT } }),
      story(6, "Add a dark theme", { status: "not_started", step: null, steps_left: null }),
      story(7, "Closed before it ran", { status: "not_started", step: null, steps_left: null, story_status: "done" }),
      story(8, "Fix the login", { status: "done", step: "$done", steps_left: null, story_status: "done" }),
    ],
    inbox: { at: AT, groups: { ...none, answer: [entry("answer", 3, { step: "refine" })], approve: [entry("approve", 1), entry("approve", 2)] }, pending: 3 },
    runs: [],
    recently_done: [],
    errors: [],
  };
  return cockpitModel(view, { places: false, provider: "gh", ...(backlog ? { backlog: { me: "me", issues: backlog } } : {}) });
}

const look = { width: 150, height: 30, color: false, now: Date.parse(AT), clock: "12:00", version: "0.15.0" };
const frame = (s: TuiState, m = model()) => renderCockpit(m, s, look);
function press(s: TuiState, ...ks: string[]): TuiState {
  const m = model();
  let st = s;
  for (const k of ks.flatMap(parseKeys)) st = handleKey(st, k, m, look).state;
  return st;
}

describe("the cockpit's tabs (CP6, CP7)", () => {
  test("Now: what needs you, then in flight nearest to done first; a story that needs you shows once", () => {
    const f = frame(initialState());
    const lines = f.split("\n");
    expect(lines[0]).toStartWith("norn 0.15.0 · repo  3 need you");
    expect(lines[1]).toBe(" 1 Now 3 need you · 2 in flight │ 2 Backlog 1 │ 3 Done 2 ");
    expect(f).not.toContain("/ to filter");
    expect(f).toContain("NEEDS YOU 3");
    expect(f).toContain("IN FLIGHT 2");
    expect(f).not.toContain("Add a dark theme");
    // gh-1 is listed once, under its item, and the item row says what the story is
    expect(f.match(/gh-1 /g)).toHaveLength(1);
    expect(f).toMatch(/▸ ◆ gh-3 +refine +Pick a CSV dialect +30m/);
    expect(f).toMatch(/ {2}● gh-1 +ready +Pay invoices +30m/);
    expect(f).not.toMatch(/approve +gh-1/);
    // nearest to done first; slices and PR only when there are some
    expect(f.indexOf("gh-5")).toBeLessThan(f.indexOf("gh-4"));
    expect(f).toMatch(/gh-5 +Bump the parser +parked ci · PR #9/);
    expect(f).toMatch(/gh-4 +Rename the flag +running implement *│/);
    expect(f).not.toContain("no slices");
    expect(f).not.toContain("no PR");
    expect(f).toContain("1 2 3 tabs");
  });

  test("Backlog holds what has not started; Done the closed stories, newest first, read done", () => {
    const backlog = frame(press(initialState(), "2"));
    expect(backlog).toContain("BACKLOG 1");
    expect(backlog).toMatch(/▸ gh-6 +Add a dark theme +not started/);
    expect(backlog).not.toContain("Pay invoices");
    const done = frame(press(initialState(), "3"));
    expect(done).toContain("DONE 2");
    expect(done.indexOf("gh-8")).toBeLessThan(done.indexOf("gh-7"));
    expect(done).toMatch(/gh-7 +Closed before it ran +done/);
    expect(done).not.toContain("not started");
    // the preview of a closed story reads done too
    expect(done).toMatch(/│ ✓ done · auto/);
  });

  test("each tab keeps its own selection and filter", () => {
    const s = press(initialState(), "j", "3", "/", "login", "\r");
    expect(s.tab).toBe("done");
    expect(s.filter).toBe("login");
    expect(frame(s)).not.toContain("gh-7");
    const back = press(s, "1");
    expect(back.tab).toBe("now");
    expect(back.selected).toBe("approve:gh-1");
    expect(back.filter).toBe("");
    const again = press(back, "3");
    expect(again.filter).toBe("login");
    // the filter shows in the header while it is in use
    expect(frame(again).split("\n")[0]).toStartWith("filter: login (esc clears)   norn 0.15.0");
    expect(frame(press(again, "/")).split("\n")[0]).toStartWith("/ login▏");
  });

  test("] and [ jump between sections; n goes to the next row of the same kind, round to the top", () => {
    expect(press(initialState(), "]").selected).toBe("story:gh-5");
    expect(press(initialState(), "]", "[").selected).toBe("answer:gh-3");
    expect(press(initialState(), "]", "]").message?.text).toBe("no next section");
    expect(press(initialState(), "j", "n").selected).toBe("approve:gh-2");
    expect(press(initialState(), "j", "n", "n").selected).toBe("approve:gh-1");
    expect(press(initialState(), "]", "n").message?.text).toBe("no other row like this one");
  });

  test("the list takes about 60% of the width", () => {
    const body = frame(initialState()).split("\n")[4] as string;
    expect(body.indexOf("│")).toBe(Math.floor(150 * 0.6) + 1);
  });

  test("Backlog lists the open norn issues not assigned to me under ISSUES; t takes one (CP2, GR1)", () => {
    const m = model([issue(31, "Export to PDF", []), issue(12, "Sort the list", ["someone-else"])]);
    const s = press(initialState(), "2");
    const f = frame(s, m);
    expect(f.split("\n")[1]).toContain("2 Backlog 3");
    expect(f).toContain("BACKLOG 1");
    expect(f).toContain("ISSUES 2");
    expect(f.indexOf("gh-6")).toBeLessThan(f.indexOf("gh-12"));
    expect(f.indexOf("gh-12")).toBeLessThan(f.indexOf("gh-31"));
    expect(f).toMatch(/ {2}gh-12 +Sort the list +norn, bug · someone-else/);
    expect(f).toMatch(/ {2}gh-31 +Export to PDF +norn, bug · unassigned/);
    const onIssue = handleKey(s, { kind: "char", char: "]" }, m, look).state;
    expect(onIssue.selected).toBe("issue:gh-12");
    const shown = frame(onIssue, m);
    expect(shown).toContain("│ gh-12 — Sort the list");
    expect(shown).toContain("not taken in: t assigns it to you");
    expect(shown).toContain("https://github.com/o/r/issues/12");
    expect(shown).toMatch(/t take · i issue/);
    const take = handleKey(onIssue, { kind: "char", char: "t" }, m, look).effect;
    expect(take?.kind === "run" && take.action.effect).toEqual({ kind: "verb", argv: ["story", "take", "gh-12"] });
    // the filter matches an issue's labels too
    expect(frame(press(s, "/", "bug", "\r"), m)).not.toContain("gh-6 ");
  });

  test("an empty Backlog says neither a story nor an issue waits", () => {
    const m = model([]);
    m.rows = m.rows.filter((r) => r.tab !== "backlog");
    expect(frame(press(initialState(), "2"), m)).toContain("no story waits to start, no open issue waits to be taken");
  });
});
