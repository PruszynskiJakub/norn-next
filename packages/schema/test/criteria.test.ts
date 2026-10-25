/** CriteriaReport (QV2), frontmatter `criteria` (QV1), receipt fields `criteria`, `notes`, `acknowledged_notes` (NT1, NT3). */
import { describe, expect, test } from "bun:test";
import { validate, validateCriteriaReport } from "../src/index.ts";

const ID = "01JBQ6ZK3E8Y4V5W6X7Y8Z9ABC";
const AT = "2026-10-23T12:00:00.000Z";
const head = { receipt_id: ID, run_id: ID, step: "qa", attempt: 1, at: AT, by: "agent" as const };

describe("CriteriaReport (QV2)", () => {
  test("each verdict carries its required fields", () => {
    const ok = validateCriteriaReport([
      { id: "AC1", verdict: "pass", evidence: "evidence/r/ac1.txt" },
      { id: "AC2", verdict: "unverified", reason: "no browser in this session", how: "open /today" },
      { id: "AC3", verdict: "person", how: "compare against Figma frame 12" },
      { id: "AC4", verdict: "fail", repro: "click save; nothing happens" },
    ]);
    expect(ok.ok).toBe(true);
    for (const [entry, missing] of [
      [{ id: "AC1", verdict: "pass" }, "evidence"],
      [{ id: "AC2", verdict: "unverified", how: "x" }, "reason"],
      [{ id: "AC2", verdict: "unverified", reason: "x" }, "how"],
      [{ id: "AC3", verdict: "person" }, "how"],
      [{ id: "AC4", verdict: "fail" }, "repro"],
    ] as const) {
      const r = validateCriteriaReport([entry]);
      expect(r.ok ? [] : r.errors.map((e) => e.message).join(" ")).toContain(missing);
    }
  });

  test("an empty report, an unknown verdict or an unknown field is invalid", () => {
    expect(validateCriteriaReport([]).ok).toBe(false);
    expect(validateCriteriaReport([{ id: "AC1", verdict: "partial", how: "x" }]).ok).toBe(false);
    expect(validateCriteriaReport([{ id: "AC1", verdict: "pass", evidence: "e", note: "x" }]).ok).toBe(false);
    expect(validateCriteriaReport({ criteria: [] }).ok).toBe(false);
  });
});

describe("frontmatter criteria (QV1) and receipt fields (NT1, NT3)", () => {
  test("slice and story frontmatter take criteria with verifier and needs", () => {
    const slice = { id: "gh-4/01", title: "t", depends_on: [], status: "planned", criteria: [{ id: "AC1", verifier: "test" }, { id: "AC2", verifier: "agent", needs: ["browser"] }] };
    expect(validate("slice", slice).ok).toBe(true);
    expect(validate("slice", { ...slice, criteria: [{ id: "AC1", verifier: "robot" }] }).ok).toBe(false);
    expect(validate("slice", { ...slice, criteria: [{ id: "AC 1", verifier: "test" }] }).ok).toBe(false);
  });

  test("done takes criteria and notes; approve takes acknowledged note ids", () => {
    const done = { kind: "done", ...head, outcome: "pass", handoff: "h", criteria: [{ id: "AC1", verdict: "pass", evidence: "e" }], notes: [{ text: "kept whitespace", criterion: "AC1" }, { text: "plain" }] };
    expect(validate("receipt", done).ok).toBe(true);
    expect(validate("receipt", { ...done, notes: [{ text: "" }] }).ok).toBe(false);
    const approve = { kind: "approve", ...head, step: "ready", by: "human", acknowledged_notes: [`note:${ID}:1`, `note:${ID}:2`] };
    expect(validate("receipt", approve).ok).toBe(true);
    expect(validate("receipt", { ...approve, acknowledged_notes: ["note:x:1"] }).ok).toBe(false);
  });
});
