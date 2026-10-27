/**
 * The cockpit's machine-local memory of one checkout, in the gitignored trace dir (§7.1):
 * `cockpit.json` holds `notes_seen_at` — when the newest note a person saw by opening Notes was left
 * (HC16). Presentation state, never committed; an unreadable file, or one of the wrong shape, reads
 * as empty (S2, readLocalJson).
 */
import { join } from "node:path";
import { atomicWriteJson } from "./fsx.ts";
import { readLocalJson } from "./local-json.ts";
import { traceDir } from "./paths.ts";

export interface CockpitFile {
  /** HC16: ISO time of the newest note seen; notes left after it count as new */
  notes_seen_at?: string;
}

const cockpitPath = (root: string) => join(traceDir(root), "cockpit.json");

export function readCockpitFile(root: string): CockpitFile {
  return readLocalJson("local-cockpit", cockpitPath(root), {}, root);
}

export function writeCockpitFile(root: string, file: CockpitFile): void {
  atomicWriteJson(cockpitPath(root), file);
}
