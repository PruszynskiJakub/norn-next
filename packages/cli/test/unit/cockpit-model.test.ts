/**
 * The cockpit model, pure: a project view in, rows with their actions out. The CLI tests drive the
 * same through `status --watch`.
 */
import { describe, expect, test } from "bun:test";
import { type CockpitModel, cockpitModel, type CockpitRow, withInput } from "../../src/cockpit/model.ts";
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
