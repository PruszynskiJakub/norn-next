import { describe, expect, test } from "bun:test";
import { type Receipt, ulid } from "@norn/schema";
import { formatInbox, formatStatus, receiptSummary, stepTitle } from "../../src/index.ts";

const NOW = Date.parse("2026-10-23T12:00:00.000Z");
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();

function receipt(over: Record<string, unknown>): Receipt {
  return { receipt_id: ulid(NOW), run_id: null, step: "implement", attempt: 1, at: ago(60), by: "agent", ...over } as Receipt;
}

describe("formatters", () => {
  test("an item line names its step once, also when the title already starts with it (F4)", () => {
    expect(stepTitle("refine", "refine: attended step — work with the agent")).toBe("refine: attended step — work with the agent");
    expect(stepTitle("implement", "implement #2 (queued)")).toBe("implement #2 (queued)");
    expect(stepTitle("plan", "plan is ready (manual): start an agent in the worktree")).toBe("plan is ready (manual): start an agent in the worktree");
    expect(stepTitle("implement", "Which OAuth provider?")).toBe("implement: Which OAuth provider?");
    expect(stepTitle("qa", "quality check failed")).toBe("qa: quality check failed");
    expect(stepTitle(null, "done")).toBe("done");
  });

  test("formatInbox: Notes after Running, its header naming each story's clearing approval once (NT5)", () => {
    const note = (id: string, story: string, cleared_by: string) => ({ id, group: "notes", story, slice: null, step: "qa", title: `qa note on ${story}: x`, command: `norn run view ${story} --receipt r`, since: "", age: "1m", cleared_by });
    const run = { id: "r", group: "running", story: "gh-3", slice: null, step: "qa", title: "qa #1 (auto)", command: "norn run list gh-3", since: "", age: "1m" };
    const notes = [note("a", "gh-1", "cleared by gh-1 human-qa approval"), note("b", "gh-1", "cleared by gh-1 human-qa approval"), note("c", "gh-2", "cleared when the story is done")];
    const v = { stories: [{}], inbox: { at: "", pending: 0, groups: { your_turn: [], answer: [], approve: [], unblock: [], check: [], unclaimed: [], running: [run], notes, recently_done: [] } } } as unknown as Parameters<typeof formatInbox>[0];
    const out = formatInbox(v).split("\n");
    expect(out.indexOf("Running (1) · agents and checks at work")).toBe(0);
    expect(out).toContain("Notes (3) · agents' notes for you, no action needed · cleared by gh-1 human-qa approval; cleared when the story is done");
    // NT6: the header line alone, with the command that lists them; `notes` lists them
    const at = out.indexOf("Notes (3) · agents' notes for you, no action needed · cleared by gh-1 human-qa approval; cleared when the story is done");
    expect(out[at + 1]).toBe("      $ norn status --notes");
    expect(out.some((l) => l.includes("qa note on"))).toBe(false);
    const listed = formatInbox(v, { notes: true });
    expect(listed).toContain("  gh-1       qa note on gh-1: x · 1m");
    expect(listed).not.toContain("norn status --notes");
  });

  test("formatInbox prints paths under home as ~/…", () => {
    const item = { id: "approve:gh-1:qa#1", group: "approve", story: "gh-1", slice: null, step: "human-qa", title: "evidence attached", command: "norn story approve gh-1", since: "", age: "1m", detail: "step qa#1 reported partial (receipt 0009)", full: "Report: /Users/me/wt/runs/_story/receipts/0009-done.json" };
    const v = { inbox: { at: "", pending: 1, groups: { your_turn: [], answer: [], approve: [item], unblock: [], check: [], unclaimed: [], running: [], notes: [], recently_done: [] } } } as unknown as Parameters<typeof formatInbox>[0];
    expect(formatInbox(v, { details: true, home: "/Users/me/" })).toContain("      | Report: ~/wt/runs/_story/receipts/0009-done.json");
    expect(formatInbox(v, { details: true })).toContain("      | Report: /Users/me/wt/runs/_story/receipts/0009-done.json");
  });

  test("empty inbox and empty project", () => {
    const empty = {
      at: "",
      repo: "",
      holder: "",
      runner: null,
      heartbeat: { holder: "", last_tick_at: null, age: null, down: false },
      stories: [],
      inbox: { at: "", pending: 0, groups: { your_turn: [], answer: [], approve: [], unblock: [], check: [], unclaimed: [], running: [], notes: [], recently_done: [] } },
      runs: [],
      recently_done: [],
      errors: [],
    };
    expect(formatInbox(empty)).toBe("Inbox empty — no stories yet.\nLabel an issue `norn` (the config's `remote.label`) and assign it to yourself, then run `norn sync`.\n");
    expect(formatInbox({ ...empty, stories: [{} as never] })).toBe("Inbox empty — nothing needs you.\n");
    expect(formatStatus(empty)).toContain("No stories.");
  });

  test("receiptSummary is one line", () => {
    const r = receipt({ kind: "done", outcome: "done", handoff: "line one\nline two", findings: [{ severity: "minor", title: "x" }] });
    expect(receiptSummary(r)).toBe("done done at implement#1 (1 finding) — line one line two");
  });
});
