import { parse } from "/Users/jakubpruszynski/.norn/repos/norn-b68fe828/worktrees/gh-345-every-route-back-needs-a-hand-written/node_modules/yaml/dist/index.js";
const f = process.argv[2];
const d = JSON.parse(await Bun.file(f).text()).out;
const res: Record<string, unknown> = {};
for (const [n, w] of Object.entries<any>(d)) {
  const doc = parse(w.source);
  const counters = doc.counters ?? {};
  const byCounter: Record<string, string[]> = {};
  const edges: Record<string, unknown> = {};
  for (const [s, st] of Object.entries<any>(doc.steps)) for (const [o, r] of Object.entries<any>(st.outcomes ?? {})) {
    if (r && typeof r === "object" && r.counter) {
      const c = counters[r.counter];
      const reset = c.reset_on == null ? [] : [c.reset_on].flat().sort();
      edges[`${s}.${o}`] = { to: r.to, max: c.max, reset };
      (byCounter[r.counter] ??= []).push(`${s}.${o}`);
    }
  }
  const groups = Object.values(byCounter).filter((g) => g.length > 1).map((g) => g.sort().join(" + ")).sort();
  res[n] = { edges: Object.fromEntries(Object.entries(edges).sort()), sharedGroups: groups };
}
console.log(JSON.stringify(res, null, 1));
