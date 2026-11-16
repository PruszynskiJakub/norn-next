const R = "/Users/jakubpruszynski/.norn/repos/norn-b68fe828/worktrees/gh-343-a-step-is-written-with-two-keys-for-one";
const store = await import(`${R}/packages/store/src/index.ts`);
const core = await import(`${R}/packages/core/src/index.ts`);
export { store, core, R };
/** load a workflow text through store's one reader (shared files flattened), then core's validator */
export function load(text: string, read: "checkout" | "copy" = "checkout", shared: Record<string, string> = {}, opts: any = {}) {
  const r = store.loadWorkflowText("wf", text, "/x/.agents/workflows/wf.yaml", read, "/x", (n: string) => shared[n] ?? null);
  if (!r.ok) return { ok: false, refused: r.reason === "corrupt" ? r.error : r.reason };
  const v = core.validateWorkflowDefinition(r.value.workflow, opts);
  return { ok: v.ok, workflow: r.value.workflow, issues: v.issues };
}
export const show = (label: string, x: unknown) => console.log(`--- ${label}\n${JSON.stringify(x, null, 1)}`);
export const eq = (a: unknown, b: unknown) => JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));
function sortKeys(v: any): any { if (Array.isArray(v)) return v.map(sortKeys); if (v && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().map(k => [k, sortKeys(v[k])])); return v; }
