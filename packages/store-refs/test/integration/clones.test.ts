/**
 * Several machines on one remote: each clone is a machine with its own store. What the contract
 * suite cannot show with one clone: the remote decides claim races, flush refuses a stale clone
 * without losing its commits, a fresh clone gets everything back, and old norn's refs stay untouched.
 */
import { describe, expect, test } from "bun:test";
import type { PluginResult } from "@norn/plugin-api";
import { git, machine, team } from "./world.ts";

function value<T>(r: PluginResult<T> | undefined): T {
  if (!r) throw new Error("the store lacks a part its capabilities promise");
  if (!r.ok) throw new Error(`expected a value, got ${r.failure.code}: ${r.failure.message}`);
  return r.value;
}

function code<T>(r: PluginResult<T> | undefined): string {
  if (!r) throw new Error("the store lacks a part its capabilities promise");
  if (r.ok) throw new Error(`expected a failure, got ${JSON.stringify(r.value)}`);
  return r.failure.code;
}

async function refs(path: string, prefix = "refs/"): Promise<Record<string, string>> {
  const out = await git(path, "for-each-ref", "--format=%(refname) %(objectname)", prefix);
  return Object.fromEntries(
    out
      .split("\n")
      .filter(Boolean)
      .map((l) => l.split(" ") as [string, string]),
  );
}

describe("two clones racing", () => {
  test("on one claim: exactly one acquires, the other gets conflict and then reads the winner's claim", async () => {
    const t = await team();
    const a = machine(await t.clone("a"));
    const b = machine(await t.clone("b"));
    for (const story of ["gh-1", "gh-2", "gh-3", "gh-4", "gh-5"]) {
      const [ra, rb] = await Promise.all([a.store.claims.acquire(story, "machine-a", 60_000), b.store.claims.acquire(story, "machine-b", 60_000)]);
      const winners = [ra, rb].filter((r) => r.ok);
      expect({ story, winners: winners.length }).toEqual({ story, winners: 1 });
      const [won, lost] = ra.ok ? [ra, rb] : [rb, ra];
      expect(code(lost)).toBe("conflict");
      const held = value(won);
      expect(value(await a.store.claims.read(story))).toEqual(held);
      expect(value(await b.store.claims.read(story))).toEqual(held);
    }
  });

  test("on one run ref: flush lets one through, the stale clone gets conflict and keeps its own commits", async () => {
    const t = await team();
    const a = machine(await t.clone("a"));
    const b = machine(await t.clone("b"));
    value(await a.store.appendReceipt("gh-12", { id: "from-a", data: { by: "a" } }));
    value(await a.store.commitState("gh-12", { by: "a" }, null));
    value(await b.store.appendReceipt("gh-12", { id: "from-b", data: { by: "b" } }));
    value(await b.store.commitState("gh-12", { by: "b" }, null));
    const before = { a: value(await a.store.readUnit("gh-12")), b: value(await b.store.readUnit("gh-12")) };

    const flushA = a.store.flush?.bind(a.store);
    const flushB = b.store.flush?.bind(b.store);
    if (!flushA || !flushB) throw new Error("a shared store flushes");
    const [fa, fb] = await Promise.all([flushA("gh-12"), flushB("gh-12")]);
    expect([fa, fb].filter((r) => r.ok && r.value.pushed)).toHaveLength(1);
    const [winner, loser, lostWith] = fa.ok ? [a, b, fb] : [b, a, fa];
    expect(code(lostWith)).toBe("conflict");

    expect(value(await a.store.readUnit("gh-12"))).toEqual(before.a);
    expect(value(await b.store.readUnit("gh-12"))).toEqual(before.b);
    const remoteHead = (await refs(t.remote, "refs/norn/v2/runs/"))["refs/norn/v2/runs/gh-12"];
    expect(remoteHead).toBe((await refs(winner.path))["refs/norn/v2/runs/gh-12"]);

    // syncing does not overwrite the loser's diverged run data, and flushing it again is still refused
    value(await loser.store.sync?.());
    expect(value(await loser.store.readUnit("gh-12"))).toEqual(loser === a ? before.a : before.b);
    expect(code(await loser.store.flush?.("gh-12"))).toBe("conflict");
    expect((await refs(t.remote, "refs/norn/v2/runs/"))["refs/norn/v2/runs/gh-12"]).toBe(remoteHead);
  });

  test("a clone that synced, then fell behind, is refused until it syncs and builds on the newer run data", async () => {
    const t = await team();
    const a = machine(await t.clone("a"));
    const b = machine(await t.clone("b"));
    value(await a.store.appendReceipt("gh-12", { id: "r1", data: 1 }));
    expect(value(await a.store.flush?.("gh-12"))).toEqual({ pushed: true });
    expect(value(await b.store.sync?.())).toEqual({ fetched: 1 });
    expect(value(await b.store.readUnit("gh-12")).receipts.map((r) => r.id)).toEqual(["r1"]);

    value(await a.store.appendReceipt("gh-12", { id: "r2", data: 2 }));
    value(await a.store.flush?.("gh-12"));
    value(await b.store.appendReceipt("gh-12", { id: "r2-b", data: 2 }));
    expect(code(await b.store.flush?.("gh-12"))).toBe("conflict");
    expect(value(await b.store.readUnit("gh-12")).receipts.map((r) => r.id)).toEqual(["r1", "r2-b"]);
  });
});

