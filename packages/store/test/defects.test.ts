/**
 * Confirmed defect, reproduced (refactor plan BUG-3, fixed by 1.3). Each `test.failing` passes while
 * the defect stands; the fix flips it to `test`.
 *   - BUG-3: `processStart` (proc.ts) still reads a start time for a zombie, so store treats it as
 *     alive, while the process adapter's `parseStart` treats it as dead. A tick lock whose holder
 *     is a zombie is then never reclaimed.
 */
import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquireLock } from "../src/lock.ts";
import { localProcess, processStart } from "../src/proc.ts";

/** A zombie: `true` exits at once; its parent execs into `sleep`, which never reaps it. */
async function zombie(): Promise<{ pid: number; stop: () => void }> {
  const p = Bun.spawn(["sh", "-c", "true & echo $!; exec sleep 5"], { stdout: "pipe" });
  const { value } = await p.stdout.getReader().read();
  const pid = Number(new TextDecoder().decode(value).trim());
  await Bun.sleep(200);
  const stat = Bun.spawnSync(["ps", "-o", "stat=", "-p", String(pid)]).stdout.toString().trim();
  if (!stat.startsWith("Z")) {
    p.kill();
    throw new Error(`pid ${pid} is not a zombie (ps stat "${stat}"): this platform cannot make one for the repro`);
  }
  return { pid, stop: () => p.kill() };
}

test.failing("BUG-3 a zombie process is not alive", async () => {
  const z = await zombie();
  try {
    const start = processStart(z.pid);
    expect(start !== null && (await localProcess.isAlive({ pid: z.pid, pid_start: start }))).toBe(false);
  } finally {
    z.stop();
  }
});

test.failing("BUG-3 a tick lock held by a zombie is reclaimed", async () => {
  const z = await zombie();
  try {
    const path = join(mkdtempSync(join(tmpdir(), "norn-zombie-")), "tick.lock");
    writeFileSync(path, JSON.stringify({ holder: { pid: z.pid, pid_start: processStart(z.pid) ?? "x" }, acquired_at: new Date().toISOString() }));
    expect((await acquireLock(path)).ok).toBe(true);
  } finally {
    z.stop();
  }
});
