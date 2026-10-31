/**
 * Confirmed defect, fixed (refactor plan BUG-3, fixed by 1.3): `processStart` (proc.ts) read a
 * start time for a zombie, so store treated it as alive while the process adapter treated it as
 * dead, and a tick lock whose holder was a zombie was never reclaimed. Store now owns the one
 * `ps -o stat= -o lstart=` parser (zombie = dead, K3) and the adapter reuses it.
 */
import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { acquireIntegrateLock, acquireLock, acquireTickLock } from "../../src/lock.ts";
import { integrateLockPath, tickLockPath } from "../../src/paths.ts";
import { localProcess, processStart } from "../../src/proc.ts";

/** What `ps -o lstart=` prints for `pid`: the start time a holder recorded while it was alive. */
function rawStart(pid: number): string {
  return Bun.spawnSync(["ps", "-o", "lstart=", "-p", String(pid)], { env: { ...process.env, LC_ALL: "C", LANG: "C" } })
    .stdout.toString()
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * A zombie: `true` exits at once; its parent execs into `sleep`, which never reaps it. `ps` is
 * polled until it shows `Z` (a loaded runner may take a while); when no zombie appears by the
 * deadline the tests are skipped instead.
 */
async function zombie(): Promise<{ pid: number; lstart: string; stop: () => void } | null> {
  const p = Bun.spawn(["sh", "-c", "true & echo $!; exec sleep 60"], { stdout: "pipe" });
  const stop = () => p.kill();
  try {
    const { value } = await p.stdout.getReader().read();
    const pid = Number(new TextDecoder().decode(value).trim());
    if (!Number.isInteger(pid) || pid <= 0) return (stop(), null);
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const stat = Bun.spawnSync(["ps", "-o", "stat=", "-p", String(pid)]).stdout.toString().trim();
      if (stat.startsWith("Z")) {
        const lstart = rawStart(pid);
        if (lstart) return { pid, lstart, stop };
      }
      await Bun.sleep(25);
    }
  } catch {
    // fall through: no zombie on this platform
  }
  stop();
  return null;
}

const z = await zombie();
afterAll(() => z?.stop());
const withZombie = z === null ? test.skip : test;

withZombie("BUG-3 a zombie process is not alive", async () => {
  const { pid, lstart } = z!;
  expect(processStart(pid)).toBeNull();
  expect(await localProcess.identify(pid)).toBeNull();
  // the start time a holder recorded before it became a zombie no longer counts as alive
  expect(await localProcess.isAlive({ pid, pid_start: lstart })).toBe(false);
});

function holdBy(path: string, pid: number, pid_start: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ holder: { pid, pid_start }, acquired_at: new Date().toISOString() }));
}

withZombie("BUG-3 a tick lock held by a zombie is reclaimed", async () => {
  const { pid, lstart } = z!;
  const repo = mkdtempSync(join(tmpdir(), "norn-zombie-"));
  holdBy(tickLockPath(repo), pid, lstart);
  const got = await acquireTickLock(repo);
  expect(got).toMatchObject({ ok: true, reclaimed: { holder: { pid, pid_start: lstart } } });
  expect(got.ok && got.release()).toBe(true);
});

withZombie("BUG-3 an integrate lock held by a zombie is reclaimed (K6)", async () => {
  const { pid, lstart } = z!;
  const repo = mkdtempSync(join(tmpdir(), "norn-zombie-"));
  holdBy(integrateLockPath(repo, "gh-12"), pid, lstart);
  const got = await acquireIntegrateLock(repo, "gh-12");
  expect(got).toMatchObject({ ok: true, reclaimed: { holder: { pid, pid_start: lstart } } });
});

test("a lock held by a live process is not reclaimed (default liveness)", async () => {
  const path = join(mkdtempSync(join(tmpdir(), "norn-lock-")), "tick.lock");
  const me = localProcess.self();
  holdBy(path, me.pid, me.pid_start);
  const got = await acquireLock(path, { self: { pid: 4242, pid_start: "other" } });
  expect(got).toMatchObject({ ok: false, holder: { holder: me } });
});

test("a lock held by a reused pid (other start time) is reclaimed (K3)", async () => {
  const path = join(mkdtempSync(join(tmpdir(), "norn-lock-")), "tick.lock");
  const me = localProcess.self();
  holdBy(path, me.pid, "Thu Jan 1 00:00:00 1970");
  const got = await acquireLock(path, { self: { pid: 4242, pid_start: "other" } });
  expect(got).toMatchObject({ ok: true, reclaimed: { holder: { pid: me.pid, pid_start: "Thu Jan 1 00:00:00 1970" } } });
});

test("a lock held by an exited process is reclaimed", async () => {
  const child = Bun.spawn(["sleep", "10"]);
  const start = processStart(child.pid);
  expect(start).not.toBeNull();
  child.kill();
  await child.exited;
  const path = join(mkdtempSync(join(tmpdir(), "norn-lock-")), "tick.lock");
  holdBy(path, child.pid, start!);
  const got = await acquireLock(path, { self: { pid: 4242, pid_start: "other" } });
  expect(got).toMatchObject({ ok: true, reclaimed: { holder: { pid: child.pid, pid_start: start } } });
});
