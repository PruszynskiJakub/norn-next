import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { type ClaimBlob, type Receipt, ulid } from "@norn/schema";
import {
  acquireClaim,
  classifyClaim,
  deleteMailbox,
  fetchNornRefs,
  listMailbox,
  postMailbox,
  readClaim,
  readLocalClaim,
  releaseClaim,
  renewClaim,
  renewClaims,
  setSpawnObserver,
} from "../../src/index.ts";
import { gitOk } from "../../src/git.ts";
import { AT, tmp } from "../helpers.ts";

async function setup() {
  const d = tmp();
  const remote = join(d, "remote.git");
  await gitOk(d, ["init", "-q", "--bare", remote]);
  const a = join(d, "a");
  const b = join(d, "b");
  for (const c of [a, b]) {
    await gitOk(d, ["init", "-q", c]);
    await gitOk(c, ["remote", "add", "origin", remote]);
  }
  return { a, b };
}

const NOW = Date.parse(AT);
const iso = (ms: number) => new Date(ms).toISOString();
function blob(holder: string, hb: string, expiresIn = 600_000): ClaimBlob {
  return { version: 1, story: "gh-12", holder, heartbeat_id: hb, acquired_at: AT, renewed_at: AT, expires_at: iso(NOW + expiresIn), last_tick_id: null };
}

describe("claims (T2–T6)", () => {
  test("acquire via CAS; second machine refused with holder; renew; expiry; release", async () => {
    const { a, b } = await setup();
    const hbA = ulid();
    const hbB = ulid();
    const ra = await acquireClaim(a, "origin", blob("jakub@mac", hbA), { now: NOW });
    expect(ra.ok).toBe(true);
    const rb = await acquireClaim(b, "origin", blob("ola@pc", hbB), { now: NOW });
    expect(rb).toMatchObject({ ok: false, reason: "held", holder: { holder: "jakub@mac" } });
    expect(!rb.ok && rb.message).toContain("held by jakub@mac since");

    const seen = await readClaim(b, "origin", "gh-12");
    if (seen.state === "unreachable") throw new Error(seen.message);
    expect(classifyClaim(seen, { heartbeat_id: hbB }, NOW)).toMatchObject({ state: "other" });
    expect(classifyClaim(seen, { heartbeat_id: hbA }, NOW)).toMatchObject({ state: "mine" });
    expect(classifyClaim(seen, { heartbeat_id: hbB }, NOW + 700_000)).toMatchObject({ state: "expired" });

    // renew with the right expectation; stale expectation fails
    if (!ra.ok) throw new Error("unreachable");
    const renewed = await renewClaim(a, "origin", { ...blob("jakub@mac", hbA, 900_000), renewed_at: iso(NOW + 1) }, ra.sha);
    expect(renewed.ok).toBe(true);
    expect((await renewClaim(a, "origin", blob("jakub@mac", hbA), ra.sha)).ok).toBe(false);

    // after expiry B takes it
    const later = NOW + 1_000_000;
    const taken = await acquireClaim(b, "origin", { ...blob("ola@pc", hbB, 600_000), expires_at: iso(later + 600_000) }, { now: later });
    expect(taken.ok).toBe(true);
    expect((await readClaim(a, "origin", "gh-12")) ).toMatchObject({ state: "present", blob: { holder: "ola@pc" } });

    // force before expiry
    const forced = await acquireClaim(a, "origin", { ...blob("jakub@mac", hbA), forced_from: "ola@pc" }, { now: later, force: true });
    expect(forced.ok).toBe(true);

    if (!forced.ok) throw new Error("unreachable");
    expect((await releaseClaim(a, "origin", "gh-12", "0".repeat(40))).ok).toBe(false);
    expect((await releaseClaim(a, "origin", "gh-12", forced.sha)).ok).toBe(true);
    expect(await readClaim(b, "origin", "gh-12")).toEqual({ state: "none" });
    expect(await readLocalClaim(a, "gh-12")).toEqual({ state: "none" });
  });

  test("an unreachable remote reads as network, not a throw; acquire still rejects with git's message", async () => {
    const { a } = await setup();
    await gitOk(a, ["remote", "set-url", "origin", join(a, "..", "gone.git")]);
    const r = await readClaim(a, "origin", "gh-12");
    if (r.state !== "unreachable") throw new Error(`expected unreachable, got ${r.state}`);
    expect(r.reason).toBe("network");
    expect(r.message).toStartWith("git ls-remote origin refs/norn/claims/gh-12 failed (128): ");
    await expect(acquireClaim(a, "origin", blob("jakub@mac", ulid()), { now: NOW })).rejects.toThrow(r.message);
  });

  test("racing acquirers: exactly one wins", async () => {
    const { a, b } = await setup();
    const results = await Promise.all([
      acquireClaim(a, "origin", blob("jakub@mac", ulid()), { now: NOW }),
      acquireClaim(b, "origin", blob("ola@pc", ulid()), { now: NOW }),
    ]);
    expect(results.filter((r) => r.ok).length).toBe(1);
    expect(results.find((r) => !r.ok)).toMatchObject({ ok: false });
  });

  test("local-only CAS without a remote", async () => {
    const { a } = await setup();
    const r = await acquireClaim(a, null, blob("jakub@mac", ulid()), { now: NOW });
    expect(r.ok).toBe(true);
    expect(await acquireClaim(a, null, blob("x@y", ulid()), { now: NOW })).toMatchObject({ ok: false, reason: "held" });
    if (r.ok) expect((await releaseClaim(a, null, "gh-12", r.sha)).ok).toBe(true);
  });
});

