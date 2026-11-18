/**
 * The tracker contract as a reusable suite: what the kernel may assume of any tracker plugin (GitHub
 * issues, a local folder, ...). Facts come back validated against the contract's schemas, effects
 * are idempotent by receipt id, and a failing provider answers with a failure and changes nothing.
 */
import { describe, expect } from "bun:test";
import {
  formatStoryKey,
  isKeyPrefix,
  type Tracker,
  type TrackerCapabilities,
  type TrackerEffect,
  type TrackerEffectOutcome,
  type TrackerItem,
  type TrackerLabel,
  validateTrackerEffectOutcome,
  validateTrackerItem,
} from "@norn/plugin-api";
import { type ContractOptions, contractTest, expectValid, failureOf, valueOf } from "./contract.ts";

/** An item as a world installs it on the provider; the provider stamps key, url and updated_at. */
export interface SeedItem {
  id: number;
  title: string;
  body: string;
  open: boolean;
  assignees: string[];
  labels: string[];
}

export interface TrackerWorld {
  tracker: Tracker;
  /** install exactly these items on the provider, replacing any there */
  seed(items: SeedItem[]): Promise<void>;
  /** while on, the provider fails every call, as an outage or a lost login would */
  failing(on: boolean): void;
  /** the bodies of an item's comments as the provider holds them, oldest first */
  comments(id: number): Promise<string[]>;
  /** the labels defined on the provider; absent when the tracker keeps no label definitions */
  definedLabels?(): Promise<TrackerLabel[]>;
}

export type TrackerContractTest =
  | "names itself, a valid key prefix and whoami"
  | "intake: open items with the label assigned to me, nothing else"
  | "intake: another assignee, or anyone's"
  | "get: what intake listed, closed items too; null when missing"
  | "create opens an item with its labels and assignee, which intake then lists"
  | "create is idempotent by receipt id"
  | "comment adds one comment, idempotent by receipt id"
  | "labels adds and removes, leaving the others alone"
  | "assign adds the assignee, and intake for me then lists the item"
  | "close: get reports it closed and intake no longer lists it"
  | "ensure_labels defines the labels, and again changes nothing"
  | "an effect on a missing item is a not_found failure"
  | "an effect whose capability is false is refused as invalid, changing nothing"
  | "a failing provider answers every call with a failure and no effect lands";

/** The world every tracker is checked against; `me` is the tracker's `whoami`. */
export function trackerWorld(me: string): SeedItem[] {
  return [
    { id: 1, title: "Add login", body: "As a user I want to log in.", open: true, assignees: [me], labels: ["norn", "auth"] },
    { id: 2, title: "Not ours to pick", body: "", open: true, assignees: [me], labels: ["other"] },
    { id: 3, title: "Closed one", body: "", open: false, assignees: [me], labels: ["norn"] },
    { id: 4, title: "Someone else's", body: "", open: true, assignees: ["someone-else"], labels: ["norn"] },
    { id: 5, title: "Nobody's yet", body: "", open: true, assignees: [], labels: ["norn"] },
  ];
}

const CAPABILITY: Record<TrackerEffect["kind"], keyof TrackerCapabilities> = {
  assign: "assign",
  comment: "comment",
  create: "create",
  close: "close",
  labels: "labels",
  ensure_labels: "labels",
};

/** A receipt id per number, shaped as the host mints them (a ULID). */
export const receiptId = (n: number): string => `01JD${String(n).padStart(22, "0")}`;

const ids = (items: TrackerItem[]): number[] => items.map((i) => i.id).sort((a, b) => a - b);

/**
 * Register the suite. A test of an effect the tracker lacks the capability for passes without
 * asserting: the kernel never asks for it, and the capability test checks the refusal instead.
 */
