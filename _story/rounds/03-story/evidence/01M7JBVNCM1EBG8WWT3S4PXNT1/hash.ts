import { loadWorkflows } from "./packages/store/src/index.ts";
import { workflowHash } from "./packages/core/src/index.ts";
import { mkdtempSync, cpSync, mkdirSync } from "node:fs"; import { join } from "node:path";
const [baseDir, headDir] = process.argv.slice(2);
function load(dir: string) { const root = mkdtempSync(join(process.env.TMPDIR!, "wf-")); mkdirSync(join(root, ".agents"), {recursive:true}); cpSync(dir, join(root, ".agents/workflows"), {recursive:true}); return loadWorkflows(root); }
const b = load(baseDir), h = load(headDir);
console.log("head errors:", JSON.stringify(h.errors.map(e=>e.file)), "base errors:", JSON.stringify(b.errors.map(e=>e.file)));
console.log("head listed:", Object.keys(h.workflows).sort().join(","));
for (const n of Object.keys(b.workflows).sort()) {
  const hw = h.workflows[n]; const bh = workflowHash(b.workflows[n]!.workflow); const hh = hw ? workflowHash(hw.workflow) : "MISSING";
  const routes = (w:any)=>Object.values(w.steps).reduce((a:number,s:any)=>a+Object.keys(s.outcomes??{}).length,0);
  console.log(n, bh===hh?"SAME":"DIFF", bh.slice(0,16), hh.slice(0,16), "routes", routes(b.workflows[n]!.workflow), hw&&routes(hw.workflow), "counters", Object.keys(hw?.workflow.counters??{}).length, "use/like left:", hw? /^\s+(use|like):/m.test(hw.source):"-");
}
