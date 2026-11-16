import { load, show, eq, R } from "./lib.ts";
import { readFileSync } from "node:fs";
const two = `name: wf\nstart: s\nsteps:\n  s:\n    agent: do it\n    check: bun test\n    outcomes: { done: $done }\n    means: { done: ok }\n`;
const none = `name: wf\nstart: s\nsteps:\n  s:\n    skills: [x]\n    outcomes: { done: $done }\n`;
const threeVerbs = `name: wf\nstart: s\nsteps:\n  s:\n    open-pr:\n    push:\n    outcomes: { done: $done }\n`;
show("two head keys", load(two).refused); show("no head key", load(none).refused); show("two verbs", load(threeVerbs).refused);
// use: step loads as today: quick.yaml + shared files at head vs the same workflow at origin/main through the copy translator
const A = `${R}/packages/cli/assets/workflows`;
const sh = (d: string) => Object.fromEntries(["sync", "base-update", "ship"].map((n) => [n, readFileSync(`${d}/shared/${n}.yaml`, "utf8")]));
const wf = (t: string) => t.replace(/^name: \w+/m, "name: wf");
const head = load(wf(readFileSync(`${A}/quick.yaml`, "utf8")), "checkout", sh(A));
const MAIN = process.argv[2];
const main = load(wf(readFileSync(`${MAIN}/quick.yaml`, "utf8")), "copy", sh(MAIN));
console.log("use-step quick.yaml head(checkout) ok:", head.ok, "issues", JSON.stringify(head.issues), "| origin/main(copy) ok:", main.ok);
console.log("use-step workflow models equal:", eq(head.workflow, main.workflow));
console.log("steps brought in by use:", Object.keys(head.workflow.steps).join(","));
