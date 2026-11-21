import { describe, expect, test } from "bun:test";
import { judgeChanges } from "../../src/index.ts";

const none = { changed: [], headMoved: false, remoteMoved: false, configChanged: false, hooksChanged: false, refsChanged: false };

describe("judging what a run that may not keep code changed", () => {
  test("nothing changed is clean at either level", () => {
    expect(judgeChanges({ code: "read", passes: true, ...none })).toEqual({ verdict: "clean", reasons: [], reset: [], resetHead: false, notes: [] });
    expect(judgeChanges({ code: "scratch", passes: true, ...none }).verdict).toBe("clean");
  });

  test("code:read refuses a tracked change or a commit, whatever the outcome, and resets nothing", () => {
    const j = judgeChanges({ code: "read", passes: false, ...none, changed: ["src/a.ts"], headMoved: true });
    expect(j).toMatchObject({ verdict: "refused", reset: [], resetHead: false });
    expect(j.reasons).toEqual(["tracked files changed since the run started: src/a.ts", "the branch moved since the run started: a commit was made, or the branch reset"]);
  });

  test("code:scratch resets a lockfile alone without a word, and refuses an outcome that passes over any other change or a commit", () => {
    expect(judgeChanges({ code: "scratch", passes: true, ...none, changed: ["bun.lock", "web/package-lock.json"] })).toEqual({ verdict: "reset", reasons: [], reset: ["bun.lock", "web/package-lock.json"], resetHead: false, notes: [] });
    const stub = judgeChanges({ code: "scratch", passes: true, ...none, changed: ["bun.lock", "src/a.ts"] });
    expect(stub).toMatchObject({ verdict: "refused", reset: [] });
    expect(stub.reasons).toEqual(["an outcome that passes the step is refused while a tracked file other than a lockfile changed since the run started: src/a.ts"]);
    expect(judgeChanges({ code: "scratch", passes: true, ...none, headMoved: true }).verdict).toBe("refused");
  });

  test("code:scratch resets everything it changed, commits included, on an outcome that does not pass", () => {
    expect(judgeChanges({ code: "scratch", passes: false, ...none, changed: ["src/a.ts", "bun.lock"], headMoved: true })).toEqual({ verdict: "reset", reasons: [], reset: ["src/a.ts", "bun.lock"], resetHead: true, notes: [] });
  });

  test("a moved remote branch, a changed git config or hook refuses at either level", () => {
    const j = judgeChanges({ code: "scratch", passes: false, ...none, changed: ["src/a.ts"], remoteMoved: true, configChanged: true, hooksChanged: true });
    expect(j).toMatchObject({ verdict: "refused", reset: [], resetHead: false });
    expect(j.reasons).toEqual(["the remote's copy of the branch moved since the run started", "the repo's git config changed since the run started", "a git hook changed since the run started"]);
  });

  test("another ref that moved is noted for the person, never refused: a sibling unit or a person moves refs too", () => {
    expect(judgeChanges({ code: "read", passes: true, ...none, refsChanged: true })).toEqual({ verdict: "clean", reasons: [], reset: [], resetHead: false, notes: ["a ref other than this unit's branch moved while the run worked (a branch, a tag or a stash): norn cannot tell who moved it"] });
    expect(judgeChanges({ code: "scratch", passes: false, ...none, headMoved: true, refsChanged: true }).notes).toEqual([]);
  });
});
