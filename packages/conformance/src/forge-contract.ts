/**
 * The forge contract as a reusable suite: what the kernel may assume of any forge plugin (GitHub
 * pull requests, no forge at all, ...). Change requests come back validated, `open` is idempotent by
 * receipt id, a merge done by a person is seen, and a failing provider changes nothing.
 */
import { describe, expect } from "bun:test";
import { type ChangeRequest, type ChecksSummary, type Forge, type ForgeEffect, type ForgeEffectOutcome, validateChangeRequest, validateChecksReport, validateForgeEffectOutcome } from "@norn/plugin-api";
import { type ContractOptions, contractTest, expectValid, failureOf, valueOf } from "./contract.ts";
import { receiptId } from "./tracker-contract.ts";

export interface ForgeWorld {
  forge: Forge;
  /** while on, the provider fails every call */
  failing(on: boolean): void;
  /** a person merges change `id` on the provider, the merge making commit `sha` */
  merge?(id: number, sha: string): Promise<void>;
  /** a person closes change `id` unmerged */
  close?(id: number): Promise<void>;
  /** the checks the provider reports for change `id`'s head from now on */
  setChecks?(id: number, summary: Exclude<ChecksSummary, "none">): Promise<void>;
  /** whether change `id` conflicts with its base from now on */
  setConflicts?(id: number, on: boolean): Promise<void>;
}

export interface ForgeContractOptions extends ContractOptions<ForgeContractTest> {
  /**
   * false for a forge that holds no change requests (no forge at all): every branch has none, and
   * every effect is refused as invalid. The world's merge, close and setChecks are then unused.
   */
  changes?: boolean;
}

export type ForgeContractTest =
  | "findChanges: null for every branch without one, nothing for no branches"
  | "open opens a change that findChanges then reports"
  | "open is idempotent by receipt id"
  | "findChanges picks the newest of a branch's changes, across branches"
  | "update changes the title and body, the change still open"
  | "ready clears draft"
  | "a merge by a person is seen, with its merge commit"
  | "a close by a person is seen"
  | "checks: none, then what the provider reports"
  | "checkReport: the summary checks gives, each failed check named, a conflict with the base said while the checks are unsettled"
  | "fileUrl: a forge that offers it serves raw URLs, and pins each form of a commit's file to that commit"
  | "an effect on a missing change is a not_found failure"
  | "a forge without changes refuses every effect as invalid"
  | "a failing provider answers every call with a failure and opens nothing";

const MERGE_SHA = "fedcba9876543210fedcba9876543210fedcba98";

function need<T>(what: string, v: T | undefined): T {
  if (v === undefined) throw new Error(`the forge world needs ${what} for this test`);
  return v;
}

