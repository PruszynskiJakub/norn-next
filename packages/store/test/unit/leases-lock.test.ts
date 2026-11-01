import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_CONFIG, type ProcessIdentity } from "@norn/schema";
import {
  acquireLock,
  acquireRunLease,
  acquireSlotLease,
  acquireTickLock,
  claimRunLease,
  handOverLease,
  leasesDir,
  listLeases,
  reclaimLeases,
  releaseLease,
  releaseRunLease,
} from "../../src/index.ts";
import { tmp } from "../helpers.ts";

const A: ProcessIdentity = { pid: 101, pid_start: "a" };
const B: ProcessIdentity = { pid: 202, pid_start: "b" };
const unit = { repo: "/r", story: "gh-12", slice: "gh-12/01" };

describe("tick lock (H1)", () => {
  test("exclusive while holder alive; reclaimed when dead; release", async () => {
    const repo = tmp();
    const alive = new Set([A.pid]);
    const liveness = (p: ProcessIdentity) => alive.has(p.pid);
    const a = await acquireTickLock(repo, { self: A, liveness });
    expect(a.ok).toBe(true);
    const b = await acquireTickLock(repo, { self: B, liveness });
    expect(b).toMatchObject({ ok: false, holder: { holder: A } });
    alive.delete(A.pid);
    const b2 = await acquireTickLock(repo, { self: B, liveness });
    expect(b2).toMatchObject({ ok: true, reclaimed: { holder: A } });
    // A's stale release must not remove B's lock
    expect(a.ok && a.release()).toBe(false);
    expect(b2.ok && b2.release()).toBe(true);
    expect(existsSync(b2.path)).toBe(false);
  });
  test("unreadable lock is reclaimed", async () => {
    const p = join(tmp(), "x.lock");
    writeFileSync(p, "garbage");
    expect((await acquireLock(p, { self: A, liveness: () => true })).ok).toBe(true);
  });
});

