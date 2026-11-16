const [store, root] = process.argv.slice(2);
const m = await import(store);
const l = m.loadWorkflows(root);
const out: Record<string, unknown> = {};
for (const [n, w] of Object.entries<any>(l.workflows)) out[n] = { hash: w.hash, source: w.source, exits: w.exits ?? null, counters: w.workflow.counters ?? null };
console.log(JSON.stringify({ errors: l.errors, out }, null, 1));
