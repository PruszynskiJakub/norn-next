/**
 * What agent steps produce for the steps after them, and the flow check over it: a step reads only
 * what an earlier step on every path to it produced (or what the host provides). A produced name is a
 * file in the story's spec folder, written by the agent and checked by the host when it reports; the
 * kernel only checks the declarations and the graph, and never opens the file.
 */
import { readName, type StepKindRead } from "@norn/plugin-api";
import type { WorkflowStepDoc } from "./document.ts";
import { type CompiledRoute, OVERRIDABLE_OUTCOMES, type WorkflowError } from "./graph.ts";

const OVERRIDABLE: readonly string[] = OVERRIDABLE_OUTCOMES;

/** A file a step produces, as the brief and the report check read it. */
export interface Produced {
  name: string;
  /** relative to the story's spec folder */
  file: string;
}

/** The outcomes an agent step reports itself: the ones it routes, less the ones the kernel classifies. */
const reportable = (step: WorkflowStepDoc): string[] => Object.keys(step.outcomes ?? {}).filter((o) => !OVERRIDABLE.includes(o) && o !== "exhausted");

/**
 * The outcomes each produced name is due on: its `on:`, else every outcome the step reports but one
 * that hands findings back, as that one sends the work back to be done again rather than forward.
 */
export function producesOn(step: WorkflowStepDoc): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  const forward = reportable(step).filter((o) => step.hand_back?.[o] !== "findings");
  for (const [name, p] of Object.entries(step.produces ?? {})) out[name] = p.on ? [...p.on] : forward;
  return out;
}

/** The files a report of `outcome` at this step must come with, in the order the step declares them. */
export function producedOn(step: WorkflowStepDoc, outcome: string): Produced[] {
  const on = producesOn(step);
  return Object.entries(step.produces ?? {}).flatMap(([name, p]) => ((on[name] ?? []).includes(outcome) ? [{ name, file: p.file }] : []));
}

/** Every file a workflow's steps produce, each once: what the host reads back from a worktree. */
export function producedFiles(steps: Readonly<Record<string, WorkflowStepDoc>>): string[] {
  return [...new Set(Object.values(steps).flatMap((s) => Object.values(s.produces ?? {}).map((p) => p.file)))];
}

/** A path that stays inside the folder it is relative to: not absolute, and no `..` segment. */
const inside = (file: string): boolean => !file.startsWith("/") && !file.split(/[\\/]/).includes("..");

/** One agent step's `produces:` against its own outcomes and the host's input names. */
export function produceErrors(step: WorkflowStepDoc, at: string, outcomes: readonly string[], host: readonly string[] | undefined): WorkflowError[] {
  const errors: WorkflowError[] = [];
  for (const [name, p] of Object.entries(step.produces ?? {})) {
    const where = `${at}/produces/${name}`;
    if (host?.includes(name)) errors.push({ path: where, message: `\`${name}\` is an input norn provides: a step produces a name of its own` });
    if (!inside(p.file)) errors.push({ path: `${where}/file`, message: `\`${p.file}\` leaves the story's spec folder: name a path inside it, without \`..\`` });
    (p.on ?? []).forEach((o, i) => {
      if (outcomes.includes(o)) return;
      errors.push({
        path: `${where}/on/${i}`,
        message: OVERRIDABLE.includes(o) ? `produces names '${o}', a route the kernel takes, never one an agent reports` : `produces names outcome '${o}', but the step declares no route for it in outcomes`,
      });
    });
  }
  return errors;
}

/** A step that reads a produced name: an agent step's input, or a step kind's read without a fallback. */
export interface Reader {
  step: string;
  name: string;
  /** where the refusal points: the input's entry, or the step kind's head */
  path: string;
  /** how the refusal names the step: `step 'review'`, `step 'ship' (open-pr)` */
  label: string;
}

/** The names a step reads that some earlier step must produce, given the host's names. */
export function readersOf(name: string, step: WorkflowStepDoc, head: string, reads: readonly StepKindRead[] | undefined, produced: ReadonlySet<string>, host: readonly string[]): Reader[] {
  if (head === "agent")
    return (step.inputs ?? []).flatMap((input, i) =>
      typeof input === "string" && produced.has(input) && !host.includes(input) ? [{ step: name, name: input, path: `/steps/${name}/inputs/${i}`, label: `step '${name}'` }] : [],
    );
  return (reads ?? []).flatMap((r) => (typeof r === "string" && !host.includes(readName(r)) ? [{ step: name, name: r, path: `/steps/${name}/${head}`, label: `step '${name}' (${head})` }] : []));
}

type Routes = Readonly<Record<string, Readonly<Record<string, CompiledRoute>>>>;

/**
 * Every reader some path from `start` reaches with no producer of its name on it. One search per name
 * over the steps reached without it: an edge out of a producer, by an outcome it produces on, carries
 * the name and is not followed. A route back is fine when a producer comes before on every path.
 * Breadth first, so the path a refusal names is a shortest one.
 */
export function flowErrors(start: string, routes: Routes, steps: Readonly<Record<string, WorkflowStepDoc>>, readers: readonly Reader[]): WorkflowError[] {
  const on = Object.fromEntries(Object.entries(steps).map(([s, doc]) => [s, producesOn(doc)]));
  const searched = new Map<string, Map<string, { from: string; outcome: string } | null>>();
  const reached = (name: string) => {
    const known = searched.get(name);
    if (known) return known;
    const via = new Map<string, { from: string; outcome: string } | null>([[start, null]]);
    const queue = [start];
    while (queue.length) {
      const s = queue.shift() as string;
      for (const [o, r] of Object.entries(routes[s] ?? {})) {
        if (!Object.hasOwn(routes, r.to) || via.has(r.to) || on[s]?.[name]?.includes(o)) continue;
        via.set(r.to, { from: s, outcome: o });
        queue.push(r.to);
      }
    }
    searched.set(name, via);
    return via;
  };
  const errors: WorkflowError[] = [];
  for (const r of readers) {
    const via = reached(r.name);
    if (!via.has(r.step)) continue;
    const hops: string[] = [];
    for (let at = via.get(r.step); at; at = via.get(at.from)) hops.unshift(`${at.from}.${at.outcome}`);
    const path = [...hops, r.step].join(" → ");
    errors.push({ path: r.path, message: `${r.label} reads \`${r.name}\`, but no step produces it on the path ${path}: give a step on that path produces: ${r.name}` });
  }
  return errors;
}
