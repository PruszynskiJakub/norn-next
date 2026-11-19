/**
 * Every norn acting on one store must read what the others write. A store with a floor keeps the
 * newest norn version that acted on it; a norn below it refuses to act, since a receipt or state
 * shape added since reads to it as invalid and makes the unit corrupt on its clone. A norn at or above
 * the floor raises it to its own release before it acts, so its writes never reach an older norn
 * that has not been refused first. Read-only commands skip the check: they write nothing, and they are
 * how a person sees what the newer norn did.
 */
import type { Store } from "@norn/plugin-api";
import { compareVersions, versionCore } from "@norn/schema";
import { type CliFailure, refuse } from "./output.ts";

/**
 * The refusal when the store's floor stands above `running`; otherwise null, with the floor raised to
 * `running` where it stood lower. A build that names no version compares to nothing and is let through;
 * a floor the store cannot read or raise is reported through `note` and lets the command run, as the
 * store's own calls then fail the same way.
 */
export async function floorRefusal(store: Store, running: string, note: (line: string) => void): Promise<CliFailure | null> {
  const floor = store.floor;
  const core = versionCore(running);
  if (!floor || core === null) return null;
  const read = await floor.read();
  if (!read.ok) {
    note(`norn version floor not checked: ${read.failure.message}`);
    return null;
  }
  const at = read.value;
  if (at !== null && compareVersions(core, at) < 0) return tooOld(core, at);
  if (at !== null && compareVersions(core, at) === 0) return null;
  const raised = await floor.raise(core);
  if (!raised.ok) {
    note(`norn version floor not raised to ${core}: ${raised.failure.message}`);
    return null;
  }
  // a newer norn may have raised it past this one since the read
  return compareVersions(core, raised.value.floor) < 0 ? tooOld(core, raised.value.floor) : null;
}

const tooOld = (running: string, floor: string): CliFailure =>
  refuse(
    `this norn is ${running}, but norn ${floor} has acted on this repo's run data, which an older norn may read as corrupt`,
    `upgrade norn to ${floor} or newer, then run the command again; read-only commands (status, story view) still work`,
    "version_too_old",
    { running, floor },
  );
