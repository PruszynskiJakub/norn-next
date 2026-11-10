import { describe, expect, test } from "bun:test";
import { buildInbox } from "../../src/inbox/items.ts";
import { versionBaseline } from "../../src/commands.ts";
import { CONFIG, facts, storyFacts, storyUnit, STORY_WF, stateFor, unitFacts, T0, at } from "../fixtures.ts";

// The repo's norn version against the running binary, in the inbox.
const stuck = () => {
  const u = storyUnit("gh-1");
  const st = stateFor(u, STORY_WF, { status: "stuck", park: { kind: "stuck", reason: "broken", since: at(T0 - 60_000) } });
  return storyFacts("gh-1", [unitFacts(u, STORY_WF, st)]);
};

describe("the norn version in the inbox", () => {
  test("B8: an older binary puts a repo-level Unblock item first: install the repo's line", () => {
    const inbox = buildInbox(facts([stuck()], { norn: { running: "0.30.1", repo: "0.31.0" } }), CONFIG);
    const first = inbox.groups.unblock[0];
    expect(first).toMatchObject({ group: "unblock", story: "*", slice: null, step: null, title: "this repo needs norn 0.31.x (you run 0.30.1): install norn 0.31.x" });
    expect(inbox.groups.unblock.length).toBeGreaterThan(1);
  });

  test("B8, B7: a newer binary's item names `norn upgrade`", () => {
    const inbox = buildInbox(facts([], { norn: { running: "0.31.0", repo: "0.30.0" } }), CONFIG);
    const [item] = inbox.groups.unblock;
    expect(item?.title).toBe("this repo needs norn 0.30.x (you run 0.31.0): run `norn upgrade` to move this repo to norn 0.31.0 and commit the change, or install norn 0.30.x");
    expect(item?.command).toBe("norn upgrade");
    expect(inbox.pending).toBe(1);
  });

  test("no version recorded → an Unblock item with the baseline refusal, pointing to norn doctor", () => {
    const inbox = buildInbox(facts([], { norn: { running: "0.31.0", repo: null } }), CONFIG);
    const rule = versionBaseline(null, "0.31.0")!;
    expect(inbox.groups.check).toEqual([]);
    expect(inbox.groups.unblock).toHaveLength(1);
    expect(inbox.groups.unblock[0]).toMatchObject({ story: "*", title: `${rule.error}: ${rule.do_instead}`, command: "norn doctor" });
  });

  test("a version below 0.30 → an Unblock item with the baseline refusal, never the mismatch one", () => {
    const inbox = buildInbox(facts([], { norn: { running: "0.31.0", repo: "0.29.4" } }), CONFIG);
    const rule = versionBaseline("0.29.4", "0.31.0")!;
    expect(inbox.groups.check).toEqual([]);
    expect(inbox.groups.unblock).toHaveLength(1);
    expect(inbox.groups.unblock[0]).toMatchObject({ story: "*", title: `${rule.error}: ${rule.do_instead}`, command: "norn doctor" });
  });

  test("a matching version, or none observed, adds no item", () => {
    for (const norn of [{ running: "0.31.3", repo: "0.31.0" }, undefined]) {
      const inbox = buildInbox(facts([], norn ? { norn } : {}), CONFIG);
      expect(inbox.pending).toBe(0);
    }
  });
});
