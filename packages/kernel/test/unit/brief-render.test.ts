import { describe, expect, test } from "bun:test";
import { type BriefRenderInput, renderBrief, renderReportHint, renderStepReminder } from "../../src/index.ts";

const input = (over: Partial<BriefRenderInput> = {}): BriefRenderInput => ({
  brief: { workflow: "story", hash: "a".repeat(64), step: "implement", attempt: 2, skills: ["norn-implement", "norn-tdd"], inputs: ["spec", { file: "docs/x.md", label: "Design" }] },
  unit: "gh-12/03",
  outcomes: ["done", "blocked"],
  instructions: "Build the slice.",
  means: { done: "the slice is built and its tests pass" },
  handoff: "handoffs/03.md",
  ...over,
});

describe("renderBrief", () => {
  test("names the unit, step and attempt, the work, the inputs, the handoff and every way to report", () => {
    const md = renderBrief(input());
    expect(md).toContain("# norn brief — gh-12/03 · implement #2");
    expect(md).toContain("Build the slice.");
    expect(md).toContain("Use the `norn-implement` and `norn-tdd` skills.");
    expect(md).toContain("- `spec`");
    expect(md).toContain("- Design: `docs/x.md`");
    expect(md).toContain("`handoffs/03.md`");
    expect(md).toContain("- `norn done done` — the slice is built and its tests pass");
    expect(md).toContain("- `norn done blocked`");
    expect(md).toContain('`norn ask "<one self-contained question>"`');
    expect(md).toContain('`norn stuck "<reason>"`');
  });

  const outputs = (md: string) => md.slice(md.indexOf("## Outputs"), md.indexOf("## Finish with exactly one of"));

  test("a step that needs a criteria report names under Outputs where it goes, what it holds and the outcomes that need it; done takes no file", () => {
    const required = renderBrief(input({ outcomes: ["pass", "fail"], means: {}, criteria: { required: true, verdict: { pass: "pass", fail: "fail" } }, outDir: ".agents/run/out" }));
    expect(required).toContain("- `norn done pass`\n");
    expect(required).toContain("- `norn done fail`\n");
    const out = outputs(required);
    expect(out).toContain("- `criteria` → `$NORN_OUT/criteria.json` (`.agents/run/out/criteria.json`), before `norn done pass` or `norn done fail`: a JSON array with one verdict per acceptance criterion");
    expect(out).toContain("covering exactly the unit's frontmatter `criteria`");
    expect(out).toContain("`pass` only when it is `pass`, `fail` only when it is `fail`");
    expect(out).toContain("- `evidence` → `$NORN_OUT/evidence/` (`.agents/run/out/evidence/`): the files a criteria verdict's evidence names");
    // only an outcome gated by a verdict needs the report when the step does not require one
    const gated = outputs(renderBrief(input({ outcomes: ["done", "unsure"], means: {}, criteria: { required: false, verdict: { unsure: "unverified" } } })));
    expect(gated).toContain("- `criteria` → `$NORN_OUT/criteria.json`, before `norn done unsure`:");
    expect(renderBrief(input())).not.toContain("criteria.json");
    expect(renderBrief(input())).not.toContain("--criteria");
  });

  test("an outcome that hands back findings names them under Outputs with their place and shape, and what else may carry the rework", () => {
    const md = renderBrief(input({ outcomes: ["approve", "changes_requested"], means: {}, handBack: { changes_requested: "findings" } }));
    expect(md).toContain("- `norn done changes_requested`\n");
    expect(outputs(md)).toContain(
      '- `findings` → `$NORN_OUT/findings.json`, before `norn done changes_requested`: {"findings": [...]} or the array alone, each finding with a "title" and a "severity"',
    );
    expect(outputs(md)).toContain("a `--note` saying what to rework");
    expect(md).not.toContain("--findings");
  });

  test("a produced file is named under Outputs with its path and the outcomes it is due on", () => {
    const md = renderBrief(input({ produced: [{ name: "pr_body", path: ".agents/specs/gh-12/pr.md", outcomes: ["done"] }] }));
    expect(outputs(md)).toContain("- `pr_body` → `.agents/specs/gh-12/pr.md`, before `norn done done`: a report without it, or with it empty, is refused.");
  });

  test("Outputs say once that the handoff is every agent step's and that a person's rejection reaches the step it sends back as findings", () => {
    const out = outputs(renderBrief(input()));
    expect(out).toContain("- `handoff` → `handoffs/03.md`, with every outcome: this unit's current state, kept current (see Handoff).");
    expect(out).toContain("A person's rejection at a gate needs no report from you: its reason reaches the step it sends the work back to as findings.");
  });

  test("says to commit the work before reporting done, as a done over uncommitted changes is refused", () => {
    const md = renderBrief(input());
    const finish = md.slice(md.indexOf("## Finish with exactly one of"));
    expect(finish).toContain("Commit your work before `norn done`");
    expect(finish).toContain("`git status`");
  });

  test("is deterministic", () => {
    expect(renderBrief(input())).toBe(renderBrief(structuredClone(input())));
  });

  test("shows rework first when the run reworks something", () => {
    const md = renderBrief(input({ rework: "Check `test` exited 1." }));
    expect(md.indexOf("## Rework")).toBeGreaterThan(-1);
    expect(md.indexOf("## Rework")).toBeLessThan(md.indexOf("## Inputs"));
  });

  test("a retry says the session it replaces ended without a report, before the rework", () => {
    const md = renderBrief(input({ retry: "run `r-1`, nudged 2 times", rework: "Check `test` exited 1." }));
    expect(md).toContain("## Retry\n\nA previous session of this attempt ended without reporting (run `r-1`, nudged 2 times). This is a fresh session:");
    expect(md.indexOf("## Retry")).toBeLessThan(md.indexOf("## Rework"));
    expect(renderBrief(input())).not.toContain("## Retry");
  });

  test("carries the person's gate rulings and the unit's history this round, each only when there is one", () => {
    const md = renderBrief(input({ rulings: ["`gh-12` `ready #1` `reject` by jo: Keep the old flag."], history: ["`build #1` reported `done`", "`ready #1` `reject` by jo"] }));
    expect(md).toContain("## Rulings");
    expect(md).toContain("- `gh-12` `ready #1` `reject` by jo: Keep the old flag.");
    expect(md).toContain("## History\n\nWhat this unit's steps did this round, oldest first:\n\n- `build #1` reported `done`\n- `ready #1` `reject` by jo\n");
    expect(md.indexOf("## Rulings")).toBeLessThan(md.indexOf("## Inputs"));
    expect(md.indexOf("## History")).toBeLessThan(md.indexOf("## Rules"));
    const none = renderBrief(input({ rulings: [], history: [] }));
    expect(none).not.toContain("## Rulings");
    expect(none).not.toContain("## History");
  });

  test("carries the answers earlier sessions of the step were given, so a fresh session does not ask again", () => {
    const md = renderBrief(input({ answered: [{ question: "Which branch?", answer: "main,\nnot develop" }, { answer: "yes" }] }));
    expect(md).toContain("## Answers already given");
    expect(md).toContain("- Asked: Which branch?\n  Answered: main,\n  not develop");
    expect(md).toContain("- Answered: yes");
    expect(renderBrief(input({ answered: [] }))).not.toContain("## Answers already given");
  });

  test("readable inputs replace the bare names: each with its path, short text fenced inline, a note where nothing is held; the story leads", () => {
    const md = renderBrief(
      input({
        story: { key: "gh-12", title: "Sign in with a passkey", url: "https://forge.example/12" },
        inputs: [
          { name: "spec", label: "the story's spec", path: ".agents/specs/gh-1/spec.md" },
          { name: "last_check", label: "the last check's result", path: ".agents/run/in/last_check.md", text: "Check `test` exited 1.\n\n```\nFAIL a.test.ts\n```" },
          { name: "diff", note: "run `git diff main...HEAD`" },
        ],
        inputsNote: "`.agents/run/in/` is ignored by git.",
      }),
    );
    expect(md).toContain("## Story\n\n`gh-12`: Sign in with a passkey (https://forge.example/12)\n\n## Your work");
    expect(md).toContain("- `spec` — the story's spec: `.agents/specs/gh-1/spec.md`\n- `last_check` — the last check's result: `.agents/run/in/last_check.md`\n  ````\n  Check `test` exited 1.\n\n  ```\n  FAIL a.test.ts\n  ```\n  ````\n- `diff` — run `git diff main...HEAD`");
    expect(md).toContain("`.agents/run/in/` is ignored by git.");
    expect(md).not.toContain("- `handoff`\n");
  });

  test("an attended step sends questions to the person, never through ask", () => {
    const md = renderBrief(input({ attended: true }));
    expect(md).toContain("A person works with you in this session");
    expect(md).not.toContain('norn ask "<one');
  });

  test("the commands follow the spelling the caller gives", () => {
    const md = renderBrief(input({ commands: { brief: "nb", done: "nd", ask: "na", stuck: "ns" } }));
    expect(md).toContain("`nd done`");
    expect(md).not.toContain("norn done");
  });
});

