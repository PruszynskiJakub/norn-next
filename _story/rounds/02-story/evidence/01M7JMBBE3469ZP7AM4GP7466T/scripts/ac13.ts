import { store } from "./lib.ts";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
const M = process.argv[2];
const old = readFileSync(`${M}/triage.yaml`, "utf8");
// pin read: a unit dir under the evidence dir (not a runs/ folder)
const unitDir = `${M}/../pin-unit`; mkdirSync(unitDir, { recursive: true });
writeFileSync(store.pinnedWorkflowPath(unitDir), old);
const pin = store.readPinnedWorkflow(unitDir);
console.log("pin path:", store.pinnedWorkflowPath(unitDir).replace(/.*scratchpad/, "<scratch>"));
console.log("readPinnedWorkflow(old triage.yaml):", pin.ok, pin.ok ? JSON.stringify(pin.value.workflow.steps.explore).slice(0, 300) + "…" : JSON.stringify(pin));
console.log("pin hash == sha256(old text):", pin.ok && pin.value.hash === store.sha256(old), "| source kept verbatim:", pin.ok && pin.value.source === old);
// branch read of a workflow using old shared files
const sh = (n: string) => readFileSync(`${M}/shared/${n}.yaml`, "utf8");
const q = readFileSync(`${M}/quick.yaml`, "utf8");
const br = store.loadWorkflowText("quick", q, ".agents/workflows/quick.yaml", "copy", undefined, sh);
console.log("loadWorkflowText(quick, copy, old shared files):", br.ok, br.ok ? `${Object.keys(br.value.workflow.steps).length} steps` : JSON.stringify(br));
const ck = store.loadWorkflowText("quick", q, ".agents/workflows/quick.yaml", "checkout", undefined, sh);
console.log("loadWorkflowText(quick, checkout, old):", ck.ok, JSON.stringify(ck.ok ? "" : ck.error));
const pc = store.parseWorkflowText(old, "x.yaml", "checkout");
console.log("parseWorkflowText(old triage, checkout):", pc.ok, JSON.stringify(pc.ok ? "" : pc.error));
