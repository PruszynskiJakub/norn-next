import { applyReceipts } from "/Users/jakubpruszynski/.norn/repos/norn-b68fe828/worktrees/gh-345-every-route-back-needs-a-hand-written/packages/core/src/apply.ts";
import { loadWorkflows } from "/Users/jakubpruszynski/.norn/repos/norn-b68fe828/worktrees/gh-345-every-route-back-needs-a-hand-written/packages/store/src/index.ts";
import { at, numbered, receipt, sliceUnit, stateFor } from "/Users/jakubpruszynski/.norn/repos/norn-b68fe828/worktrees/gh-345-every-route-back-needs-a-hand-written/packages/core/test/fixtures.ts";
const lines: string[] = [];
for (const [label, root] of [["today (base files)", "/private/tmp/claude-501/-Users-jakubpruszynski--norn-repos-norn-b68fe828-worktrees-gh-345-every-route-back-needs-a-hand-written/a123bec2-7f6b-4e73-bbe1-b07081c9342f/scratchpad/qa/today-bundled"], ["head (edited files)", "/private/tmp/claude-501/-Users-jakubpruszynski--norn-repos-norn-b68fe828-worktrees-gh-345-every-route-back-needs-a-hand-written/a123bec2-7f6b-4e73-bbe1-b07081c9342f/scratchpad/qa/head-bundled"]]) {
  const wf = loadWorkflows(root).workflows.slice!.workflow;
  const unit = sliceUnit("gh-1", "02", "form");
  const RUN = "01JDDDDDDDDDDDDDDDDDDDDDDD";
  const step = (st: any, m: (s: any) => any) => applyReceipts(st, [numbered(st.applied_through + 1, m(st))], { workflow: wf, now: at() }).state;
  const classify = (o: string) => (s: any) => receipt(s, "classify", { outcome: o, rule: "t", route: "park" }, "norn");
  const started = (s: any) => ({ ...receipt(s, "started", { how: "manual", worktree: "/w" }), run_id: RUN });
  const done = (o: string) => (s: any) => receipt(s, "done", { outcome: o, handoff: "h" });
  let st: any = stateFor(unit, wf, { step: "integrate", visits: { integrate: 1 } });
  const show = (t: string) => lines.push(`${label} | ${t} | step=${st.step} status=${st.status} counters=${JSON.stringify(st.counters)} park=${st.park ? JSON.stringify(st.park.counter) : "-"}`);
  for (let i = 1; i <= 3; i++) { st = step(st, classify("conflict")); show(`conflict #${i}`); if (st.status === "stuck") break; st = step(st, started); st = step(st, done("done")); show(`merge done #${i}`); }
  st = stateFor(unit, wf, { step: "integrate", visits: { integrate: 1 } });
  st = step(st, classify("conflict")); st = step(st, started); st = step(st, done("done")); st = step(st, classify("done")); show("conflict, merge, then integrate.done");
}
console.log(lines.join("\n"));
