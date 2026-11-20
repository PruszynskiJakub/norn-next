/**
 * The counter each route back gets from the kind of its edge, so an author writes a counter only to
 * share one between edges or to bound one differently. The bounds are the old engine's, so a shipped
 * workflow loads to the counters it always had: a check's `fail`, a gate's `reject`, a `conflict`
 * (reset whenever its step ends another way), a signal (the world moving under a waiting story), and
 * an agent's otherwise uncounted route back.
 * Forward outcomes (`done`, `pass`, `approve`) are never counted unless the author writes `max:`.
 */
import type { CounterDefaults } from "../model/config.ts";
import type { CounterDoc, Route } from "./document.ts";
import type { CompiledCounter, WorkflowError } from "./graph.ts";

/** One flat step as counting needs it: its head kind and its routes as written (after `use` and `like`). */
export interface CountedStep {
  kind: string;
  routes: Readonly<Record<string, Route>>;
  /** a check's exit code → outcome; an outcome named here counts like `fail` */
  exits?: Readonly<Record<string, string>>;
  /** outcomes bounded as the world moving under the story: the signals the step routes, and a check's exits named for one */
  signals?: readonly string[];
  /** the names written under `on:`, so a refusal points at the block they sit in */
  on?: readonly string[];
}

/** The shared-file exit a flat edge left by: edges leaving through one exit with no counter of their own share one. */
export interface ExitLeft {
  /** `<use step>.<exit>` */
  exit: string;
  counter?: string;
  max?: number;
}

export interface DerivedCounters {
  /** edge `<step>.<outcome>` → the counter it bumps */
  edges: Record<string, string>;
  /** every counter, declared and derived, by name */
  counters: Record<string, CompiledCounter>;
  errors: WorkflowError[];
}

/** Agent outcomes that move work forward: never counted unless the author writes `max:`. */
const FORWARD: readonly string[] = ["done", "pass", "approve"];

/** The kinds of edge a shared exit's feeders can derive by, as a mixed-kind refusal names them. */
const KIND_LABEL = { check: "check fail", gate: "gate reject", conflict: "conflict", signal: "signal", agent: "agent send-back" } as const;
type EdgeKind = keyof typeof KIND_LABEL;

interface Edge {
  step: string;
  outcome: string;
  to: string;
  counter?: string;
  max?: number;
  /** written under `on:` */
  on?: boolean;
}

interface Feeder {
  e: Edge;
  kind: EdgeKind | null;
  spec: CompiledCounter | null;
}

interface ExitGroup {
  route: ExitLeft;
  /** a reserved target a feeder ends at while the use route sets `max:`: there is nothing to bound */
  end?: string;
  feeders: Feeder[];
}

const nameOf = (e: { step: string; outcome: string }) => `${e.step}.${e.outcome}`;
const pathOf = (e: Edge) => `/steps/${e.step}/${e.on ? "on" : "outcomes"}/${e.outcome}`;
const resetsOf = (c: CounterDoc): string[] => (c.reset_on === undefined ? [] : Array.isArray(c.reset_on) ? [...c.reset_on] : [c.reset_on]);

/**
 * Derive the counters of a flat workflow. `order` is the steps' order in the file, which fixes the
 * order edges are visited in so the derived counters come out the same on every load; `exits` maps
 * each flat edge that left a shared file to the exit it left by. A route back from an agent counts
 * only where it closes a loop no other counter bounds.
 */
