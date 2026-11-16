import Ajv from "/Users/jakubpruszynski/.norn/repos/norn-b68fe828/worktrees/gh-343-a-step-is-written-with-two-keys-for-one/packages/schema/node_modules/ajv/dist/ajv.js";
import { parse } from "/Users/jakubpruszynski/.norn/repos/norn-b68fe828/worktrees/gh-343-a-step-is-written-with-two-keys-for-one/node_modules/yaml/dist/index.js";
import { readFileSync } from "node:fs";
const A: any = (Ajv as any).default ?? Ajv; const ajv = new A({ allErrors: true, strict: false });
const fn = ajv.compile(JSON.parse(readFileSync("/Users/jakubpruszynski/.norn/repos/norn-b68fe828/worktrees/gh-343-a-step-is-written-with-two-keys-for-one/packages/schema/json/workflow-source.schema.json", "utf8")));
const base = parse(readFileSync("/Users/jakubpruszynski/.norn/repos/norn-b68fe828/worktrees/gh-343-a-step-is-written-with-two-keys-for-one/packages/cli/assets/workflows/quick.yaml", "utf8"));
const first = Object.keys(base.steps).find((k) => "agent" in base.steps[k])!;
for (const [k, val] of [["type","agent"],["skill","x"],["instructions","x"],["run","true"],["prompt","x"],["action","open-pr"]]) {
  const d = structuredClone(base); d.steps[first][k] = val; console.log(k.padEnd(13), fn(d) ? "ACCEPTED" : "rejected");
}
const d = structuredClone(base); const o = Object.keys(d.steps[first].outcomes)[0]; const r = d.steps[first].outcomes[o];
d.steps[first].outcomes[o] = { to: typeof r === "string" ? r : (r.to ?? "x"), means: "m" }; console.log("edge means   ", fn(d) ? "ACCEPTED" : "rejected");