describe("a diverged story", () => {
  test("is told apart from one that is only ahead or behind, and adopting the remote's keeps this clone's commits under a ref of their own", async () => {
    const t = await team();
    const a = machine(await t.clone("a"));
    const b = machine(await t.clone("b"));
    value(await a.store.appendReceipt("gh-12", { id: "r1", data: 1 }));
    value(await a.store.flush?.("gh-12"));
    value(await b.store.sync?.());
    expect(value(await b.store.diverged?.("gh-12"))).toBe(false);
    value(await b.store.appendReceipt("gh-12", { id: "late", data: "b" }));
    expect(value(await b.store.diverged?.("gh-12"))).toBe(false);
    expect(value(await b.store.adoptRemote?.("gh-12"))).toEqual({ dropped: null });

    value(await a.store.appendReceipt("gh-12", { id: "r2", data: 2 }));
    value(await a.store.flush?.("gh-12"));
    value(await b.store.sync?.());
    expect(value(await b.store.diverged?.("gh-12"))).toBe(true);
    const own = (await refs(b.path))["refs/norn/v2/runs/gh-12"] as string;

    const adopted = value(await b.store.adoptRemote?.("gh-12"));
    expect(adopted).toEqual({ dropped: own, kept_at: `refs/norn/v2/dropped/runs/gh-12/${own}` });
    expect((await refs(b.path))[`refs/norn/v2/dropped/runs/gh-12/${own}`]).toBe(own);
    expect(value(await b.store.readUnit("gh-12")).receipts.map((r) => r.id)).toEqual(["r1", "r2"]);
    expect(value(await b.store.diverged?.("gh-12"))).toBe(false);
    value(await b.store.appendReceipt("gh-12", { id: "r3", data: 3 }));
    expect(value(await b.store.flush?.("gh-12"))).toEqual({ pushed: true });
    expect(Object.keys(await refs(t.remote)).some((r) => r.includes("dropped"))).toBe(false);
  });
});

