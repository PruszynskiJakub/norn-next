import { describe, expect, test } from "bun:test";
import { RULE_IDS } from "@norn/kernel";
import type { TickReport } from "@norn/runtime";
import { RULE_CAPTIONS } from "../../src/captions.ts";
import { tickMarkdown, watchLine } from "../../src/tick-report.ts";

type Outcome = TickReport["outcomes"][number];
const report = (outcomes: Outcome[]): TickReport => ({ tick_id: "01JAAAAAAAAAAAAAAAAAAAAAAA", decisions: [], outcomes, problems: [] }) as unknown as TickReport;
const PENDING = RULE_IDS.find((r) => r === "claim.pending") as string;
const TAKE = RULE_IDS.find((r) => r === "claim.take") as string;

describe("a caption for every decide rule", () => {
  test("every rule id decide can name has a caption", () => {
    expect(RULE_IDS.filter((r) => !(typeof RULE_CAPTIONS[r] === "string" && RULE_CAPTIONS[r].trim().length > 0))).toEqual([]);
  });

  test("no caption is keyed by an id decide does not have", () => {
    expect(Object.keys(RULE_CAPTIONS).filter((k) => !RULE_IDS.includes(k))).toEqual([]);
  });

  test("a caption is one plain line, no rule id or markdown in it", () => {
    for (const [id, caption] of Object.entries(RULE_CAPTIONS)) {
      expect({ id, caption }).toEqual({ id, caption: caption.trim() });
      expect(caption).not.toMatch(/[\n`|]/);
      expect(caption.length).toBeLessThanOrEqual(100);
    }
  });
});

describe("norn tick's markdown", () => {
  const noop = { decision: { kind: "noop", unit: "gh-1", rule: PENDING, reason: "x" }, ok: true } as unknown as Outcome;
  const take = { decision: { kind: "take_claim", unit: null, rule: TAKE, story: "gh-1" }, ok: true } as unknown as Outcome;

  test("each decision reads rule → kind: caption", () => {
    const md = tickMarkdown(report([noop, take]));
    expect(md).toContain(`- gh-1  ${PENDING} → noop: ${RULE_CAPTIONS[PENDING]}`);
    expect(md).toContain(`- gh-1  ${TAKE} → take_claim: ${RULE_CAPTIONS[TAKE]}`);
  });

  test("a failed decision keeps its caption before the failure", () => {
    const failed = { ...take, ok: false, retryable: true, error: "unavailable: down" } as unknown as Outcome;
    expect(tickMarkdown(report([failed]))).toContain(`${TAKE} → take_claim: ${RULE_CAPTIONS[TAKE]}  FAILED: unavailable: down (retried next tick)`);
  });

  test("the watch line stays short: no caption", () => {
    const line = watchLine(report([take]), "09:00:00", new Set());
    expect(line).toBe(`09:00:00  gh-1 ${TAKE} → take_claim`);
  });
});
