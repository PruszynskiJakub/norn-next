import { describe, expect, test } from "bun:test";
import { formatWaitCondition, parseWaitCondition, type ProjectView, waitMet, waitState } from "../../src/index.ts";

const unit = (key: string, over: Record<string, unknown> = {}) => ({ key, status: "running", step: "implement", attempt: 1, park: null, last_outcome: null, next: null, ...over });
const view = (story: Record<string, unknown> = {}, slices: Array<Record<string, unknown>> = []) =>
  ({ stories: [{ ...unit("gh-7"), pr: null, story_status: "active", ...story, slices }] }) as unknown as ProjectView;
const park = (kind: string) => ({ status: "parked", park: { kind, reason: "r", since: "2026-11-03T00:00:00.000Z" } });

describe("story wait conditions (gh-175)", () => {
  test("parses each condition and refuses anything else", () => {
    for (const c of ["step=review", "gate", "ask", "stuck", "done", "merged"]) expect(formatWaitCondition(parseWaitCondition(c)!)).toBe(c);
    for (const c of ["", "step=", "Done", "sync.done", "$done", "not done", "step"]) expect(parseWaitCondition(c)).toBeNull();
  });

  test("step=<name> holds only at that step of the unit asked for", () => {
    const s = waitState(view({ step: "review" }), "gh-7")!;
    expect(waitMet(s, { kind: "step", step: "review" })).toBe("gh-7");
    expect(waitMet(s, { kind: "step", step: "implement" })).toBeNull();
  });

  test("gate, ask and stuck hold on the story or one of its slices; done only on the unit itself", () => {
    const sliced = view({ step: "slices" }, [unit("gh-7/01", { step: "qa", ...park("gate") }), unit("gh-7/02", { status: "done", step: "$done" })]);
    const s = waitState(sliced, "gh-7")!;
    expect(waitMet(s, { kind: "gate" })).toBe("gh-7/01");
    expect(waitMet(s, { kind: "ask" })).toBeNull();
    expect(waitMet(s, { kind: "done" })).toBeNull();
    expect(waitMet(waitState(sliced, "gh-7/02")!, { kind: "done" })).toBe("gh-7/02");
    expect(waitMet(waitState(sliced, "gh-7/02")!, { kind: "gate" })).toBeNull();
    expect(waitMet(waitState(view(park("ask")), "gh-7")!, { kind: "ask" })).toBe("gh-7");
    expect(waitMet(waitState(view({ status: "stuck", park: { kind: "exhausted", reason: "r", since: "x" } }), "gh-7")!, { kind: "stuck" })).toBe("gh-7");
    // a gate park is not an ask park
    expect(waitMet(waitState(view(park("gate")), "gh-7")!, { kind: "ask" })).toBeNull();
  });

  test("merged holds once the PR merged or the story is done", () => {
    const pr = (state: string) => ({ number: 1, url: "u", state, is_draft: false, seen_at: "x" });
    expect(waitMet(waitState(view({ pr: pr("open") }), "gh-7")!, { kind: "merged" })).toBeNull();
    expect(waitMet(waitState(view({ pr: pr("merged") }), "gh-7")!, { kind: "merged" })).toBe("gh-7");
    expect(waitMet(waitState(view({ story_status: "done" }), "gh-7")!, { kind: "merged" })).toBe("gh-7");
  });

  test("an unknown story or slice has no state", () => {
    expect(waitState(view(), "gh-8")).toBeNull();
    expect(waitState(view(), "gh-7/03")).toBeNull();
  });
});