export function deriveCounters(
  steps: Readonly<Record<string, CountedStep>>,
  order: readonly string[],
  declared: Readonly<Record<string, CounterDoc>>,
  exits: Readonly<Record<string, ExitLeft>>,
  defaults: CounterDefaults,
): DerivedCounters {
  const out: DerivedCounters = { edges: {}, counters: {}, errors: [] };
  for (const [name, c] of Object.entries(declared)) out.counters[name] = { max: c.max, reset_on: resetsOf(c) };

  const edges = edgesOf(steps, order);
  const counted = new Set<string>();
  const agentRow: Edge[] = [];
  const count = (e: Edge, spec: CompiledCounter) => {
    out.edges[nameOf(e)] = nameOf(e);
    out.counters[nameOf(e)] = spec;
    counted.add(nameOf(e));
  };
  // the feeders of each shared exit are decided together, once every lone edge is known
  const groups = new Map<string, ExitGroup>();
  for (const e of edges) {
    const step = steps[e.step] as CountedStep;
    const left = exits[nameOf(e)];
    if (left && e.counter === undefined) {
      const group = groups.get(left.exit) ?? { route: left, feeders: [] };
      groups.set(left.exit, group);
      if (e.to.startsWith("$")) {
        if (left.max !== undefined) group.end = e.to;
        continue;
      }
      const spec = kindDefault(step, e, defaults);
      const kind = spec ? kindOf(step, e) : step.kind === "agent" && !FORWARD.includes(e.outcome) ? "agent" : null;
      group.feeders.push({ e, kind, spec });
      if (spec || left.max !== undefined) counted.add(nameOf(e));
      continue;
    }
    if (e.counter !== undefined) {
      counted.add(nameOf(e));
      if (e.max !== undefined) out.errors.push({ path: pathOf(e), message: `\`${nameOf(e)}\` sets both max and counter: a named counter's max goes under counters` });
      else if (!Object.hasOwn(declared, e.counter)) out.errors.push({ path: pathOf(e), message: `counter '${e.counter}' is not declared in counters` });
      continue;
    }
    if (e.to.startsWith("$")) {
      if (e.max !== undefined) out.errors.push({ path: pathOf(e), message: `\`${nameOf(e)}\` → \`${e.to}\` sets max, but there is no loop to bound` });
      continue;
    }
    const spec = kindDefault(step, e, defaults);
    if (spec) count(e, e.max === undefined ? spec : { ...spec, max: e.max });
    else if (e.max !== undefined) count(e, { max: e.max, reset_on: [] });
    else if (step.kind === "agent" && !FORWARD.includes(e.outcome)) agentRow.push(e);
  }

  // u → v lies on a cycle of the uncounted edges exactly when v reaches u through them
  const next = new Map<string, string[]>();
  for (const e of edges) if (!counted.has(nameOf(e)) && Object.hasOwn(steps, e.to)) next.set(e.step, [...(next.get(e.step) ?? []), e.to]);
  for (const e of agentRow) if (reaches(next, e.to, e.step)) count(e, { max: defaults.agentBack, reset_on: [] });
  for (const [exit, group] of groups) countExit(out, steps, exit, group, defaults, (e) => reaches(next, e.to, e.step));
  return out;
}

/**
 * One counter for the edges leaving a shared file through `exit`: its default comes from the kind of
 * the feeders that derive one, and `max:` on the use route replaces it and counts every feeder.
 */
function countExit(
  out: DerivedCounters,
  steps: Readonly<Record<string, CountedStep>>,
  exit: string,
  group: ExitGroup,
  defaults: CounterDefaults,
  onLoop: (e: Edge) => boolean,
): void {
  const [use, name] = exit.split(".") as [string, string];
  const path = `/steps/${use}/outcomes/${name}`;
  const { max } = group.route;
  if (group.end) {
    out.errors.push({ path, message: `\`${exit}\` → \`${group.end}\` sets max, but there is no loop to bound` });
    return;
  }
  if (!group.feeders.length) return;
  // agent feeders derive together, when any one of them closes a loop nothing else counts
  const agentsDerive = group.feeders.some((f) => f.kind === "agent" && onLoop(f.e));
  const deriving = group.feeders.filter((f) => f.spec || (f.kind === "agent" && agentsDerive));
  const kinds = [...new Set(deriving.map((f) => f.kind as EdgeKind))];
  let spec: CompiledCounter;
  let counted = deriving;
  if (max !== undefined) {
    counted = group.feeders;
    spec = kinds.length === 1 ? { ...exitDefault(kinds[0] as EdgeKind, deriving, steps, defaults), max } : { max, reset_on: [] };
  } else if (!kinds.length) return;
  else if (kinds.length > 1) {
    const fed = kinds.map((k) => `${KIND_LABEL[k]}: ${deriving.filter((f) => f.kind === k).map((f) => `\`${nameOf(f.e)}\``).join(", ")}`).join("; ");
    out.errors.push({ path, message: `exit \`${name}\` of \`${use}\` is fed by edges of different kinds (${fed}): give max: on \`${use}\`'s route` });
    return;
  } else spec = exitDefault(kinds[0] as EdgeKind, deriving, steps, defaults);
  for (const f of counted) out.edges[nameOf(f.e)] = exit;
  out.counters[exit] = spec;
}

