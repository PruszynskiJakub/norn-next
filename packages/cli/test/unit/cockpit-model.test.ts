/**
 * The cockpit model and its keys, pure: a project view in, rows with their actions out, and keys
 * stepping the renderer's state over that model. The CLI tests drive the same through `status --watch`.
 */
import { describe, expect, test } from "bun:test";
import { type CockpitModel, cockpitModel, type CockpitRow, withInput } from "../../src/cockpit/model.ts";
import { handleKey, initialState, type Key, parseKeys, type TuiState } from "../../src/cockpit/tui.ts";
import { withRemote } from "../../src/cockpit/watch.ts";
import type { ProjectView, StoryView, UnitView } from "../../src/views.ts";

const unit = (id: string, over: Partial<UnitView> = {}): UnitView => ({ id, step: "build", kind: "agent", attempt: 1, workflow: "story", run: null, waiting: null, pending_receipts: 0, ...over });
const story = (key: string, over: Partial<StoryView> = {}): StoryView => ({ key, title: `story ${key}`, url: null, open: true, claim: null, change: null, units: [unit(key)], ...over });
const view = (stories: StoryView[], intake: ProjectView["intake"] = []): ProjectView => ({ holder: "bob@desk", stories, intake, problems: [] });
const RUN = { id: "01JAAAAAAAAAAAAAAAAAAAAAAA", executor: "claude", started_at: "2026-11-17T10:00:00.000Z", attended: false, activity: null };
const model = (v: ProjectView): CockpitModel => cockpitModel(v, { repo: "/r/app", places: (e) => e === "claude" });
const rowOf = (m: CockpitModel, id: string): CockpitRow => m.rows.find((r) => r.id === id) as CockpitRow;

describe("cockpit model", () => {
  test("a story another machine holds, with a live run in a pane, a change and an item offers enter g t o i", () => {
    const m = model(view([story("gh-5", { claim: { holder: "alice@laptop", expires_at: "2026-11-17T11:00:00.000Z" }, url: "https://x/issues/5", change: { id: 9, state: "open", url: "https://x/pull/9" }, units: [unit("gh-5", { run: RUN })] })]));
    const row = rowOf(m, "story:gh-5");
    expect(row.actions.map((a) => a.key)).toEqual(["enter", "g", "t", "o", "i"]);
    expect(row.actions.map((a) => a.effect)).toEqual([
      { kind: "verb", argv: ["story", "view", "gh-5"], show: true },
      { kind: "attach", unit: "gh-5" },
      { kind: "verb", argv: ["story", "take", "gh-5", "--force", "--reason", "{input}"] },
      { kind: "link", url: "https://x/pull/9" },
      { kind: "link", url: "https://x/issues/5" },
    ]);
    // the take moves a live claim only with --force: the typed reason is the person's confirmation
    expect(row.actions.find((a) => a.key === "t")?.input).toEqual({ prompt: "Take gh-5 from alice@laptop? Why", required: true });
  });

  test("no take for this machine's claim, a run whose executor has no pane gives no g", () => {
    const m = model(view([story("gh-6", { claim: { holder: "bob@desk", expires_at: "2026-11-17T11:00:00.000Z" }, units: [unit("gh-6", { run: { ...RUN, executor: "codex" } })] })]));
    expect(rowOf(m, "story:gh-6").actions.map((a) => a.key)).toEqual(["enter"]);
  });

  test("the answer prompt names the option the unit's next asks for", () => {
    const trust = unit("gh-7", { run: RUN, waiting: { for: "permission", text: "a trust prompt", next: "norn story answer gh-7 yes, or norn run rerun gh-7 if the pane shows something else" } });
    const allow = unit("gh-8", { run: RUN, waiting: { for: "permission", text: "Bash: rm", next: "norn story answer gh-8 <option> (1 allows it, no refuses it)" } });
    const m = model(view([story("gh-7", { units: [trust] }), story("gh-8", { units: [allow] })]));
    expect(rowOf(m, "unit:gh-7").actions.find((a) => a.key === "a")?.input?.prompt).toBe("Option (yes trusts the folder)");
    expect(rowOf(m, "unit:gh-8").actions.find((a) => a.key === "a")?.input?.prompt).toBe("Option (1 allows, no refuses)");
  });

  test("withInput fills the typed text in place of {input}", () => {
    expect(withInput(["story", "take", "gh-5", "--force", "--reason", "{input}"], "alice is away")).toEqual(["story", "take", "gh-5", "--force", "--reason", "alice is away"]);
  });
});

describe("withRemote", () => {
  test("lays the last full read's titles, links, open and change over the local view, and keeps intake no local story took", () => {
    const local = view([story("gh-1", { title: null, open: null })]);
    const full = view([story("gh-1", { title: "Fix login", url: "https://x/issues/1", open: false, change: { id: 3, state: "merged", url: "https://x/pull/3" } })], [
      { key: "gh-1", title: "Fix login", url: null },
      { key: "gh-2", title: "New", url: "https://x/issues/2" },
    ]);
    const merged = withRemote(local, full);
    expect(merged.stories[0]).toMatchObject({ key: "gh-1", title: "Fix login", url: "https://x/issues/1", open: false, change: { id: 3, state: "merged", url: "https://x/pull/3" } });
    expect(merged.intake).toEqual([{ key: "gh-2", title: "New", url: "https://x/issues/2" }]);
    expect(withRemote(local, null)).toBe(local);
  });
});

