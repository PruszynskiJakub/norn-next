/**
 * The cockpit's machine-local memory (SPEC-cockpit CP13): `<norn home>/cockpit.json` holds
 * `last_repo`, the main checkout the last `norn cockpit` ran in, so the cockpit opened on a
 * workspace outside any norn repository shows that one. Presentation state, never a fact; an
 * unreadable file, or one of the wrong shape, reads as empty (S2, readLocalJson). It lives outside
 * any repository, so a bad file is not traced.
 */
import { join } from "node:path";
import { atomicWriteJson } from "./fsx.ts";
import { readLocalJson } from "./local-json.ts";

export interface CockpitFile {
  /** absolute path of the main checkout the last cockpit ran in */
  last_repo?: string;
}

const cockpitPath = (home: string) => join(home, "cockpit.json");

export function readCockpitFile(home: string): CockpitFile {
  return readLocalJson("local-cockpit", cockpitPath(home), {});
}

export function writeCockpitFile(home: string, file: CockpitFile): void {
  atomicWriteJson(cockpitPath(home), file);
}