describe("claims and mailboxes are shared at once", () => {
  test("a claim taken on one machine is seen, refused and released across machines", async () => {
    const t = await team();
    const a = machine(await t.clone("a"));
    const b = machine(await t.clone("b"));
    const held = value(await a.store.claims.acquire("gh-7", "machine-a", 60_000));
    expect(value(await b.store.claims.read("gh-7"))).toEqual(held);
    expect(code(await b.store.claims.acquire("gh-7", "machine-b", 60_000))).toBe("conflict");
    value(await a.store.claims.release("gh-7", "machine-a"));
    expect(value(await b.store.claims.read("gh-7"))).toBeNull();
    const taken = value(await b.store.claims.acquire("gh-7", "machine-b", 60_000, null));
    // the release left a tombstone at the next version, so the new claim never reuses one a reader may hold
    expect(taken.version).toBe(held.version + 2);
    expect(value(await a.store.claims.read("gh-7"))).toEqual(taken);
  });

  test("a message sent from one machine is received and acknowledged on another", async () => {
    const t = await team();
    const a = machine(await t.clone("a"));
    const b = machine(await t.clone("b"));
    const mbA = a.store.mailbox;
    const mbB = b.store.mailbox;
    if (!mbA || !mbB) throw new Error("the refs store has a mailbox");
    value(await mbA.send("gh-7", { id: "m-1", from: "person", data: { say: "hi" } }));
    value(await mbA.send("gh-7", { id: "m-2", from: "person", data: { say: "again" } }));
    expect(value(await mbB.receive("gh-7")).map((m) => m.id)).toEqual(["m-1", "m-2"]);
    value(await mbB.ack("gh-7", ["m-1"]));
    expect(value(await mbA.receive("gh-7")).map((m) => m.id)).toEqual(["m-2"]);
    expect(value(await mbA.send("gh-7", { id: "m-1", from: "person", data: {} }))).toEqual({ replayed: true });
  });
});

describe("a fresh clone", () => {
  test("gets receipts, state, slices and artifacts back after flush and sync", async () => {
    const t = await team();
    const a = machine(await t.clone("a"));
    value(await a.store.appendReceipt("gh-12", { id: "r1", data: { n: 1, text: "zażółć 🧵" } }));
    value(await a.store.appendReceipt("gh-12", { id: "r2", data: [1, 2, 3] }));
    value(await a.store.commitState("gh-12", { step: "build" }, null));
    value(await a.store.commitState("gh-12/02", { step: "review" }, null));
    value(await a.store.artifacts?.write("gh-12", "handoffs/02.md", "# Handoff\n"));
    value(await a.store.appendReceipt("gh-9", { id: "r1", data: null }));
    expect(value(await a.store.flush?.("gh-12"))).toEqual({ pushed: true });
    expect(value(await a.store.flush?.("gh-9"))).toEqual({ pushed: true });

    const fresh = `${t.dir}/fresh`;
    await git(t.dir, "clone", "-q", t.remote, fresh);
    const c = machine(fresh);
    expect(value(await c.store.listUnits())).toEqual([]);
    expect(value(await c.store.sync?.())).toEqual({ fetched: 2 });
    expect(value(await c.store.listUnits())).toEqual(value(await a.store.listUnits()));
    for (const unit of ["gh-12", "gh-12/02", "gh-9"]) expect(value(await c.store.readUnit(unit))).toEqual(value(await a.store.readUnit(unit)));
    expect(value(await c.store.artifacts?.read("gh-12", "handoffs/02.md"))).toBe("# Handoff\n");
    // the fresh clone builds on what it fetched, and its flush is accepted
    value(await c.store.appendReceipt("gh-12", { id: "r3", data: 3 }));
    expect(value(await c.store.flush?.("gh-12"))).toEqual({ pushed: true });
    expect(value(await c.store.sync?.())).toEqual({ fetched: 0 });
  });
});

