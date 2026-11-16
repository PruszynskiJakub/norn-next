import { readFileSync } from "node:fs";
const s = JSON.parse(readFileSync("/Users/jakubpruszynski/.norn/repos/norn-b68fe828/worktrees/gh-343-a-step-is-written-with-two-keys-for-one/packages/schema/json/workflow-source.schema.json", "utf8"));
const step = Object.values(s.properties.steps.patternProperties)[0];
const alts = (step as any).anyOf ?? (step as any).oneOf ?? [];
console.log("step alternatives:", alts.length, Object.keys(step as any));
for (const a of alts) { const props = Object.keys(a.properties ?? {}); console.log(" required:", JSON.stringify(a.required), " old keys allowed:", JSON.stringify(props.filter((p) => ["type","skill","instructions","run","prompt","action"].includes(p))), " additionalProperties:", a.additionalProperties); }
