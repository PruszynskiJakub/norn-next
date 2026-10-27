/** The cockpit model (SPEC-cockpit CP1–CP5): rows, previews and the actions each row offers, as data. */
import { describe, expect, test } from "bun:test";
import type { InboxGroup } from "@norn/core";
import { type CockpitRow, cockpitModel, type InboxEntry, type ProjectView, type StoryView, withInput } from "../src/index.ts";

const AT = "2026-10-27T12:00:00.000Z";

function story(key: string, over: Partial<StoryView> = {}): StoryView {
  return {
    key,
    story: key,
    slice: null,
    title: `Story ${key}`,
    url: `https://github.com/o/r/issues/${key.slice(3)}`,
    workflow: "story",
    mode: "manual",
    effective_mode: "manual",
    mode_downgraded: false,
    claim: { state: "mine", holder: "me@box", expires_at: AT, unclaimed: false },
    status: "parked",
    step: "refine",
    attempt: 1,
    counters: [],
    park: null,
    since: "2026-10-27T11:00:00.000Z",
    age: "1h",
    last_outcome: null,
    next: null,
    updated_at: AT,
    errors: [],
    act_failure: null,
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

const entry = (group: InboxGroup, story: string, over: Partial<InboxEntry> = {}): InboxEntry => ({
  id: `${group}:${story}`,
  group,
  story,
  slice: null,
  step: "refine",
  title: `${group} title`,
  command: "norn trace x",
  since: "2026-10-27T11:30:00.000Z",
  age: "30m",
  ...over,
});

function view(): ProjectView {
  const reach = { worktree: "/repo-worktrees/gh-2-x", agent_session_id: "s2", pane_id: null };
  const groups = {
    your_turn: [entry("your_turn", "gh-1", { command: "norn open gh-1" }), entry("your_turn", "gh-2", { id: "attended:gh-2", command: "cd /wt", reach })],
    answer: [entry("answer", "gh-3", { slice: "gh-3/02", command: 'norn answer gh-3/02 "…"' })],
    approve: [entry("approve", "gh-4", { step: "ready", command: "norn approve gh-4" })],
    unblock: [entry("unblock", "gh-5", { command: "norn unstick gh-5" })],
    check: [entry("check", "gh-4", { command: "norn why gh-4" })],
    unclaimed: [entry("unclaimed", "gh-6", { command: "norn take gh-6" })],
    running: [entry("running", "gh-2")],
    notes: [entry("notes", "gh-4")],
    recently_done: [],
  };
  return {
    at: AT,
    repo: "/repo",
    holder: "me@box",
    runner: "herdr",
    heartbeat: { holder: "me@box", last_tick_at: AT, age: "0s", down: false },
    stories: [
      story("gh-1"),
      story("gh-2"),
      story("gh-3"),
      story("gh-4", { pr: { number: 7, url: "https://github.com/o/r/pull/7", state: "open", is_draft: true, seen_at: AT } }),
      story("gh-5"),
      story("gh-6", { claim: { state: "none", holder: null, expires_at: null, unclaimed: true }, url: null }),
    ],
    inbox: { at: AT, groups, pending: 7 },
    runs: [],
    timeline: {},
    recently_done: [],
    errors: [],
  };
}

const ids = (r: CockpitRow | undefined) => r?.actions.map((a) => a.id);
const row = (rows: CockpitRow[], id: string) => rows.find((r) => r.id === id);

describe("cockpitModel", () => {
  test("rows: what needs you in O1 order, then every story; running, notes and unclaimed are no rows", () => {
    const m = cockpitModel(view(), { places: true, provider: "gh" });
    expect(m.rows.map((r) => r.id)).toEqual(["your_turn:gh-1", "attended:gh-2", "answer:gh-3", "approve:gh-4", "unblock:gh-5", "check:gh-4", "story:gh-1", "story:gh-2", "story:gh-3", "story:gh-4", "story:gh-5", "story:gh-6"]);
    expect(m.header).toEqual({ repo: "/repo", pending: 7, heartbeat: view().heartbeat });
    // stable: a rebuild gives the same ids
    expect(cockpitModel(view(), { places: true, provider: "gh" }).rows.map((r) => r.id)).toEqual(m.rows.map((r) => r.id));
  });

  test("each action exactly where the table says (CP4)", () => {
    const { rows } = cockpitModel(view(), { places: true, provider: "gh" });
    expect(ids(row(rows, "your_turn:gh-1"))).toEqual(["orient", "start", "trace", "issue"]);
    expect(ids(row(rows, "attended:gh-2"))).toEqual(["orient", "agent", "trace", "issue"]);
    expect(ids(row(rows, "answer:gh-3"))).toEqual(["orient", "answer", "trace", "issue"]);
    expect(ids(row(rows, "approve:gh-4"))).toEqual(["orient", "approve", "reject", "trace", "pr", "issue"]);
    expect(ids(row(rows, "unblock:gh-5"))).toEqual(["orient", "unstick", "trace", "issue"]);
    expect(ids(row(rows, "check:gh-4"))).toEqual(["orient", "trace", "pr", "issue"]);
    expect(ids(row(rows, "story:gh-6"))).toEqual(["orient", "trace", "take"]);
    expect(ids(row(rows, "story:gh-1"))).toEqual(["orient", "trace", "issue"]);
  });

  test("effects: verbs with {input}, links, places only when the front end has them", () => {
    const { rows } = cockpitModel(view(), { places: true, provider: "gh" });
    const answer = row(rows, "answer:gh-3")?.actions.find((a) => a.id === "answer");
    expect(answer).toEqual({ id: "answer", label: "answer", key: "a", input: { prompt: "Your answer", required: true }, effect: { kind: "verb", argv: ["answer", "gh-3/02", "{input}"] } });
    if (answer?.effect.kind !== "verb") throw new Error("unreachable");
    expect(withInput(answer.effect.argv, "CSV only")).toEqual(["answer", "gh-3/02", "CSV only"]);
    expect(row(rows, "approve:gh-4")?.actions.find((a) => a.id === "reject")?.effect).toEqual({ kind: "verb", argv: ["approve", "gh-4", "--reject", "--reason", "{input}"] });
    expect(row(rows, "story:gh-4")?.actions.find((a) => a.id === "pr")?.effect).toEqual({ kind: "link", url: "https://github.com/o/r/pull/7" });
    expect(row(rows, "attended:gh-2")?.actions[1]?.effect).toEqual({ kind: "place", place: "agent", story: "gh-2", reach: { worktree: "/repo-worktrees/gh-2-x", agent_session_id: "s2", pane_id: null } });
    expect(row(rows, "story:gh-1")?.actions[0]?.effect).toEqual({ kind: "place", place: "orient", story: "gh-1" });

    const web = cockpitModel(view(), { places: false, provider: "gh" });
    expect(web.rows.flatMap((r) => r.actions).some((a) => a.effect.kind === "place")).toBe(false);
    expect(row(web.rows, "story:gh-1")?.actions[0]?.effect).toEqual({ kind: "verb", argv: ["orient", "gh-1"], show: true });
    expect(ids(row(web.rows, "attended:gh-2"))).toEqual(["orient", "trace", "issue"]);
  });

  test("the preview is the story's orient report, with the item on an item row; plain JSON", () => {
    const m = cockpitModel(view(), { places: true, provider: "glab" });
    const r = row(m.rows, "approve:gh-4");
    expect(r?.preview.report.story).toBe("gh-4");
    expect(r?.preview.report.pr_command).toBe("glab mr view gh-4-x");
    expect(r?.preview.item).toEqual({ title: "approve title", command: "norn approve gh-4" });
    expect(row(m.rows, "story:gh-4")?.preview.item).toBeNull();
    expect(JSON.parse(JSON.stringify(m))).toEqual(m);
  });
});