export function forgeContract(name: string, makeWorld: () => ForgeWorld | Promise<ForgeWorld>, opts: ForgeContractOptions = {}): void {
  const changes = opts.changes ?? true;
  describe(`forge contract: ${name}`, () => {
    const t = (n: ForgeContractTest, fn: () => Promise<void>) => contractTest(opts, n, fn);
    /** a test that needs a forge holding change requests; a forge without passes it without asserting */
    const tc = (n: ForgeContractTest, fn: () => Promise<void>) => t(n, async () => (changes ? fn() : undefined));

    const made = async () => {
      const world = await makeWorld();
      const fg = world.forge;
      const perform = async (effect: ForgeEffect, receipt: number): Promise<ForgeEffectOutcome> => {
        const outcome = valueOf(await fg.perform(effect, { receipt_id: receiptId(receipt) }));
        expectValid(`${effect.kind} outcome`, validateForgeEffectOutcome(outcome));
        expect(outcome.kind).toBe(effect.kind);
        return outcome;
      };
      const find = async (branch: string): Promise<ChangeRequest | null> => {
        const found = valueOf(await fg.findChanges([branch]));
        expect(Object.keys(found)).toEqual([branch]);
        const c = found[branch] ?? null;
        if (c !== null) expectValid(`change of ${branch}`, validateChangeRequest(c));
        return c;
      };
      const open = (head: string, receipt: number, title = "Add login") => perform({ kind: "open", head, base: "main", title, body: "Closes #1", draft: true }, receipt);
      return { world, fg, perform, find, open };
    };

    t("findChanges: null for every branch without one, nothing for no branches", async () => {
      const { fg } = await made();
      expect(fg.name.length).toBeGreaterThan(0);
      expect(valueOf(await fg.findChanges([]))).toEqual({});
      expect(valueOf(await fg.findChanges(["gh-1-no-change", "lt-2-none"]))).toEqual({ "gh-1-no-change": null, "lt-2-none": null });
    });

    tc("open opens a change that findChanges then reports", async () => {
      const { fg, open, find } = await made();
      const { change, replayed } = await open("gh-1-add-login", 1);
      expect(replayed).toBe(false);
      expect(change).toMatchObject({ state: "open", draft: fg.capabilities.draft, head_branch: "gh-1-add-login", base_branch: "main", title: "Add login" });
      expect(change.merged_at).toBeUndefined();
      expect(change.merge_sha).toBeUndefined();
      expect(await find("gh-1-add-login")).toEqual(change);
    });

    tc("open is idempotent by receipt id", async () => {
      const { open, find } = await made();
      const first = await open("gh-1-add-login", 2);
      const again = await open("gh-1-add-login", 2);
      expect(again.replayed).toBe(true);
      expect(again.change.id).toBe(first.change.id);
      expect((await find("gh-1-add-login"))?.id).toBe(first.change.id);
    });

    tc("findChanges picks the newest of a branch's changes, across branches", async () => {
      const { fg, open, find } = await made();
      await open("gh-1-add-login", 3, "first");
      const other = await open("lt-2-other", 4, "other");
      const second = await open("gh-1-add-login", 5, "second");
      const branches = ["gh-1-add-login", "lt-2-other", "gh-3-none"];
      const found = valueOf(await fg.findChanges(branches));
      expect(Object.keys(found).sort()).toEqual([...branches].sort());
      expect(found["gh-1-add-login"]?.id).toBe(second.change.id);
      expect(found["gh-1-add-login"]?.title).toBe("second");
      expect(found["lt-2-other"]?.id).toBe(other.change.id);
      expect(found["gh-3-none"]).toBeNull();
      for (const b of branches) expect(found[b] ?? null).toEqual(await find(b));
    });

    tc("update changes the title and body, the change still open", async () => {
      const { fg, open, perform, find } = await made();
      const { change } = await open("gh-1-add-login", 6, "Release");
      const updated = await perform({ kind: "update", id: change.id, title: "Release 0.22.0" }, 7);
      expect(updated.change).toMatchObject({ id: change.id, title: "Release 0.22.0", state: "open", draft: fg.capabilities.draft });
      await perform({ kind: "update", id: change.id, body: "new body" }, 8);
      expect(await find("gh-1-add-login")).toMatchObject({ title: "Release 0.22.0", state: "open" });
    });

    tc("ready clears draft", async () => {
      const { open, perform, find } = await made();
      const { change } = await open("gh-1-add-login", 9);
      expect((await perform({ kind: "ready", id: change.id }, 10)).change.draft).toBe(false);
      expect((await find("gh-1-add-login"))?.draft).toBe(false);
      expect((await perform({ kind: "ready", id: change.id }, 10)).change.draft).toBe(false);
    });

    tc("a merge by a person is seen, with its merge commit", async () => {
      const { world, open, find } = await made();
      const { change } = await open("gh-1-add-login", 11);
      await need("merge", world.merge)(change.id, MERGE_SHA);
      const merged = await find("gh-1-add-login");
      expect(merged).toMatchObject({ id: change.id, state: "merged", merge_sha: MERGE_SHA });
      expect(Number.isNaN(Date.parse(merged?.merged_at ?? ""))).toBe(false);
    });

    tc("a close by a person is seen", async () => {
      const { world, open, find } = await made();
      const { change } = await open("gh-1-add-login", 12);
      await need("close", world.close)(change.id);
      const closed = await find("gh-1-add-login");
      expect(closed).toMatchObject({ id: change.id, state: "closed" });
      expect(closed?.merged_at).toBeUndefined();
    });

    tc("checks: none, then what the provider reports", async () => {
      const { world, fg, open } = await made();
      const { change } = await open("gh-1-add-login", 13);
      expect(valueOf(await fg.checks(change.id))).toBe("none");
      for (const summary of ["pending", "failure", "success"] as const) {
        await need("setChecks", world.setChecks)(change.id, summary);
        expect(valueOf(await fg.checks(change.id))).toBe(fg.capabilities.checks ? summary : "none");
      }
    });

    tc("checkReport: the summary checks gives, each failed check named, a conflict with the base said while the checks are unsettled", async () => {
      const { world, fg, open } = await made();
      if (!fg.checkReport) return;
      const report = async (id: number) => {
        const r = valueOf(await (fg.checkReport as NonNullable<Forge["checkReport"]>)(id));
        expectValid("checks report", validateChecksReport(r));
        expect(r.summary).toBe(valueOf(await fg.checks(id)));
        return r;
      };
      const { change } = await open("gh-1-add-login", 15);
      expect(await report(change.id)).toMatchObject({ summary: "none", failed: [] });
      if (!fg.capabilities.checks) return;
      for (const summary of ["pending", "success"] as const) {
        await need("setChecks", world.setChecks)(change.id, summary);
        expect((await report(change.id)).failed).toEqual([]);
      }
      await need("setChecks", world.setChecks)(change.id, "failure");
      const failed = (await report(change.id)).failed;
      expect(failed.length).toBeGreaterThan(0);
      for (const f of failed) expect(f.name.length).toBeGreaterThan(0);
      await need("setChecks", world.setChecks)(change.id, "pending");
      await need("setConflicts", world.setConflicts)(change.id, true);
      expect((await report(change.id)).conflicts).toBe(true);
      await need("setConflicts", world.setConflicts)(change.id, false);
      expect((await report(change.id)).conflicts).not.toBe(true);
      failureOf(await fg.checkReport(999));
    });

    t("fileUrl: a forge that offers it serves raw URLs, and pins each form of a commit's file to that commit", async () => {
      const { fg } = await made();
      if (!fg.fileUrl) return;
      const url = fg.fileUrl.bind(fg);
      expect(fg.capabilities.raw_urls).toBe(true);
      const other = MERGE_SHA.split("").reverse().join("");
      for (const form of ["image", "link"] as const) {
        const a = valueOf(await url(MERGE_SHA, "AC1.webp", form));
        expect(typeof a).toBe("string");
        expect(a).toContain(MERGE_SHA);
        expect(a).toContain("AC1.webp");
        expect(valueOf(await url(MERGE_SHA, "AC1.webp", form))).toBe(a as string);
        expect(valueOf(await url(other, "AC1.webp", form))).not.toBe(a as string);
        expect(valueOf(await url(MERGE_SHA, "AC2.log", form))).not.toBe(a as string);
      }
    });

    tc("an effect on a missing change is a not_found failure", async () => {
      const { fg } = await made();
      for (const [n, e] of ([{ kind: "update", id: 999, title: "x" }, { kind: "ready", id: 999 }] as ForgeEffect[]).entries())
        expect({ kind: e.kind, code: failureOf(await fg.perform(e, { receipt_id: receiptId(100 + n) })).code }).toEqual({ kind: e.kind, code: "not_found" });
    });

    t("a forge without changes refuses every effect as invalid", async () => {
      if (changes) return;
      const { fg } = await made();
      const effects: ForgeEffect[] = [
        { kind: "open", head: "gh-1-add-login", base: "main", title: "x", body: "", draft: true },
        { kind: "update", id: 1, title: "x" },
        { kind: "ready", id: 1 },
      ];
      for (const [n, e] of effects.entries())
        expect({ kind: e.kind, code: failureOf(await fg.perform(e, { receipt_id: receiptId(200 + n) })).code }).toEqual({ kind: e.kind, code: "invalid" });
      expect(valueOf(await fg.findChanges(["gh-1-add-login"]))).toEqual({ "gh-1-add-login": null });
      expect(valueOf(await fg.checks(1))).toBe("none");
    });

    tc("a failing provider answers every call with a failure and opens nothing", async () => {
      const { world, fg, open, find } = await made();
      const { change } = await open("gh-1-add-login", 14);
      world.failing(true);
      failureOf(await fg.findChanges(["gh-1-add-login"]));
      failureOf(await fg.checks(change.id));
      if (fg.checkReport) failureOf(await fg.checkReport(change.id));
      failureOf(await fg.perform({ kind: "open", head: "lt-2-lost", base: "main", title: "lost", body: "", draft: true }, { receipt_id: receiptId(300) }));
      failureOf(await fg.perform({ kind: "update", id: change.id, title: "lost" }, { receipt_id: receiptId(301) }));
      failureOf(await fg.perform({ kind: "ready", id: change.id }, { receipt_id: receiptId(302) }));
      world.failing(false);
      expect(await find("lt-2-lost")).toBeNull();
      expect(await find("gh-1-add-login")).toEqual(change);
    });
  });
}
