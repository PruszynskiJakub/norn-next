/**
 * The checks on a compiled workflow's shape: every step is reached from `start`, every step can still
 * reach `$done`, and every loop takes at least one counted route, so no unit can go round forever
 * without a counter running out into a visible stuck.
 */
import type { CompiledRoute, WorkflowError } from "./graph.ts";

type Routes = Readonly<Record<string, Readonly<Record<string, CompiledRoute>>>>;

export function checkGraph(start: string, order: readonly string[], routes: Routes): WorkflowError[] {
  const errors: WorkflowError[] = [];
  const isStep = (s: string) => Object.hasOwn(routes, s);

  const reached = new Set<string>([start]);
  const queue = [start];
  while (queue.length) {
    const s = queue.shift() as string;
    for (const r of Object.values(routes[s] ?? {}))
      if (isStep(r.to) && !reached.has(r.to)) {
        reached.add(r.to);
        queue.push(r.to);
      }
  }
  for (const s of order) if (!reached.has(s)) errors.push({ path: `/steps/${s}`, message: `no route reaches step '${s}' from start '${start}'` });

  const ends = new Set<string>(["$done"]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const s of order)
      if (!ends.has(s) && Object.values(routes[s] ?? {}).some((r) => ends.has(r.to))) {
        ends.add(s);
        grew = true;
      }
  }
  for (const s of order) if (!ends.has(s)) errors.push({ path: `/steps/${s}`, message: `step '${s}' cannot reach $done` });

  for (const cycle of uncountedCycles(order, routes)) {
    const hops = cycle.map((h) => `${h.step}.${h.outcome}`).join(" → ");
    errors.push({ path: `/steps/${cycle[0]?.step}`, message: `a route back no counter bounds: ${hops} → ${cycle[0]?.step}; give one of these routes max: or a counter` });
  }
  return errors;
}

interface Hop {
  step: string;
  outcome: string;
}

/**
 * One loop of uncounted routes per strongly connected part of the uncounted graph: a part with two
 * steps, or one step routing to itself, is a loop nothing bounds. Each is the shortest loop through
 * the part's first step in file order, so the refusal names a loop the author can read.
 */
function uncountedCycles(order: readonly string[], routes: Routes): Hop[][] {
  const next = new Map<string, Hop[]>();
  for (const s of order)
    next.set(
      s,
      Object.entries(routes[s] ?? {})
        .filter(([, r]) => r.counter === undefined && Object.hasOwn(routes, r.to))
        .map(([o, r]) => ({ step: r.to, outcome: o })),
    );
  const out: Hop[][] = [];
  for (const part of components(order, next)) {
    const first = part[0] as string;
    const inPart = new Set(part);
    const loops = part.length > 1 || (next.get(first) ?? []).some((h) => h.step === first);
    if (!loops) continue;
    // breadth-first from the first step back to it, inside the part
    const via = new Map<string, Hop & { from: string }>();
    const queue = [first];
    let closing: (Hop & { from: string }) | undefined;
    while (queue.length && !closing) {
      const s = queue.shift() as string;
      for (const h of next.get(s) ?? []) {
        if (!inPart.has(h.step)) continue;
        if (h.step === first) {
          closing = { ...h, from: s };
          break;
        }
        if (!via.has(h.step)) {
          via.set(h.step, { ...h, from: s });
          queue.push(h.step);
        }
      }
    }
    if (!closing) continue;
    const hops: Hop[] = [{ step: closing.from, outcome: closing.outcome }];
    for (let at = closing.from; at !== first; ) {
      const v = via.get(at) as Hop & { from: string };
      hops.unshift({ step: v.from, outcome: v.outcome });
      at = v.from;
    }
    out.push(hops);
  }
  return out;
}

/** Strongly connected parts (Tarjan), each listed in file order, the parts ordered by their first step. */
function components(order: readonly string[], next: ReadonlyMap<string, readonly Hop[]>): string[][] {
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const parts: string[][] = [];
  let n = 0;
  const visit = (v: string) => {
    index.set(v, n);
    low.set(v, n);
    n++;
    stack.push(v);
    onStack.add(v);
    for (const { step: w } of next.get(v) ?? []) {
      if (!index.has(w)) {
        visit(w);
        low.set(v, Math.min(low.get(v) as number, low.get(w) as number));
      } else if (onStack.has(w)) low.set(v, Math.min(low.get(v) as number, index.get(w) as number));
    }
    if (low.get(v) === index.get(v)) {
      const part: string[] = [];
      for (let w = stack.pop(); w !== undefined; w = w === v ? undefined : stack.pop()) {
        onStack.delete(w);
        part.push(w);
      }
      parts.push(part);
    }
  };
  for (const s of order) if (!index.has(s)) visit(s);
  const pos = new Map(order.map((s, i) => [s, i]));
  const byOrder = (a: string, b: string) => (pos.get(a) as number) - (pos.get(b) as number);
  return parts.map((p) => p.sort(byOrder)).sort((a, b) => byOrder(a[0] as string, b[0] as string));
}