/** keys typed one after another; the state after the last, and every effect on the way */
function press(m: CockpitModel, typed: string, from: TuiState = initialState()) {
  let state = from;
  const effects: unknown[] = [];
  for (const key of parseKeys(typed)) {
    const step = handleKey(state, key, m);
    state = step.state;
    if (step.effect) effects.push(step.effect);
  }
  return { state, effects };
}

describe("cockpit keys", () => {
  const gate = (id: string) => unit(id, { step: "approve", kind: "gate", waiting: { for: "gate", text: "approve?", next: `norn story approve ${id}` } });
  const m = model(
    view(
      [
        story("gh-1", { units: [gate("gh-1")] }),
        story("gh-2", { units: [unit("gh-2", { waiting: { for: "person", text: "ended stuck", next: "norn run rerun gh-2" } })] }),
        story("gh-3", { units: [gate("gh-3")] }),
        story("gh-4", { title: "Payments", units: [unit("gh-4", { run: RUN })] }),
        story("gh-5", { units: [unit("gh-5", { ended: "done" })] }),
      ],
      [{ key: "gh-9", title: "Intake", url: "https://x/issues/9" }],
    ),
  );

  test("the rows sort what needs you first, then in flight; backlog and done are their own tabs", () => {
    expect(m.rows.map((r) => [r.id, r.tab])).toEqual([
      ["unit:gh-1", "now"],
      ["unit:gh-3", "now"],
      ["unit:gh-2", "now"],
      ["story:gh-4", "now"],
      ["story:gh-5", "done"],
      ["intake:gh-9", "backlog"],
    ]);
  });

  test("2 and 3 show the backlog and done tabs, each keeping its own selection; 1 goes back", () => {
    const backlog = press(m, "2");
    expect(backlog.state.tab).toBe("backlog");
    expect(press(m, "i", backlog.state).effects).toEqual([{ kind: "run", row: rowOf(m, "intake:gh-9"), action: rowOf(m, "intake:gh-9").actions[0] }]);
    expect(press(m, "3").state.tab).toBe("done");
    const back = press(m, "jj2" + "1");
    expect({ tab: back.state.tab, selected: back.state.selected }).toEqual({ tab: "now", selected: "unit:gh-2" });
  });

  test("] and [ move between sections, n to the next row of the same kind", () => {
    expect(press(m, "]").state.selected).toBe("story:gh-4");
    expect(press(m, "][").state.selected).toBe("unit:gh-1");
    expect(press(m, "]]").state.message?.text).toBe("no next section");
    // from the first approve, n skips the stuck unit to the next approve, and wraps around
    expect(press(m, "n").state.selected).toBe("unit:gh-3");
    expect(press(m, "nn").state.selected).toBe("unit:gh-1");
  });

  test("/ filters the shown tab by words, enter keeps the filter, esc clears it", () => {
    const typed = press(m, "/payments\r");
    expect({ filter: typed.state.filter, filtering: typed.state.filtering }).toEqual({ filter: "payments", filtering: false });
    expect(press(m, "y", typed.state).state.message?.text).toBe("no y here: gh-4 offers enter view, g agent");
    expect(press(m, "\x1b", typed.state).state.filter).toBe("");
    expect(press(m, "/nomatch\ry").state.message?.text).toBe("no row matches the filter");
  });

  test("enter runs the row's story view to show in place of the preview; esc closes it, a second esc quits", () => {
    const shown = press(m, "]\r");
    expect(shown.effects).toEqual([{ kind: "run", row: rowOf(m, "story:gh-4"), action: rowOf(m, "story:gh-4").actions[0] }]);
    const open = { ...shown.state, shown: "# gh-4" };
    expect(press(m, "\x1b", open).state.shown).toBeNull();
    expect(press(m, "\x1b\x1b", open).effects).toEqual([{ kind: "quit" }]);
  });

  test("x asks for the reason in the footer and runs reject with it; an empty reason is refused, esc cancels", () => {
    const empty = press(m, "x\r");
    expect(empty.effects).toEqual([]);
    expect(empty.state.message?.text).toBe("What to change: type something first");
    const sent = press(m, "xtests are thin\r");
    expect(sent.effects).toEqual([{ kind: "run", row: rowOf(m, "unit:gh-1"), action: rowOf(m, "unit:gh-1").actions.find((a) => a.key === "x"), input: "tests are thin" }]);
    expect(press(m, "xab\x1b").state).toMatchObject({ prompt: null, message: { text: "cancelled" } });
  });

  test("the wheel over the list moves the selection, over the preview it scrolls it", () => {
    const look = { width: 120, height: 30, color: false, clock: "10:00" };
    const wheel = (x: number): Key => ({ kind: "wheel", dir: "down", x });
    expect(handleKey(initialState(), wheel(5), m, look).state.selected).toBe("unit:gh-3");
    expect(handleKey(initialState(), wheel(110), m, look).state).toMatchObject({ selected: null, scroll: 3 });
  });
});
