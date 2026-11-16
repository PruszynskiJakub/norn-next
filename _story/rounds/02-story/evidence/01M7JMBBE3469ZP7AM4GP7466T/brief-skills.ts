import { renderBrief } from "/Users/jakubpruszynski/.norn/repos/norn-b68fe828/worktrees/gh-343-a-step-is-written-with-two-keys-for-one/packages/core/src/brief.ts";
import { SLICE_WF, sliceUnit, stateFor } from "/Users/jakubpruszynski/.norn/repos/norn-b68fe828/worktrees/gh-343-a-step-is-written-with-two-keys-for-one/packages/core/test/fixtures.ts";
const SLICE = (await import("/Users/jakubpruszynski/.norn/repos/norn-b68fe828/worktrees/gh-343-a-step-is-written-with-two-keys-for-one/packages/core/test/fixtures.ts")) as any;
for (const skills of [["norn-implement"], ["norn-implement","norn-tdd"], ["norn-implement","norn-tdd","norn-codebase-design"], []]) {
  const wf: any = structuredClone(SLICE_WF);
  wf.steps.implement.skills = skills; wf.steps.implement.instructions = "Build the login form test-first."; delete wf.steps.implement.description;
  const unit = SLICE.SLICE ?? sliceUnit;
  const st = stateFor(unit as any, wf);
  const b = renderBrief({ unit: unit as any, state: st, workflow: wf, mode: "auto", runner: "herdr", paths: { worktree: "/w", spec_dir: ".s", story_file: ".s/story.md", slice_file: ".s/slices/02.md", unit_dir: ".s/runs/02" }, diff_range: "a...HEAD", handoff: null, receipts: [], limits: { deadline: "60m", nudges: 2, retries: 1, slot: 3, port_base: 4030 } } as any);
  const m = b.markdown; const i = m.indexOf("## Your work"); 
  console.log("skills=" + JSON.stringify(skills) + "\n" + m.slice(i, m.indexOf("## Finish", i)) + "----");
}
