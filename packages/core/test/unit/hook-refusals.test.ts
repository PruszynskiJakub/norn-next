import { describe, expect, test } from "bun:test";
import type { HookFact, UnitState, UnitStateRecord } from "@norn/schema";
import type { AgentUnit } from "../../src/agent-unit.ts";
import { type HookAnswerInput, checkoutNames, hookAnswer } from "../../src/hook.ts";
import type { ToolCall } from "../../src/ports.ts";
import { at, SLICE_WF, sliceUnit, STORY_WF, stateFor, storyUnit } from "../fixtures.ts";

const unit = sliceUnit("gh-1", "01", "a");
const RUN = { run_id: "01JRRRRRRRRRRRRRRRRRRRRRRR", step: "implement", attempt: 1, agent: "claude", started_at: at(), agent_session_id: "sess-A" } as NonNullable<UnitState["run"]>;
const CLAUDE = { name: "claude", tier: "blocking" as const, hookEvents: { Stop: "turn_end", PreToolUse: "tool_use" } as const };
const PRE: HookFact = { event: "tool_use", at: at(), agent: "claude", native: "PreToolUse", cwd: "/repo/.worktrees/gh-1", agent_session_id: "sess-A" };

function session(patch: Partial<UnitStateRecord> = { status: "running", run: RUN }): AgentUnit {
  return { unit, state: stateFor(unit, SLICE_WF, patch), workflow: SLICE_WF, receipts: [], unapplied: [] };
}

const shell = (command: string): ToolCall => ({ kind: "shell", command });
const ask = (command: string, input: Partial<HookAnswerInput> = {}) => hookAnswer({ session: session(), fact: PRE, toolCall: shell(command), adapter: CLAUDE, ...input });
const verdict = (command: string, input: Partial<HookAnswerInput> = {}) => {
  const a = ask(command, input);
  if (a.kind !== "deny") return a.kind;
  if (a.reason.includes("only norn pushes")) return "push";
  if (a.reason.includes("switch branches or worktrees")) return "switch";
  if (a.reason.includes("changes the remote")) return "remote";
  return a.reason;
};

describe("hookAnswer: a git push is refused with the rule's reason", () => {
  test("the denial carries the no-push rule, its reason, and that the person can run it", () => {
    const a = ask("git push");
    expect(a.kind).toBe("deny");
    const reason = a.kind === "deny" ? a.reason : "";
    expect(reason).toContain("only norn pushes");
    expect(reason).toContain("a push outside norn is an effect with no receipt, and receipts come before effects");
    expect(reason).toContain("if you want this pushed, run it yourself");
  });

  test.each([
    "git push origin HEAD",
    "GIT_TRACE=1 FOO=bar git push",
    "git -C ../other push",
    "git -c core.hooksPath=/dev/null push --force",
    "bun run test; git push",
    "bun run test && git push",
    "false || git push",
    "echo y | git push",
    "bun run test\ngit push",
    "git add . && git commit -m 'wip' && git push -u origin HEAD",
    "/usr/bin/git push",
  ])("%p is refused", (command) => {
    expect(verdict(command)).toBe("push");
  });

  test("attended steps are refused alike", () => {
    const story = storyUnit("gh-2");
    const s: AgentUnit = { unit: story, state: stateFor(story, STORY_WF, { step: "refine", status: "running", run: { ...RUN, step: "refine" } }), workflow: STORY_WF, receipts: [], unapplied: [] };
    expect(verdict("git push", { session: s })).toBe("push");
  });
});

