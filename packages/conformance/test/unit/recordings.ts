/** Reads one harness's scenario recordings from its fixtures folder, checked for shape before any replay. */
import { expect } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Scenario } from "@norn/conformance";

/** The classifier's quiet threshold every recording's checks are written against. */
export const SILENT_AFTER_MS = 5 * 60 * 1000;

export function loadRecordings(harness: string): Scenario[] {
  const dir = join(import.meta.dir, "fixtures", harness);
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((file) => {
      const s = JSON.parse(readFileSync(join(dir, file), "utf8")) as Scenario;
      expect({ file, name: s.scenario, steps: Array.isArray(s.steps), checks: Array.isArray(s.checks) }).toEqual({
        file,
        name: file.replace(/\.json$/, ""),
        steps: true,
        checks: true,
      });
      return s;
    });
}
