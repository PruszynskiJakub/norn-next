import { load, show, eq } from "./lib.ts";
const cases: Array<[string, string, string]> = [
  ["update-branch", "type: git\n    action: update", "{ done: $done, clean: $done, resolved: $done, conflict: { to: s, counter: c } }"],
  ["open-pr", "type: git\n    action: open-pr", "{ done: $done }"],
  ["integrate", "type: git\n    action: integrate", "{ done: $done }"],
  ["push", "type: git\n    action: push", "{ done: $done }"],
  ["await-merge", "type: merge", "{ stale: { to: s, counter: c } }"],
  ["slices", "type: slices", "{ done: $done }"],
];
const wf = (step: string, outs: string) => `name: wf\nstart: s\nsteps:\n  s:\n    ${step}\n    outcomes: ${outs}\ncounters: { c: { max: 2 } }\n`;
for (const [verb, old, outs] of cases) {
  const n = load(wf(`${verb}:`, outs)); const o = load(wf(old, outs), "copy");
  console.log(`${verb}: new ok=${n.ok} model=${JSON.stringify(n.workflow?.steps.s)} issues=${JSON.stringify(n.issues)} | equals old-wording copy: ${eq(n.workflow, o.workflow)}`);
}
console.log("\n# light outcomes (clean/resolved) on non-update git verbs");
for (const verb of ["open-pr", "integrate", "push"]) {
  const n = load(wf(`${verb}:`, "{ done: $done, clean: $done, resolved: $done }"));
  console.log(verb, JSON.stringify(n.ok), JSON.stringify(n.refused ?? n.issues?.map((i: any) => `${i.code} ${i.path} ${i.message}`)));
}
console.log("\n# other foreign outcomes");
for (const [verb, outs] of [["await-merge", "{ done: $done }"], ["slices", "{ clean: $done }"], ["update-branch", "{ pass: $done }"]]) {
  const n = load(wf(`${verb}:`, outs));
  console.log(verb, outs, n.ok, JSON.stringify(n.refused?.errors ?? n.issues?.map((i: any) => `${i.code} ${i.path} ${i.message}`)));
}
console.log("\n# verb with a value");
for (const verb of ["open-pr: now", "update-branch: main", "await-merge: yes", "slices: [a]"]) {
  const n = load(wf(verb, "{ done: $done }"));
  console.log(verb, "->", JSON.stringify(n.refused ?? n));
}
