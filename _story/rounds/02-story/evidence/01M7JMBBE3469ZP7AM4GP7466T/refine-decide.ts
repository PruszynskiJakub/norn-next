import { readFileSync, readdirSync } from "node:fs";
import { decide } from "/Users/jakubpruszynski/.norn/repos/norn-b68fe828/worktrees/gh-343-a-step-is-written-with-two-keys-for-one/packages/core/src/decide/index.ts";
const G = "/Users/jakubpruszynski/.norn/repos/norn-b68fe828/worktrees/gh-343-a-step-is-written-with-two-keys-for-one/packages/core/test/golden/";
// 1) every golden case decided again by the current decide equals its recorded decisions
let same = 0, diff = 0;
for (const n of readdirSync(G).filter((n) => n.endsWith(".json"))) {
  const c = JSON.parse(readFileSync(G + n, "utf8"));
  const got = JSON.stringify(decide(c.facts, c.workflows, c.config).map((d: any) => ({ unit: d.unit, rule: d.rule, action: d.action })));
  JSON.stringify(c.decisions) === got ? same++ : (diff++, console.log("DIFF", n));
}
console.log("golden cases re-decided:", same, "identical,", diff, "different");
// 2) refine recognised by skills including norn-refine
const c = JSON.parse(readFileSync(G + "human-72c5b46b6549.json", "utf8"));
const run = (skills: string[]) => { const x = structuredClone(c); x.facts.stories[0].units[0].workflow.steps.refine.skills = skills;
  return decide(x.facts, x.workflows, x.config).filter((d: any) => d.unit === "gh-21").map((d: any) => d.rule); };
console.log('skills ["norn-refine"] ->', run(["norn-refine"]));
console.log('skills ["norn-interview","norn-refine"] ->', run(["norn-interview", "norn-refine"]));
console.log('skills ["norn-implement"] ->', run(["norn-implement"]));
console.log('skills [] ->', run([]));
