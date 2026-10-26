/**
 * The cockpit's machine-local memory of one checkout, in the gitignored trace dir (§7.1):
 * `cockpit.json` holds `notes_seen_at` — when the newest note a person saw by opening Notes was left
 * (HC16). Presentation state, never committed; an unreadable file reads as empty.
 */
import { join } from "node:path";
import { atomicWriteJson, readText } from "./fsx.ts";
import { traceDir } from "./paths.ts";

export interface CockpitFile {
  /** HC16: ISO time of the newest note seen; notes left after it count as new */
  notes_seen_at?: string;
}

const cockpitPath = (root: string) => join(traceDir(root), "cockpit.json");

export function readCockpitFile(root: string): CockpitFile {
  const raw = readText(cockpitPath(root));
  if (raw === null) return {};
  try {
    const v = JSON.parse(raw) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as CockpitFile) : {};
  } catch {
    return {};
  }
}

export function writeCockpitFile(root: string, file: CockpitFile): void {
  atomicWriteJson(cockpitPath(root), file);
}