describe("hookAnswer: a branch or worktree switch is refused", () => {
  test.each([
    "git switch main",
    "git switch -c feature",
    "git checkout -b feature",
    "git checkout -B feature origin/main",
    "git checkout --orphan empty",
    "git checkout --detach",
    "git checkout -",
    "gh pr checkout 12",
    "glab mr checkout 12",
    "git worktree add ../x",
    "git worktree move ../x ../y",
    "git worktree remove ../x",
  ])("%p is refused with the no-switch reason", (command) => {
    expect(verdict(command)).toBe("switch");
  });

  test("the no-switch reason says a switch leaves the unit's branch", () => {
    const a = ask("git switch main");
    expect(a.kind === "deny" && a.reason).toContain("a switch leaves the unit's branch, where norn commits what is left at the report");
  });

  test("a bare checkout is refused only when its name resolves to a commit and no `--` follows", () => {
    expect(checkoutNames("git checkout main")).toEqual(["main"]);
    expect(verdict("git checkout main", { commits: ["main"] })).toBe("switch");
    expect(verdict("git checkout src/a.ts", { commits: [] })).toBe("allow");
    expect(verdict("git checkout main")).toBe("allow"); // no fact gathered: allow
    expect(checkoutNames("git checkout -- main")).toEqual([]);
    expect(verdict("git checkout -- main", { commits: ["main"] })).toBe("allow");
    expect(checkoutNames("git checkout main -- src/a.ts")).toEqual([]);
    expect(verdict("git checkout main -- src/a.ts", { commits: ["main"] })).toBe("allow");
  });

  test("worktree reads and an agent tool's own worktree switch", () => {
    expect(verdict("git worktree list")).toBe("allow");
    expect(hookAnswer({ session: session(), fact: PRE, toolCall: { kind: "worktree_switch" }, adapter: CLAUDE }).kind).toBe("deny");
  });
});

describe("hookAnswer: a remote-changing gh or glab command is refused against the list", () => {
  test.each([
    "gh pr create --fill",
    "gh pr edit 3 --add-label x",
    "gh pr comment 3 -b hi",
    "gh pr review 3 --approve",
    "gh pr ready 3",
    "gh pr merge 3",
    "gh pr close 3",
    "gh pr reopen 3",
    "gh issue create -t x",
    "gh issue comment 3 -b hi",
    "gh issue close 3",
    "glab mr create",
    "glab mr merge 3",
    "glab issue reopen 3",
    "glab mr note 1 -m x",
    "glab issue note 3 -m x",
    "glab mr update 1 --title x",
    "glab issue update 1 --label bug",
    "glab mr approve 1",
    "glab mr revoke 1",
    "gh label create bug",
    "glab label delete bug",
    "gh release create v1",
    "glab release delete v1",
    "gh repo edit --description x",
    "gh repo delete me/x --yes",
    "gh api -X POST repos/o/r/issues",
    "gh api --method PATCH repos/o/r",
    "gh api --method=DELETE repos/o/r",
    "gh api repos/o/r/issues -f title=x",
    "gh api repos/o/r/issues -F n=1",
    "gh api repos/o/r/issues --field title=x",
    "gh api repos/o/r/issues --raw-field title=x",
    "gh api graphql --input q.json",
    "glab api -X PUT projects/1",
    "gh -R o/r pr merge 3",
  ])("%p is refused with the remote rule's reason", (command) => {
    expect(verdict(command)).toBe("remote");
  });

  test("the remote rule's reason is given", () => {
    const a = ask("gh pr merge 3");
    expect(a.kind === "deny" && a.reason).toContain("only norn makes the changes its receipts record");
  });
});

describe("hookAnswer: what is not on the list is allowed", () => {
  test.each([
    "gh pr view 3",
    "gh pr list",
    "gh pr status",
    "gh pr diff 3",
    "gh pr checks 3",
    "gh issue view 3 --comments",
    "glab mr view 3",
    "gh api repos/o/r/issues",
    "gh api -X GET repos/o/r/issues",
    "gh label list",
    "gh release view v1",
    "gh repo view",
    "echo 'git push'",
    'git commit -m "do not git push yet"',
    "echo \"a; git push\"",
    "git status && git log --oneline",
    "cat <<EOF\ngit push\nEOF",
    "echo 'unterminated && git push",
    "bun run test",
  ])("%p is allowed", (command) => {
    expect(verdict(command, { commits: [] })).toBe("allow");
  });
});

describe("hookAnswer: refusals hold every time and only in a unit", () => {
  test("a refused call is refused on every retry", () => {
    for (let i = 0; i < 10; i++) expect(verdict("git push")).toBe("push");
  });

  test("without a loadable unit session, or with no tool call, it allows", () => {
    expect(verdict("git push", { session: null })).toBe("allow");
    expect(hookAnswer({ session: session(), fact: PRE, toolCall: null, adapter: CLAUDE })).toEqual({ kind: "allow" });
  });
});
