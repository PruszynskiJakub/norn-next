import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
const W = "/Users/jakubpruszynski/.norn/repos/norn-b68fe828/worktrees/gh-337-a-base-move-under-a-story-costs-a-whole";
const { lightAnchor } = await import(`${W}/packages/core/src/index.ts`);
const { loadWorkflow } = await import(`${W}/packages/cli/src/index.ts`).catch(() => ({}));
const RUN = process.argv[2]!;
const files = readdirSync(join(RUN, "receipts")).filter((f) => f.endsWith(".json")).sort();
const rs = files.map((f) => ({ n: Number(f.slice(0, 4)), file: f, receipt: JSON.parse(readFileSync(join(RUN, "receipts", f), "utf8")) }));
for (const r of rs) if (r.file === "0028-done.json") r.receipt.head_sha = "dc73fb91d".padEnd(40, "0"); // released norn writes no head_sha here; set as this branch would
const { parse } = await import("yaml");
const wf = parse(readFileSync(join(RUN, "workflow.yaml"), "utf8"));
for (const r of rs) if (r.receipt.kind === "approve" || r.receipt.outcome === "approve" || r.receipt.step === "open-pr") console.log(r.file, r.receipt.step, r.receipt.kind, r.receipt.outcome ?? "", r.receipt.head_sha ?? "");
console.log("steps:", Object.keys(wf.steps).join(","));
console.log("lightAnchor(real round) =", lightAnchor(rs, wf));
const plus = [...rs, { n: 999, file: "x", receipt: { kind: "classify", by: "norn", step: "open-pr", outcome: "done", rule: "git.open-pr", route: "t", at: "2026-11-11T12:00:00.000Z", receipt_id: "x", run_id: null } }];
console.log("same round + open-pr done after it =", lightAnchor(plus, wf));
