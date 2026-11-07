/**
 * The wake file `wake` in the checkout's machine dir. Every receipt appended
 * through `appendReceipt` (`norn done`/`ask`/`stuck`, `norn story answer`, a finished `norn check-run`, …)
 * rewrites it atomically with `<pid> <ulid>`, so a sleeping `norn watch` that watches the machine dir
 * wakes and ticks within about a second instead of at its next interval. The content is a stamp, never a
 * fact: decide never reads it, and a missing or stale one only means watch waits its interval.
 */
import { existsSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { RUNS_DIR, ulid } from "@norn/schema";
import { atomicWrite, readText } from "./fsx.ts";
import { checkoutFilePath } from "./paths.ts";

export const WAKE_FILE = "wake";
export const wakePath = (machine: string): string => join(machine, WAKE_FILE);

/** The machine dir holding a unit's run-state folder (`<machine dir>/runs/<story>/…`), or null when it is in none. */
export function machineDirOfRunState(unitDir: string): string | null {
  for (let dir = unitDir; dirname(dir) !== dir; dir = dirname(dir))
    if (basename(dir) === RUNS_DIR && existsSync(checkoutFilePath(dirname(dir)))) return dirname(dir);
  return null;
}

/** Rewrite the wake file of the machine dir `unitDir` belongs to; best-effort (a lost wake costs one interval). */
export function touchWake(unitDir: string): void {
  const machine = machineDirOfRunState(unitDir);
  if (!machine) return;
  try {
    atomicWrite(wakePath(machine), `${process.pid} ${ulid(Date.now())}\n`);
  } catch {
    // the receipt is written; watch still ticks at its interval
  }
}

/** The wake file's stamp, and the pid that wrote it; null when there is none. */
export function readWake(machine: string): { stamp: string; pid: number } | null {
  let text: string | null;
  try {
    text = readText(wakePath(machine));
  } catch {
    return null;
  }
  if (!text) return null;
  const stamp = text.trim();
  return { stamp, pid: Number(stamp.split(" ")[0]) };
}
