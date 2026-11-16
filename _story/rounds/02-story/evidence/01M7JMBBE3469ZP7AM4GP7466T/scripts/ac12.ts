import { load, eq, store, core } from "./lib.ts";
import { readFileSync, readdirSync } from "node:fs";
const M = process.argv[2];
const tr = (t: string, f: string) => { const r = store.translateWording(t, f); if (!r.ok) throw new Error(`${f}: ${r.message} line ${r.line}`); return r; };
const sharedMain: Record<string, string> = {}, sharedTr: Record<string, string> = {};
for (const f of readdirSync(`${M}/shared`)) { const n = f.replace(".yaml", ""); sharedMain[n] = readFileSync(`${M}/shared/${f}`, "utf8"); const r = tr(sharedMain[n], f); sharedTr[n] = r.text; console.log(`shared/${f}: translated ok, changed=${r.changed}, old-wording steps left after translation: ${store.oldWordingSteps ? "" : ""}${JSON.stringify((await import(`${process.env.R ?? ""}` || "node:path"), null))}`.replace(/, old-wording.*$/, "")); }
const { oldWordingSteps } = await import("/Users/jakubpruszynski/.norn/repos/norn-b68fe828/worktrees/gh-343-a-step-is-written-with-two-keys-for-one/packages/store/src/wording.ts");
const { parse } = await import("yaml");
for (const n of Object.keys(sharedTr)) console.log(`  shared/${n}: old-wording steps before=${oldWordingSteps(parse(sharedMain[n])).length} after=${oldWordingSteps(parse(sharedTr[n])).length}`);
const wfn = (t: string) => t.replace(/^name: \S+/m, "name: wf");
for (const f of readdirSync(M).filter((f) => f.endsWith(".yaml"))) {
  const text = readFileSync(`${M}/${f}`, "utf8"); const t = tr(text, f);
  const a = load(wfn(text), "copy", sharedMain); const b = load(wfn(t.text), "checkout", sharedTr);
  console.log(`${f}: origin/main as copy ok=${a.ok} (${a.issues?.length ?? JSON.stringify(a.refused)} issues) | translateWording text in checkout ok=${b.ok} (${b.issues?.length ?? JSON.stringify(b.refused)} issues) | EQUAL=${eq(a.workflow, b.workflow)} | steps=${Object.keys(b.workflow?.steps ?? {}).length}`);
}
