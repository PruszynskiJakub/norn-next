// usage: loadall.ts <root> <copy|checkout> → JSON of every top workflow loaded (copy mode resolves shared files by reading them)
import { loadWorkflowText, loadWorkflows, sharedFile, workflowsDir } from "/Users/jakubpruszynski/.norn/repos/norn-b68fe828/worktrees/gh-343-a-step-is-written-with-two-keys-for-one/packages/store/src/index.ts";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
const [root, mode] = process.argv.slice(2);
const dir = workflowsDir(root);
const out: Record<string, unknown> = {};
if (mode === "checkout") {
  const l = loadWorkflows(root);
  if (l.errors.length) console.error("errors", JSON.stringify(l.errors));
  for (const [n, w] of Object.entries<any>(l.workflows)) out[n] = w.workflow;
} else for (const f of readdirSync(dir).filter((n) => n.endsWith(".yaml")).sort()) {
  const name = f.slice(0, -5);
  const r: any = loadWorkflowText(name, readFileSync(join(dir, f), "utf8"), f, "copy", root, (n: string) => readFileSync(join(dir, sharedFile(n)), "utf8"));
  out[name] = r.ok ? r.value.workflow : { ERROR: r };
}
console.log(JSON.stringify(out, Object.keys(out).length ? undefined : undefined, 1));