describe("leases (K1, K3, K4)", () => {
  test("agent leases capped, idempotent per run, dead holders reclaimed", async () => {
    const home = tmp();
    const alive = new Set([A.pid, B.pid]);
    const liveness = (l: { holder: ProcessIdentity }) => alive.has(l.holder.pid);
    const r1 = await acquireRunLease(home, "agent", 2, { ...unit, run_id: "01JBQ6ZK3E8Y4V5W6X7Y8Z9AB1", holder: A, liveness });
    const again = await acquireRunLease(home, "agent", 2, { ...unit, run_id: "01JBQ6ZK3E8Y4V5W6X7Y8Z9AB1", holder: A, liveness });
    expect(again).toMatchObject({ ok: true, existed: true, entry: { file: "agent-1.json" } });
    const r2 = await acquireRunLease(home, "agent", 2, { ...unit, run_id: "01JBQ6ZK3E8Y4V5W6X7Y8Z9AB2", holder: B, liveness });
    expect([r1.ok && r1.entry.file, r2.ok && r2.entry.file]).toEqual(["agent-1.json", "agent-2.json"]);
    const full = await acquireRunLease(home, "agent", 2, { ...unit, run_id: "01JBQ6ZK3E8Y4V5W6X7Y8Z9AB3", holder: B, liveness });
    expect(full).toMatchObject({ ok: false, reason: "full" });
    alive.delete(A.pid);
    const l = await listLeases(home, liveness);
    expect(l.dead.map((e) => e.file)).toEqual(["agent-1.json"]);
    const r3 = await acquireRunLease(home, "agent", 2, { ...unit, run_id: "01JBQ6ZK3E8Y4V5W6X7Y8Z9AB3", holder: B, liveness });
    expect(r3).toMatchObject({ ok: true, entry: { file: "agent-1.json" }, reclaimed: [{ file: "agent-1.json" }] });
    expect(releaseLease(home, "agent-2.json")).toBe(true);
    expect(readdirSync(leasesDir(home))).toEqual(["agent-1.json"]);
  });
  test("a lease is handed over only while it is unchanged: one released meanwhile stays released (K1)", async () => {
    const home = tmp();
    const r = await acquireRunLease(home, "check", 1, { ...unit, run_id: "01JBQ6ZK3E8Y4V5W6X7Y8Z9AB1", holder: A, liveness: () => true });
    if (!r.ok) throw new Error("no lease");
    const to = { ...r.entry.lease, holder: B };
    expect(handOverLease(home, r.entry.file, r.entry.lease, to)).toBe(true);
    expect((await listLeases(home, () => true)).live.map((e) => e.lease.holder)).toEqual([B]);
    expect(handOverLease(home, r.entry.file, r.entry.lease, to)).toBe(false); // no longer the tick's
    expect(releaseLease(home, r.entry.file)).toBe(true);
    expect(handOverLease(home, r.entry.file, to, { ...to, holder: A })).toBe(false);
    expect(readdirSync(leasesDir(home))).toEqual([]);
  });
  test("a run releases its lease only while it still names its run: one reclaimed by another run stays (K3)", async () => {
    const home = tmp();
    const r = await acquireRunLease(home, "check", 1, { ...unit, run_id: "01JBQ6ZK3E8Y4V5W6X7Y8Z9AB1", holder: A, liveness: () => true });
    if (!r.ok) throw new Error("no lease");
    rmSync(join(leasesDir(home), r.entry.file)); // reclaimed (K3) ...
    const other = await acquireRunLease(home, "check", 1, { ...unit, run_id: "01JBQ6ZK3E8Y4V5W6X7Y8Z9AB2", holder: B, liveness: () => true });
    expect(other).toMatchObject({ ok: true, entry: { file: r.entry.file } }); // ... and taken by another run
    expect(releaseRunLease(home, r.entry.file, "01JBQ6ZK3E8Y4V5W6X7Y8Z9AB1")).toBe(false);
    expect(readdirSync(leasesDir(home))).toEqual([r.entry.file]);
    writeFileSync(join(leasesDir(home), r.entry.file), '{"run_id":"01JBQ6ZK3E8Y4V5W6X7Y8Z9AB2"'); // unreadable (S2): not this run's to remove
    expect(releaseRunLease(home, r.entry.file, "01JBQ6ZK3E8Y4V5W6X7Y8Z9AB2")).toBe(false);
    rmSync(join(leasesDir(home), r.entry.file));
    const mine = await acquireRunLease(home, "check", 1, { ...unit, run_id: "01JBQ6ZK3E8Y4V5W6X7Y8Z9AB1", holder: A, liveness: () => true });
    expect(mine.ok).toBe(true);
    expect(releaseRunLease(home, r.entry.file, "01JBQ6ZK3E8Y4V5W6X7Y8Z9AB1")).toBe(true);
    expect(readdirSync(leasesDir(home))).toEqual([]);
    expect(releaseRunLease(home, r.entry.file, "01JBQ6ZK3E8Y4V5W6X7Y8Z9AB1")).toBe(false); // gone already
  });
  test("a run takes its own lease over, never another run's (K1)", async () => {
    const home = tmp();
    const r = await acquireRunLease(home, "check", 1, { ...unit, run_id: "01JBQ6ZK3E8Y4V5W6X7Y8Z9AB1", holder: A, liveness: () => true });
    if (!r.ok) throw new Error("no lease");
    expect(claimRunLease(home, r.entry.file, "01JBQ6ZK3E8Y4V5W6X7Y8Z9AB2", B)).toBe(false);
    expect((await listLeases(home, () => true)).live.map((e) => e.lease.holder)).toEqual([A]);
    expect(claimRunLease(home, r.entry.file, "01JBQ6ZK3E8Y4V5W6X7Y8Z9AB1", B)).toBe(true);
    expect(claimRunLease(home, r.entry.file, "01JBQ6ZK3E8Y4V5W6X7Y8Z9AB1", B)).toBe(true); // already its own
    expect((await listLeases(home, () => true)).live.map((e) => e.lease)).toMatchObject([{ run_id: "01JBQ6ZK3E8Y4V5W6X7Y8Z9AB1", holder: B }]);
    expect(releaseRunLease(home, r.entry.file, "01JBQ6ZK3E8Y4V5W6X7Y8Z9AB1")).toBe(true);
    expect(claimRunLease(home, r.entry.file, "01JBQ6ZK3E8Y4V5W6X7Y8Z9AB1", B)).toBe(false); // gone
    expect(readdirSync(leasesDir(home))).toEqual([]);
  });
  test("slot leases: range, port base, worktree liveness by default, reclaim", async () => {
    const home = tmp();
    const wt = tmp();
    const slots = { ...DEFAULT_CONFIG.slots, min: 3, max: 4 };
    const s = await acquireSlotLease(home, slots, { ...unit, worktree: wt, holder: A });
    expect(s).toMatchObject({ ok: true, entry: { n: 3, lease: { slot: 3, port_base: 4030, worktree: wt } } });
    const same = await acquireSlotLease(home, slots, { ...unit, worktree: wt, holder: B });
    expect(same).toMatchObject({ ok: true, existed: true });
    rmSync(wt, { recursive: true });
    const l = await listLeases(home);
    expect(l.dead.map((e) => e.file)).toEqual(["slot-3.json"]);
    expect(await reclaimLeases(home, ["slot-3.json"])).toEqual(["slot-3.json"]);
    // corrupt lease files are reported and reclaimable
    mkdirSync(leasesDir(home), { recursive: true });
    writeFileSync(join(leasesDir(home), "slot-4.json"), "{}");
    expect((await listLeases(home)).errors.map((e) => e.file)).toEqual(["slot-4.json"]);
    expect(await reclaimLeases(home, ["slot-4.json"])).toEqual(["slot-4.json"]);
  });
});
