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

  test("is deterministic", () => {
    expect(renderBrief(input())).toBe(renderBrief(structuredClone(input())));
  });

  test("shows rework first when the run reworks something", () => {
    const md = renderBrief(input({ rework: "Check `test` exited 1." }));
    expect(md.indexOf("## Rework")).toBeGreaterThan(-1);
    expect(md.indexOf("## Rework")).toBeLessThan(md.indexOf("## Inputs"));
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
          { name: "spec", label: "the story's spec", path: ".norn/spec.md" },
          { name: "last_check", label: "the last check's result", path: ".norn/last_check.md", text: "Check `test` exited 1.\n\n```\nFAIL a.test.ts\n```" },
          { name: "diff", note: "run `git diff main...HEAD`" },
        ],
        inputsNote: "`.norn/` is ignored by git.",
      }),
    );
    expect(md).toContain("## Story\n\n`gh-12`: Sign in with a passkey (https://forge.example/12)\n\n## Your work");
    expect(md).toContain("- `spec` — the story's spec: `.norn/spec.md`\n- `last_check` — the last check's result: `.norn/last_check.md`\n  ````\n  Check `test` exited 1.\n\n  ```\n  FAIL a.test.ts\n  ```\n  ````\n- `diff` — run `git diff main...HEAD`");
    expect(md).toContain("`.norn/` is ignored by git.");
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
