import Ajv from "/Users/jakubpruszynski/.norn/repos/norn-b68fe828/worktrees/gh-343-a-step-is-written-with-two-keys-for-one/node_modules/.bun/ajv@8.20.0/node_modules/ajv/dist/ajv.js";
import { parse } from "/Users/jakubpruszynski/.norn/repos/norn-b68fe828/worktrees/gh-343-a-step-is-written-with-two-keys-for-one/node_modules/.bun/yaml@2.9.1/node_modules/yaml/dist/index.js";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
const src = JSON.parse(readFileSync("/Users/jakubpruszynski/.norn/repos/norn-b68fe828/worktrees/gh-343-a-step-is-written-with-two-keys-for-one/packages/schema/json/workflow-source.schema.json", "utf8"));
const sh = JSON.parse(readFileSync("/Users/jakubpruszynski/.norn/repos/norn-b68fe828/worktrees/gh-343-a-step-is-written-with-two-keys-for-one/packages/schema/json/workflow-shared.schema.json", "utf8"));
console.log("source $schema:", src.$schema, "| $id:", src.$id);
let ajv: any; try { ajv = new (Ajv as any)({ strict: false, allErrors: false }); } catch (e) { console.log(e); }
const vs = ajv.compile(src), vh = ajv.compile(sh);
for (const f of ["quick","refinement","reproduce","slice","story","triage"]) {
  const now = parse(readFileSync("/Users/jakubpruszynski/.norn/repos/norn-b68fe828/worktrees/gh-343-a-step-is-written-with-two-keys-for-one/packages/cli/assets/workflows/"+f+".yaml","utf8"));
  const old = parse(execFileSync("git",["-C","/Users/jakubpruszynski/.norn/repos/norn-b68fe828/worktrees/gh-343-a-step-is-written-with-two-keys-for-one","show","origin/main:packages/cli/assets/workflows/"+f+".yaml"],{encoding:"utf8"}));
  console.log(f, "new wording valid:", vs(now), "| old wording valid:", vs(old));
}
for (const f of ["base-update","ship","sync"]) {
  const now = parse(readFileSync("/Users/jakubpruszynski/.norn/repos/norn-b68fe828/worktrees/gh-343-a-step-is-written-with-two-keys-for-one/packages/cli/assets/workflows/shared/"+f+".yaml","utf8"));
  const old = parse(execFileSync("git",["-C","/Users/jakubpruszynski/.norn/repos/norn-b68fe828/worktrees/gh-343-a-step-is-written-with-two-keys-for-one","show","origin/main:packages/cli/assets/workflows/shared/"+f+".yaml"],{encoding:"utf8"}));
  console.log("shared/"+f, "new valid:", vh(now), "| old valid:", vh(old));
}
const two = { name: "x", start: "a", steps: { a: { agent: "Do.", check: "true", outcomes: { done: "$done" }, means: { done: "d" } } } };
console.log("two head keys valid:", vs(two));
const mixed = { name: "x", start: "a", steps: { a: { agent: "Do.", skill: "norn-implement", outcomes: { done: "$done" }, means: { done: "d" } } } };
console.log("agent + old skill key valid:", vs(mixed));
