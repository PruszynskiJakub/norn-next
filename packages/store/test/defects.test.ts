/**
 * Confirmed defect, reproduced (refactor plan BUG-3, fixed by 1.3). Each `test.failing` passes while
 * the defect stands; the fix flips it to `test`.
 *   - BUG-3: `processStart` (proc.ts) still reads a start time for a zombie, so store treats it as
 *     alive, while the process adapter's `parseStart` treats it as dead. A tick lock whose holder
 *     is a zombie is then never reclaimed.
 */
import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquireLock } from "../src/lock.ts";
import { localProcess, processStart } from "../src/proc.ts";

/**
 * A zombie: `true` exits at once; its parent execs into `sleep`, which never reaps it. Made once,
 * outside the `test.failing` bodies, so a setup failure can never pass as "defect still present":
 * `ps` is polled until it shows `Z` (a loaded runner may take a while), and when no zombie appears
 * by the deadline both repros are skipped instead.
 */
async function zombie(): Promise<{ pid: number; stop: () => void } | null> {
  const p = Bun.spawn(["sh", "-c", "true & echo $!; exec sleep 60"], { stdout: "pipe" });
  const stop = () => p.kill();
  try {
    const { value } = await p.stdout.getReader().read();
    const pid = Number(new TextDecoder().decode(value).trim());
    if (!Number.isInteger(pid) || pid <= 0) return (stop(), null);
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const stat = Bun.spawnSync(["ps", "-o", "stat=", "-p", String(pid)]).stdout.toString().trim();
      if (stat.startsWith("Z")) return { pid, stop };
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
/** `test.skipIf(true).failing` throws in Bun ("Cannot get .failing on test.skip"), so pick the runner here. */
const repro = z === null ? test.skip : test.failing;

repro("BUG-3 a zombie process is not alive", async () => {
  const { pid } = z!;
  const start = processStart(pid);
  expect(start !== null && (await localProcess.isAlive({ pid, pid_start: start }))).toBe(false);
});

repro("BUG-3 a tick lock held by a zombie is reclaimed", async () => {
  const { pid } = z!;
  const path = join(mkdtempSync(join(tmpdir(), "norn-zombie-")), "tick.lock");
  writeFileSync(path, JSON.stringify({ holder: { pid, pid_start: processStart(pid) ?? "x" }, acquired_at: new Date().toISOString() }));
  expect((await acquireLock(path)).ok).toBe(true);
});
