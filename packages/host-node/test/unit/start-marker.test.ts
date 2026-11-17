import { describe, expect, test } from "bun:test";
import { probeMatches, startMarker } from "../../src/index.ts";

describe("a spawn's start marker", () => {
  test("a probe that could not answer is never recorded as gone: its marker matches the live pid", () => {
    const marker = startMarker(42, { kind: "unknown" });
    expect(marker).not.toBe("gone:42");
    expect(probeMatches({ kind: "alive", start: "Tue Nov 17 10:00:00 2026" }, marker)).toBe(true);
    expect(probeMatches({ kind: "gone" }, marker)).toBe(false);
  });

  test("a process gone before its start was read gets a marker no live process matches", () => {
    const marker = startMarker(42, { kind: "gone" });
    expect(probeMatches({ kind: "alive", start: "Tue Nov 17 10:00:00 2026" }, marker)).toBe(false);
  });

  test("a read start time is the marker, and another start under the pid is not the process", () => {
    const marker = startMarker(42, { kind: "alive", start: "Tue Nov 17 10:00:00 2026" });
    expect(marker).toBe("Tue Nov 17 10:00:00 2026");
    expect(probeMatches({ kind: "alive", start: "Tue Nov 17 10:00:00 2026" }, marker)).toBe(true);
    expect(probeMatches({ kind: "alive", start: "Wed Nov 18 09:00:00 2026" }, marker)).toBe(false);
    expect(probeMatches({ kind: "unknown" }, marker)).toBe(true);
  });
});
