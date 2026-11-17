/** The lock file every compare-and-swap of store "local" runs under. */
import { describe, expect, test } from "bun:test";
import { failureOf, manualClock, memoryFiles, memoryHost, valueOf } from "@norn/conformance";
import { fail, type HostFiles, ok } from "@norn/plugin-api";
import { type LockTuning, withLock } from "../../src/index.ts";
import { failable, START } from "./world.ts";

const LOCK = "/machine/repo/runs-v2/stories/gh-12/claim.json.lock";
const FAST: LockTuning = { attempts: 5, retryMs: 1, staleMs: 30_000 };

const lockText = (token: string, at: string) => JSON.stringify({ token, at });
const ago = (ms: number) => new Date(Date.parse(START) - ms).toISOString();
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function host(seed: Record<string, string> = {}, files = memoryFiles(seed)) {
  const clock = manualClock(START);
  return { files, clock, ctx: memoryHost({ files, now: clock.now }) };
}

describe("withLock", () => {
  test("holds the lock while the work runs and removes it after", async () => {
    const { files, ctx } = host();
    const seen: Array<string | null> = [];
    const r = await withLock(ctx, LOCK, FAST, async () => {
      seen.push(await files.read(LOCK));
      return ok("done");
    });
    expect(valueOf(r)).toBe("done");
    expect(JSON.parse(seen[0] as string)).toMatchObject({ at: START });
    expect(await files.read(LOCK)).toBeNull();
  });

  test("a stale lock, by its own timestamp, is taken over", async () => {
    const { files, ctx } = host({ [LOCK]: lockText("dead-writer", ago(30_000)) });
    const r = await withLock(ctx, LOCK, FAST, async () => ok((await files.read(LOCK)) as string));
    expect(JSON.parse(valueOf(r)).token).not.toBe("dead-writer");
    expect(files.snapshot()).toEqual({});
  });

  test("a lock just short of stale is live: the writer retries, then gives up as unavailable without running", async () => {
    const held = lockText("live-writer", ago(29_999));
    const { files, ctx } = host({ [LOCK]: held });
    let ran = false;
    const r = await withLock(ctx, LOCK, FAST, async () => {
      ran = true;
      return ok(null);
    });
    const f = failureOf(r);
    expect(f).toMatchObject({ code: "unavailable", retryable: true });
    expect(f.message).toContain(LOCK);
    expect(f.message).toContain("5 tries");
    expect(ran).toBe(false);
    expect(files.snapshot()).toEqual({ [LOCK]: held });
  });

  test("a live lock released while the writer waits lets it in", async () => {
    const { files, ctx } = host({ [LOCK]: lockText("live-writer", START) });
    const pending = withLock(ctx, LOCK, { ...FAST, attempts: 200 }, async () => ok("in"));
    await new Promise((resolve) => setTimeout(resolve, 5));
    await files.remove(LOCK);
    expect(valueOf(await pending)).toBe("in");
    expect(files.snapshot()).toEqual({});
  });

  test("the clock moving past staleMs while a writer waits lets it take over", async () => {
    const { files, clock, ctx } = host({ [LOCK]: lockText("hung-writer", START) });
    const pending = withLock(ctx, LOCK, { ...FAST, attempts: 200 }, async () => ok("in"));
    await new Promise((resolve) => setTimeout(resolve, 5));
    clock.advance(30_000);
    expect(valueOf(await pending)).toBe("in");
    expect(files.snapshot()).toEqual({});
  });

  test("a throw in the work releases the lock and answers unavailable", async () => {
    const { files, ctx } = host();
    const r = await withLock(ctx, LOCK, FAST, async () => {
      throw new Error("disk full");
    });
    expect(failureOf(r)).toMatchObject({ code: "unavailable", message: expect.stringContaining("disk full") });
    expect(files.snapshot()).toEqual({});
  });

  test("a failure answered by the work releases the lock and is passed on unchanged", async () => {
    const { files, ctx } = host();
    const r = await withLock(ctx, LOCK, FAST, async () => fail("conflict", "lost the race"));
    expect(failureOf(r)).toEqual({ code: "conflict", message: "lost the race", retryable: false });
    expect(files.snapshot()).toEqual({});
  });

  test("a lock that cannot be created at all answers unavailable", async () => {
    const down = memoryFiles();
    const { ctx } = host({}, down);
    down.failWrites(true);
    expect(failureOf(await withLock(ctx, LOCK, FAST, async () => ok(null)))).toMatchObject({ code: "unavailable", retryable: true });
  });

  test("a lock taken over from this writer is not removed by it", async () => {
    const { files, ctx } = host();
    const usurper = lockText("usurper", START);
    await withLock(ctx, LOCK, FAST, async () => {
      await files.write(LOCK, usurper);
      return ok(null);
    });
    expect(files.snapshot()).toEqual({ [LOCK]: usurper });
  });

  test("an unreadable lock gets one try's grace, then is broken as torn by a crash", async () => {
    const { files, ctx } = host({ [LOCK]: '{"token":"half' });
    expect(failureOf(await withLock(ctx, LOCK, { ...FAST, attempts: 1 }, async () => ok(null))).code).toBe("unavailable");
    expect(valueOf(await withLock(ctx, LOCK, { ...FAST, attempts: 3 }, async () => ok("in")))).toBe("in");
    expect(files.snapshot()).toEqual({});
  });

  test("a breaker that died holding the .break file is aged out like a lock", async () => {
    const { files, ctx } = host({ [LOCK]: lockText("dead-writer", ago(60_000)), [`${LOCK}.break`]: lockText("dead-breaker", ago(60_000)) });
    expect(valueOf(await withLock(ctx, LOCK, FAST, async () => ok("in")))).toBe("in");
    expect(files.snapshot()).toEqual({});
  });

  test("a live breaker is waited for, not removed", async () => {
    const breaker = lockText("live-breaker", START);
    const { files, ctx } = host({ [LOCK]: lockText("dead-writer", ago(60_000)), [`${LOCK}.break`]: breaker });
    expect(failureOf(await withLock(ctx, LOCK, FAST, async () => ok(null))).code).toBe("unavailable");
    expect(await files.read(`${LOCK}.break`)).toBe(breaker);
  });

  test("writers racing over a stale lock still run one at a time", async () => {
    const { ctx } = host({ [LOCK]: lockText("dead-writer", ago(60_000)) });
    let inside = 0;
    let most = 0;
    const work = async () => {
      inside++;
      most = Math.max(most, inside);
      await tick();
      await tick();
      inside--;
      return ok(null);
    };
    const all = await Promise.all(Array.from({ length: 8 }, () => withLock(ctx, LOCK, { ...FAST, attempts: 500 }, work)));
    expect(all.every((r) => r.ok)).toBe(true);
    expect(most).toBe(1);
  });

  test("an error while releasing never turns a settled answer into a failure", async () => {
    const inner = memoryFiles();
    let down = false;
    const files: HostFiles = failable(inner, () => down);
    const ctx = memoryHost({ files, now: manualClock(START).now });
    const r = await withLock(ctx, LOCK, FAST, async () => {
      down = true;
      return ok("written");
    });
    expect(valueOf(r)).toBe("written");
    expect(Object.keys(inner.snapshot())).toEqual([LOCK]);
  });
});