describe("old norn's refs", () => {
  test("refs/norn/runs/* and refs/norn/claims/* are never read or written", async () => {
    const t = await team();
    const path = await t.clone("a");
    // an old ref holding a tree shaped like the new layout: if the store read it, the unit would not read empty
    const host = machine(path).ctx;
    const state = (await host.exec(["git", "hash-object", "-w", "--stdin"], { cwd: path, input: '{"version":1,"data":"old"}' })).stdout.trim();
    const mk = async (input: string) => (await host.exec(["git", "mktree"], { cwd: path, input })).stdout.trim();
    const unitTree = await mk(`100644 blob ${state}\tstate.json\n`);
    const storyTree = await mk(`040000 tree ${unitTree}\tgh-12\n`);
    const root = await mk(`040000 tree ${storyTree}\tunits\n100644 blob ${state}\tclaim.json\n`);
    const env = { GIT_AUTHOR_NAME: "old", GIT_AUTHOR_EMAIL: "old@x", GIT_COMMITTER_NAME: "old", GIT_COMMITTER_EMAIL: "old@x" };
    const old = (await host.exec(["git", "commit-tree", root, "-m", "old norn"], { cwd: path, env })).stdout.trim();
    for (const ref of ["refs/norn/runs/gh-12", "refs/norn/claims/gh-12", "refs/norn/mailbox/gh-12"]) await git(path, "update-ref", ref, old);
    await git(path, "push", "-q", "origin", "refs/norn/runs/gh-12:refs/norn/runs/gh-12", "refs/norn/claims/gh-12:refs/norn/claims/gh-12");
    const oldLocal = await refs(path, "refs/norn/");
    const oldRemote = await refs(t.remote, "refs/norn/");

    const m = machine(path);
    const st = m.store;
    expect(value(await st.readUnit("gh-12"))).toEqual({ state: null, receipts: [] });
    expect(value(await st.listUnits())).toEqual([]);
    expect(value(await st.claims.read("gh-12"))).toBeNull();
    value(await st.sync?.());
    expect(value(await st.listUnits())).toEqual([]);
    value(await st.appendReceipt("gh-12", { id: "r1", data: {} }));
    value(await st.commitState("gh-12", { step: "new" }, null));
    value(await st.claims.acquire("gh-12", "machine-a", 60_000));
    value(await st.mailbox?.send("gh-12", { id: "m-1", from: "person", data: {} }));
    value(await st.artifacts?.write("gh-12", "spec.md", "x"));
    value(await st.flush?.("gh-12"));
    value(await st.sync?.());
    value(await st.archive("gh-12"));

    const isOld = (r: string) => !r.startsWith("refs/norn/v2/");
    const pick = (all: Record<string, string>) => Object.fromEntries(Object.entries(all).filter(([r]) => isOld(r)));
    expect(pick(await refs(path, "refs/norn/"))).toEqual(oldLocal);
    expect(pick(await refs(t.remote, "refs/norn/"))).toEqual(oldRemote);
    expect(Object.keys(await refs(t.remote)).sort()).toEqual([
      "refs/norn/claims/gh-12",
      "refs/norn/runs/gh-12",
      "refs/norn/v2/claims/gh-12",
      "refs/norn/v2/mailbox/gh-12",
      "refs/norn/v2/runs/gh-12",
    ]);
  });
});

describe("a remote that checks every object it receives", () => {
  test("takes the flush of a story whose artifacts tried a name as both a file and a folder", async () => {
    const t = await team();
    await git(t.remote, "config", "receive.fsckObjects", "true");
    const a = machine(await t.clone("a"));
    const ar = a.store.artifacts;
    if (!ar) throw new Error("store refs offers artifacts");
    value(await ar.write("gh-1", "a", "file a"));
    expect(code(await ar.write("gh-1", "a/b", "under a"))).toBe("conflict");
    value(await ar.write("gh-1", "c/d", "file c/d"));
    expect(code(await ar.write("gh-1", "c", "over c"))).toBe("conflict");
    expect(value(await ar.list("gh-1"))).toEqual(["a", "c/d"]);
    expect(value(await a.store.flush?.("gh-1"))).toEqual({ pushed: true });
    await git(a.path, "fsck", "--strict", "--no-dangling");
  });
});