export function trackerContract(name: string, makeWorld: () => TrackerWorld | Promise<TrackerWorld>, opts: ContractOptions<TrackerContractTest> = {}): void {
  describe(`tracker contract: ${name}`, () => {
    const t = (n: TrackerContractTest, fn: () => Promise<void>) => contractTest(opts, n, fn);

    const seeded = async () => {
      const world = await makeWorld();
      const me = valueOf(await world.tracker.whoami());
      await world.seed(trackerWorld(me));
      const tr = world.tracker;
      const can = (kind: TrackerEffect["kind"]) => tr.capabilities[CAPABILITY[kind]];
      const perform = async (effect: TrackerEffect, receipt: number): Promise<TrackerEffectOutcome> => {
        const outcome = valueOf(await tr.perform(effect, { receipt_id: receiptId(receipt) }));
        expectValid(`${effect.kind} outcome`, validateTrackerEffectOutcome(outcome));
        expect(outcome.kind).toBe(effect.kind);
        return outcome;
      };
      const item = async (id: number): Promise<TrackerItem> => {
        const found = valueOf(await tr.get(id));
        if (found === null) throw new Error(`item ${id} is missing`);
        return found;
      };
      return { world, tr, me, can, perform, item };
    };

    const checkItem = (tr: Tracker, i: TrackerItem) => {
      expectValid(`item ${i.id}`, validateTrackerItem(i));
      expect(i.key).toBe(formatStoryKey(tr.keyPrefix, i.id));
    };

    t("names itself, a valid key prefix and whoami", async () => {
      const { tr, me } = await seeded();
      expect(tr.name.length).toBeGreaterThan(0);
      expect(isKeyPrefix(tr.keyPrefix)).toBe(true);
      expect(me.length).toBeGreaterThan(0);
    });

    t("intake: open items with the label assigned to me, nothing else", async () => {
      const { tr, me } = await seeded();
      const items = valueOf(await tr.intake({ label: "norn", assignee: "me" }));
      expect(ids(items)).toEqual([1]);
      checkItem(tr, items[0] as TrackerItem);
      expect(items[0]).toMatchObject({ title: "Add login", body: "As a user I want to log in.", open: true, assignees: [me] });
      expect([...(items[0] as TrackerItem).labels].sort()).toEqual(["auth", "norn"]);
      expect(valueOf(await tr.intake({ label: "no-such-label", assignee: "me" }))).toEqual([]);
    });

    t("intake: another assignee, or anyone's", async () => {
      const { tr } = await seeded();
      expect(ids(valueOf(await tr.intake({ label: "norn", assignee: "someone-else" })))).toEqual([4]);
      const anyone = valueOf(await tr.intake({ label: "norn", assignee: null }));
      expect(ids(anyone)).toEqual([1, 4, 5]);
      for (const i of anyone) checkItem(tr, i);
      expect(anyone.find((i) => i.id === 5)?.assignees).toEqual([]);
    });

    t("get: what intake listed, closed items too; null when missing", async () => {
      const { tr } = await seeded();
      const [listed] = valueOf(await tr.intake({ label: "norn", assignee: "me" }));
      expect(valueOf(await tr.get(1))).toEqual(listed as TrackerItem);
      const closed = valueOf(await tr.get(3));
      checkItem(tr, closed as TrackerItem);
      expect(closed?.open).toBe(false);
      expect(valueOf(await tr.get(999))).toBeNull();
    });

    t("create opens an item with its labels and assignee, which intake then lists", async () => {
      const { tr, me, can, perform, item } = await seeded();
      if (!can("create")) return;
      const outcome = await perform({ kind: "create", title: "Fix login timeout", body: "It times out.", labels: ["norn", "norn:wf:fix"], assignee: me }, 1);
      expect(outcome.replayed).toBe(false);
      const id = outcome.id as number;
      expect([1, 2, 3, 4, 5]).not.toContain(id);
      expect(outcome.key).toBe(formatStoryKey(tr.keyPrefix, id));
      const created = await item(id);
      checkItem(tr, created);
      expect(created).toMatchObject({ title: "Fix login timeout", open: true, assignees: [me] });
      expect(created.body).toContain("It times out.");
      expect([...created.labels].sort()).toEqual(["norn", "norn:wf:fix"]);
      expect(ids(valueOf(await tr.intake({ label: "norn", assignee: "me" })))).toEqual([1, id]);
    });

    t("create is idempotent by receipt id", async () => {
      const { tr, can, perform } = await seeded();
      if (!can("create")) return;
      const effect: TrackerEffect = { kind: "create", title: "Once only", body: "", labels: ["norn"] };
      const first = await perform(effect, 7);
      const again = await perform(effect, 7);
      expect(again).toMatchObject({ id: first.id, replayed: true });
      expect(ids(valueOf(await tr.intake({ label: "norn", assignee: null })))).toEqual([1, 4, 5, first.id as number]);
      const other = await perform(effect, 8);
      expect(other.id).not.toBe(first.id);
      expect(other.replayed).toBe(false);
    });

    t("comment adds one comment, idempotent by receipt id", async () => {
      const { world, can, perform } = await seeded();
      if (!can("comment")) return;
      const count = async () => (await world.comments(1)).filter((b) => b.includes("Picked up by norn")).length;
      expect(await count()).toBe(0);
      expect((await perform({ kind: "comment", id: 1, body: "Picked up by norn" }, 2)).replayed).toBe(false);
      expect((await perform({ kind: "comment", id: 1, body: "Picked up by norn" }, 2)).replayed).toBe(true);
      expect(await count()).toBe(1);
      await perform({ kind: "comment", id: 1, body: "Picked up by norn" }, 3);
      expect(await count()).toBe(2);
    });

    t("labels adds and removes, leaving the others alone", async () => {
      const { can, perform, item } = await seeded();
      if (!can("labels")) return;
      await perform({ kind: "labels", id: 1, add: ["norn:wf:story"], remove: ["auth", "not-there"] }, 4);
      expect([...(await item(1)).labels].sort()).toEqual(["norn", "norn:wf:story"]);
      await perform({ kind: "labels", id: 1, add: ["norn:wf:story"], remove: ["auth", "not-there"] }, 4);
      expect([...(await item(1)).labels].sort()).toEqual(["norn", "norn:wf:story"]);
    });

    t("assign adds the assignee, and intake for me then lists the item", async () => {
      const { tr, me, can, perform, item } = await seeded();
      if (!can("assign")) return;
      await perform({ kind: "assign", id: 5, user: me }, 5);
      await perform({ kind: "assign", id: 4, user: me }, 6);
      expect((await item(5)).assignees).toEqual([me]);
      expect([...(await item(4)).assignees].sort()).toEqual([me, "someone-else"].sort());
      expect(ids(valueOf(await tr.intake({ label: "norn", assignee: "me" })))).toEqual([1, 4, 5]);
    });

    t("close: get reports it closed and intake no longer lists it", async () => {
      const { tr, can, perform, item } = await seeded();
      if (!can("close")) return;
      await perform({ kind: "close", id: 1 }, 9);
      expect((await item(1)).open).toBe(false);
      expect(valueOf(await tr.intake({ label: "norn", assignee: "me" }))).toEqual([]);
      await perform({ kind: "close", id: 1 }, 9);
      expect((await item(1)).open).toBe(false);
    });

    t("ensure_labels defines the labels, and again changes nothing", async () => {
      const { world, can, perform } = await seeded();
      if (!can("ensure_labels")) return;
      const wanted: TrackerLabel[] = [
        { name: "norn", color: "D93F0B", description: "pick me" },
        { name: "norn:wf:quick", color: "5319E7", description: "Make a small change" },
      ];
      await perform({ kind: "ensure_labels", labels: wanted }, 10);
      const before = world.definedLabels ? await world.definedLabels() : null;
      await perform({ kind: "ensure_labels", labels: wanted }, 11);
      if (!world.definedLabels || before === null) return;
      const after = await world.definedLabels();
      expect(after).toEqual(before);
      for (const l of wanted) expect(after.find((d) => d.name === l.name)).toEqual(l);
    });

    t("an effect on a missing item is a not_found failure", async () => {
      const { tr, can } = await seeded();
      const effects: TrackerEffect[] = [
        { kind: "close", id: 999 },
        { kind: "labels", id: 999, add: ["x"], remove: [] },
        { kind: "comment", id: 999, body: "x" },
        { kind: "assign", id: 999, user: "someone-else" },
      ];
      for (const [n, e] of effects.entries()) {
        if (!can(e.kind)) continue;
        expect({ kind: e.kind, code: failureOf(await tr.perform(e, { receipt_id: receiptId(100 + n) })).code }).toEqual({ kind: e.kind, code: "not_found" });
      }
    });

    t("an effect whose capability is false is refused as invalid, changing nothing", async () => {
      const { world, tr, me, can } = await seeded();
      const before = valueOf(await tr.get(1));
      const comments = await world.comments(1);
      const effects: TrackerEffect[] = [
        { kind: "assign", id: 1, user: "someone-else" },
        { kind: "comment", id: 1, body: "x" },
        { kind: "create", title: "x", body: "", labels: ["norn"], assignee: me },
        { kind: "close", id: 1 },
        { kind: "labels", id: 1, add: ["x"], remove: ["norn"] },
      ];
      for (const [n, e] of effects.entries()) {
        if (can(e.kind)) continue;
        expect({ kind: e.kind, code: failureOf(await tr.perform(e, { receipt_id: receiptId(200 + n) })).code }).toEqual({ kind: e.kind, code: "invalid" });
      }
      expect(valueOf(await tr.get(1))).toEqual(before);
      expect(await world.comments(1)).toEqual(comments);
      expect(ids(valueOf(await tr.intake({ label: "norn", assignee: null })))).toEqual([1, 4, 5]);
    });

    t("a failing provider answers every call with a failure and no effect lands", async () => {
      const { world, tr, me, can } = await seeded();
      const before = valueOf(await tr.get(1));
      const comments = await world.comments(1);
      world.failing(true);
      failureOf(await tr.whoami());
      failureOf(await tr.intake({ label: "norn", assignee: "me" }));
      failureOf(await tr.get(1));
      const effects: TrackerEffect[] = [
        { kind: "assign", id: 1, user: "someone-else" },
        { kind: "comment", id: 1, body: "lost" },
        { kind: "create", title: "lost", body: "", labels: ["norn"], assignee: me },
        { kind: "close", id: 1 },
        { kind: "labels", id: 1, add: ["norn:wf:story"], remove: ["norn"] },
        { kind: "ensure_labels", labels: [{ name: "lost", color: "000000", description: "" }] },
      ];
      for (const [n, e] of effects.entries()) if (can(e.kind)) failureOf(await tr.perform(e, { receipt_id: receiptId(300 + n) }));
      world.failing(false);
      expect(valueOf(await tr.get(1))).toEqual(before);
      expect(await world.comments(1)).toEqual(comments);
      expect(ids(valueOf(await tr.intake({ label: "norn", assignee: null })))).toEqual([1, 4, 5]);
    });
  });
}