describe("report hints", () => {
  test("a stop block says how to report once", () => {
    const hint = renderReportHint({ unit: "gh-12", step: "build", outcomes: ["done", "blocked"] });
    expect(hint).toContain("step build of gh-12 has no report");
    expect(hint).toContain("`norn done <done|blocked>`");
    expect(hint).toContain('`norn ask "<question>"`');
  });

  test("an attended step's reminder never offers ask", () => {
    const text = renderStepReminder({ unit: "gh-12", step: "build", outcomes: ["done"], attended: true });
    expect(text).toContain("once the person agrees");
    expect(text).not.toContain("norn ask");
  });
});

describe("the brief's Rules render the step's effective grant", () => {
  const rules = (md: string) => md.slice(md.indexOf("## Rules"), md.indexOf("## Finish with exactly one of"));
  const finish = (md: string) => md.slice(md.indexOf("## Finish with exactly one of"));
  const granted = (grant: NonNullable<BriefRenderInput["brief"]["grant"]>) => renderBrief(input({ brief: { ...input().brief, grant } }));

  test("a grant is named whole, each capability says what it lets the step do, and anything else is not the step's", () => {
    const r = rules(granted(["code:read", "docs:write", "exec:checks", "out:findings"]));
    expect(r).toContain("- This step is granted `code:read`, `docs:write`, `exec:checks` and `out:findings`, and nothing else.");
    expect(r).toContain("- `code:read`: read the code and change none of it.");
    expect(r).toContain("a tracked change, a commit, a moved ref or remote branch, or a changed git config or hook refuses `norn done`");
    expect(r).toContain("- `exec:checks`: run the repo's checks");
    expect(r).toContain("- `out:findings`: write findings");
  });

  test("a step that may not keep code is told to leave it as it was, not to commit it", () => {
    expect(finish(granted(["code:read"]))).toContain("Leave the code as the run found it");
    expect(finish(granted(["code:read"]))).not.toContain("Commit your work before");
    const scratch = granted(["code:scratch", "exec:any"]);
    expect(rules(scratch)).toContain("- `code:scratch`: change the code only to try things out: norn resets it to where the run started once you report.");
    expect(finish(scratch)).toContain("Nothing you change in the code is kept");
    expect(finish(granted(["code:write"]))).toContain("Commit your work before `norn done`");
    expect(finish(renderBrief(input()))).toContain("Commit your work before `norn done`");
  });

  test("a grant to post on the story's item lifts the rule that only norn changes the remote, for that alone", () => {
    const r = rules(granted(["code:scratch", "tracker:comment", "tracker:label"]));
    expect(r).toContain("- `tracker:comment`: comment on the story's item.");
    expect(r).toContain("Never `git push`, never switch branches or worktrees, and change nothing on the remote beyond what your grant names");
    expect(rules(granted(["code:read"]))).toContain("never change the remote (a pull request, an issue, a comment)");
  });
});