/** The default counter of a shared exit whose deriving feeders are all of `kind`; a conflict resets on every other outcome of every feeder step. */
function exitDefault(kind: EdgeKind, deriving: readonly Feeder[], steps: Readonly<Record<string, CountedStep>>, defaults: CounterDefaults): CompiledCounter {
  if (kind === "agent") return { max: defaults.agentBack, reset_on: [] };
  if (kind !== "conflict") return deriving[0]?.spec as CompiledCounter;
  const resets = [...new Set(deriving.flatMap((f) => otherOutcomes(steps[f.e.step] as CountedStep, f.e)))];
  return { max: defaults.conflict, reset_on: resets };
}

const isSignal = (step: CountedStep, e: Edge): boolean => step.signals?.includes(e.outcome) === true;

function kindOf(step: CountedStep, e: Edge): EdgeKind {
  if (isSignal(step, e)) return "signal";
  if (e.outcome === "conflict") return "conflict";
  return step.kind === "gate" ? "gate" : "check";
}

/** The default counter of an edge by its kind, or null when its kind derives none. */
function kindDefault(step: CountedStep, e: Edge, defaults: CounterDefaults): CompiledCounter | null {
  // every signal shares the stale bound: each answers the world moving under a waiting story, which no count of the story's own work bounds
  if (isSignal(step, e)) return { max: defaults.stale, reset_on: [] };
  if (e.outcome === "conflict") return { max: defaults.conflict, reset_on: otherOutcomes(step, e) };
  if (step.kind === "check" && (e.outcome === "fail" || Object.values(step.exits ?? {}).includes(e.outcome))) return { max: defaults.checkFail, reset_on: [] };
  if (step.kind === "gate" && e.outcome === "reject") return { max: defaults.gateReject, reset_on: [] };
  return null;
}

function otherOutcomes(step: CountedStep, e: Edge): string[] {
  return Object.keys(step.routes)
    .filter((o) => o !== e.outcome)
    .map((o) => `${e.step}.${o}`);
}

function edgesOf(steps: Readonly<Record<string, CountedStep>>, order: readonly string[]): Edge[] {
  const out: Edge[] = [];
  for (const step of order) {
    const s = steps[step];
    if (!s) continue;
    for (const [outcome, route] of Object.entries(s.routes)) {
      const on = s.on?.includes(outcome) ? { on: true } : {};
      if (typeof route === "string") out.push({ step, outcome, to: route, ...on });
      else
        out.push({
          step,
          outcome,
          ...on,
          to: route.to,
          ...(route.counter !== undefined && { counter: route.counter }),
          ...(route.max !== undefined && { max: route.max }),
        });
    }
  }
  return out;
}

function reaches(next: ReadonlyMap<string, readonly string[]>, from: string, to: string): boolean {
  const seen = new Set<string>([from]);
  const queue = [from];
  while (queue.length) {
    const s = queue.shift() as string;
    if (s === to) return true;
    for (const n of next.get(s) ?? [])
      if (!seen.has(n)) {
        seen.add(n);
        queue.push(n);
      }
  }
  return false;
}
