/**
 * Conformance of the lab harness to the same scenarios as every harness: the lab agent's hooks go
 * through labHarness.normalize into the kernel's reducer and classifier. The lab reports no subagents
 * and no limits, so its recordings of those scenarios show the degraded reads. Each recording is a
 * translation of another harness's recording into the lab's hook protocol (each says so).
 */
import { describe, expect, test } from "bun:test";
import { harnessConformance } from "@norn/conformance";
import { labHarness } from "@norn/harness-lab";
import { loadRecordings, SILENT_AFTER_MS } from "./recordings.ts";

const recordings = loadRecordings("lab");

harnessConformance("lab", labHarness, recordings, { silentAfterMs: SILENT_AFTER_MS });

describe("lab recordings", () => {
  test("each says it was derived, not captured", () => {
    expect(recordings.filter((s) => !s.derived_from?.startsWith("Derived, not recorded")).map((s) => s.scenario)).toEqual([]);
  });
});