describe("batched renewals (T4, H5)", () => {
  const STORIES = ["gh-1", "gh-2", "gh-3"];
  async function claimed(a: string, hb: string) {
    const out: Array<{ blob: ClaimBlob; expected: string }> = [];
    for (const story of STORIES) {
      const r = await acquireClaim(a, "origin", { ...blob("jakub@mac", hb), story }, { now: NOW });
      if (!r.ok) throw new Error(r.message);
      out.push({ blob: { ...blob("jakub@mac", hb, 900_000), story, renewed_at: iso(NOW + 1) }, expected: r.sha });
    }
    return out;
  }
  async function pushesDuring<T>(f: () => Promise<T>): Promise<{ value: T; pushes: string[][] }> {
    const pushes: string[][] = [];
    const prev = setSpawnObserver(({ argv }) => {
      if (argv.includes("push")) pushes.push([...argv]);
    });
    try {
      return { value: await f(), pushes };
    } finally {
      setSpawnObserver(prev);
    }
  }

  test("every renewal goes out in one push and is mirrored locally", async () => {
    const { a, b } = await setup();
    const renewals = await claimed(a, ulid());
    const { value, pushes } = await pushesDuring(() => renewClaims(a, "origin", renewals));
    expect(pushes).toHaveLength(1);
    expect(value.map((r) => r.ok)).toEqual([true, true, true]);
    for (const [i, story] of STORIES.entries()) {
      const r = value[i];
      if (!r?.ok) throw new Error("unreachable");
      expect(await readLocalClaim(a, story)).toMatchObject({ state: "present", sha: r.sha, blob: { renewed_at: iso(NOW + 1) } });
      expect(await readClaim(b, "origin", story)).toMatchObject({ state: "present", sha: r.sha });
    }
  });

  test("one stale renewal among several fails alone; the others land", async () => {
    const { a } = await setup();
    const renewals = await claimed(a, ulid());
    const stale = renewals.map((r, i) => (i === 1 ? { ...r, expected: "0".repeat(40) } : r));
    const before = await readLocalClaim(a, "gh-2");
    const res = await renewClaims(a, "origin", stale);
    expect(res[0]).toMatchObject({ ok: true });
    expect(res[1]).toMatchObject({ ok: false, reason: "stale" });
    expect(!res[1]?.ok && res[1]?.message).toContain("refs/norn/claims/gh-2");
    expect(!res[1]?.ok && res[1]?.message).not.toContain("refs/norn/claims/gh-1");
    expect(res[2]).toMatchObject({ ok: true });
    expect(await readLocalClaim(a, "gh-2")).toEqual(before);
    expect(await readClaim(a, "origin", "gh-3")).toMatchObject({ state: "present", blob: { renewed_at: iso(NOW + 1) } });
  });

  test("an unreachable remote fails every renewal as network", async () => {
    const { a } = await setup();
    const renewals = await claimed(a, ulid());
    await gitOk(a, ["remote", "set-url", "origin", join(a, "..", "gone.git")]);
    const res = await renewClaims(a, "origin", renewals);
    expect(res.map((r) => !r.ok && r.reason)).toEqual(["network", "network", "network"]);
  });

  test("without a remote each renewal is its own local CAS", async () => {
    const { a } = await setup();
    const hb = ulid();
    const renewals: Array<{ blob: ClaimBlob; expected: string }> = [];
    for (const [i, story] of STORIES.entries()) {
      const r = await acquireClaim(a, null, { ...blob("jakub@mac", hb), story }, { now: NOW });
      if (!r.ok) throw new Error(r.message);
      renewals.push({ blob: { ...blob("jakub@mac", hb, 900_000), story }, expected: i === 1 ? "0".repeat(40) : r.sha });
    }
    const res = await renewClaims(a, null, renewals);
    expect(res.map((r) => r.ok || r.reason)).toEqual([true, "stale", true]);
  });

  test("no renewals, no push", async () => {
    const { a } = await setup();
    const { value, pushes } = await pushesDuring(() => renewClaims(a, "origin", []));
    expect(value).toEqual([]);
    expect(pushes).toHaveLength(0);
  });
});

describe("mailbox (T9)", () => {
  test("non-holder posts; holder fetches, lists, deletes", async () => {
    const { a, b } = await setup();
    const answer: Receipt = { kind: "answer", receipt_id: ulid(), run_id: null, step: "plan", attempt: 1, at: AT, by: "human", who: "ola@pc", answer: "pg" };
    const posted = await postMailbox(b, "origin", "gh-12", answer);
    expect(posted.ok).toBe(true);
    await expect(postMailbox(b, "origin", "gh-12", { kind: "stuck", receipt_id: ulid(), run_id: null, step: "plan", attempt: 1, at: AT, by: "agent", reason: "x" })).rejects.toThrow(/mailbox/);

    await fetchNornRefs(a, "origin");
    const items = await listMailbox(a, "gh-12");
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: answer.receipt_id, receipt: { answer: "pg" }, error: null });
    const it = items[0];
    if (!it) throw new Error("unreachable");
    expect((await deleteMailbox(a, "origin", it.ref, it.sha)).ok).toBe(true);
    await fetchNornRefs(b, "origin");
    expect(await listMailbox(b, "gh-12")).toEqual([]);
  });
});
