/**
 * The cockpit's machine-local memory (SPEC-cockpit CP13): `<norn home>/cockpit.json` holds
 * `last_repo`, the main checkout the last `norn cockpit` ran in, so the cockpit opened on a
 * workspace outside any norn repository shows that one. Presentation state, never a fact; an
 * unreadable file reads as empty.
 */
import { join } from "node:path";
import { atomicWriteJson, readText } from "./fsx.ts";

export interface CockpitFile {
  /** absolute path of the main checkout the last cockpit ran in */
  last_repo?: string;
}

const cockpitPath = (home: string) => join(home, "cockpit.json");

export function readCockpitFile(home: string): CockpitFile {
  const raw = readText(cockpitPath(home));
  if (raw === null) return {};
  try {
    const v = JSON.parse(raw) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) && typeof (v as CockpitFile).last_repo === "string" ? { last_repo: (v as CockpitFile).last_repo } : {};
  } catch {
    return {};
  }
}

export function writeCockpitFile(home: string, file: CockpitFile): void {
  atomicWriteJson(cockpitPath(home), file);
}
