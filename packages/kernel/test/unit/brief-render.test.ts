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

  test("a step that needs a criteria report puts --criteria on the outcomes that need it and says what the report holds", () => {
    const required = renderBrief(input({ outcomes: ["pass", "fail"], means: {}, criteria: { required: true, verdict: { pass: "pass", fail: "fail" } } }));
    expect(required).toContain("- `norn done pass --criteria <file>`");
    expect(required).toContain("- `norn done fail --criteria <file>`");
    expect(required).toContain("This step requires `--criteria <file>`");
    expect(required).toContain("`pass` only when it is `pass`, `fail` only when it is `fail`");
    // only an outcome gated by a verdict needs the report when the step does not require one
    const gated = renderBrief(input({ outcomes: ["done", "unsure"], means: {}, criteria: { required: false, verdict: { unsure: "unverified" } } }));
    expect(gated).toContain("- `norn done done`\n");
    expect(gated).toContain("- `norn done unsure --criteria <file>`");
    expect(gated).toContain("An outcome gated by a verdict requires `--criteria <file>`");
    expect(renderBrief(input())).not.toContain("--criteria");
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
          { name: "last_check", label: "the last check's result", path: ".agents/inputs/last_check.md", text: "Check `test` exited 1.\n\n```\nFAIL a.test.ts\n```" },
          { name: "diff", note: "run `git diff main...HEAD`" },
        ],
        inputsNote: "`.agents/inputs/` is ignored by git.",
      }),
    );
    expect(md).toContain("## Story\n\n`gh-12`: Sign in with a passkey (https://forge.example/12)\n\n## Your work");
    expect(md).toContain("- `spec` — the story's spec: `.agents/specs/gh-1/spec.md`\n- `last_check` — the last check's result: `.agents/inputs/last_check.md`\n  ````\n  Check `test` exited 1.\n\n  ```\n  FAIL a.test.ts\n  ```\n  ````\n- `diff` — run `git diff main...HEAD`");
    expect(md).toContain("`.agents/inputs/` is ignored by git.");
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
