/**
 * The counter each route back gets from the kind of its edge, so an author writes a counter only to
 * share one between edges or to reset it on a chosen edge. Pure over the flat workflow as written
 * (in the model's step form, before validation): the loader writes the result into the text it pins.
 */
import { type CounterSpec, OUTCOME_NAME_PATTERN, STEP_NAME_PATTERN } from "@norn/schema";

export interface DerivedCounting {
  /** edge `<step>.<outcome>` → the counter it now names; holds every edge that wrote `max:` */
  edges: Record<string, string>;
  /** the counters to add to the workflow's `counters:`, by derived name */
  counters: Record<string, CounterSpec>;
  /** refusals, each at a JSON pointer into the workflow; `step` is an included step the refusal is about, so it names that step's shared file */
  errors: Array<{ path: string; message: string; step?: string }>;
}

/** The shared-file exit a flat edge left by: `<use step>.<exit>` and the use step's route for it, as written there. */
export interface ExitLeft {
  exit: string;
  counter?: string;
  max?: number;
}

/** Default bounds by kind of edge; a conflict also resets on every other outcome of its step. */
const CHECK_FAIL = 5;
const GATE_REJECT = 2;
const CONFLICT = 2;
const STALE = 10;
const AGENT_SEND_BACK = 3;
/** Agent outcomes that move work forward: never counted unless the author writes `max:`. */
const FORWARD = ["done", "pass", "approve"];

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

interface WrittenEdge {
  step: string;
  outcome: string;
  to: string;
  counter?: unknown;
  max?: unknown;
}

// An edge is named `<step>.<outcome>`, so a malformed name would make a name that splits wrongly:
// such an edge derives nothing and the schema check that follows refuses the file.
const STEP_NAME = new RegExp(STEP_NAME_PATTERN);
const OUTCOME_NAME = new RegExp(OUTCOME_NAME_PATTERN);

const nameOf = (e: { step: string; outcome: string }) => `${e.step}.${e.outcome}`;
const pathOf = (e: { step: string; outcome: string }) => `/steps/${e.step}/outcomes/${e.outcome}`;
/** The kinds of edge a shared exit's feeders can derive by, as a mixed-kind refusal names them. */
const KIND_LABEL = { check: "check fail", gate: "gate reject", conflict: "conflict", stale: "stale", agent: "agent send-back" } as const;
type Kind = keyof typeof KIND_LABEL;

/**
 * The derived counters of a flat workflow `doc` (steps in the model's form, each with its `type`).
 * `exits` holds, per flat edge that left a shared file, the exit it left by: edges leaving through
 * one exit whose use route names no counter share one counter named after that exit.
 * A malformed part is skipped: the schema check that follows reports it.
 */
export function deriveEdgeCounters(doc: unknown, exits: Readonly<Record<string, ExitLeft>> = {}): DerivedCounting {
  const out: DerivedCounting = { edges: {}, counters: {}, errors: [] };
  const steps = isObj(doc) && isObj(doc.steps) ? doc.steps : {};
  const declared = isObj(doc) && isObj(doc.counters) ? doc.counters : {};
  for (const name of Object.keys(declared))
    if (name.includes("."))
      out.errors.push({ path: `/counters/${name}`, message: `counter name '${name}' is not a valid name: a dotted name is derived from its edge, never declared` });

  const edges = writtenEdges(steps);
  const counted = new Set<string>();
  const agentRow: WrittenEdge[] = [];
  const count = (e: WrittenEdge, spec: CounterSpec) => {
    out.edges[nameOf(e)] = nameOf(e);
    out.counters[nameOf(e)] = spec;
    counted.add(nameOf(e));
  };
  // The feeders of each shared exit are decided together, once every lone edge is known
  const feeders = new Map<string, { route: ExitLeft; end?: string; edges: Array<{ e: WrittenEdge; kind: Kind | null; spec: CounterSpec | null }> }>();
  for (const e of edges) {
    const left = exits[nameOf(e)];
    if (left && e.counter === undefined) {
      const group = feeders.get(left.exit) ?? { route: left, edges: [] };
      feeders.set(left.exit, group);
      if (e.to.startsWith("$")) {
        if (left.max !== undefined) group.end = e.to;
        continue;
      }
      const spec = kindDefault(steps[e.step] as Obj, e);
      const kind = spec ? kindOf(steps[e.step] as Obj, e) : (steps[e.step] as Obj).type === "agent" && !FORWARD.includes(e.outcome) ? "agent" : null;
      group.edges.push({ e, kind, spec });
      // counted for the loop search below whenever the exit will count it
      if (spec || left.max !== undefined) counted.add(nameOf(e));
      continue;
    }
    if (e.counter !== undefined) {
      counted.add(nameOf(e));
      if (e.max !== undefined) out.errors.push({ path: pathOf(e), message: `\`${nameOf(e)}\` sets both max and counter: a named counter's max goes under counters` });
      // a dotted name is never declared, so naming one can only mean a derived counter, which no edge may borrow
      else if (typeof e.counter === "string" && e.counter.includes(".") && !Object.hasOwn(declared, e.counter))
        out.errors.push({ path: pathOf(e), message: `counter '${e.counter}' is not declared in counters` });
      continue;
    }
    if (e.to.startsWith("$")) {
      if (e.max !== undefined) out.errors.push({ path: pathOf(e), message: `\`${nameOf(e)}\` → \`${e.to}\` sets max, but there is no loop to bound` });
      continue;
    }
    if (e.max !== undefined && !(Number.isInteger(e.max) && (e.max as number) >= 1)) {
      out.errors.push({ path: `${pathOf(e)}/max`, message: "must be an integer of at least 1" });
      continue;
    }
    const kind = kindDefault(steps[e.step] as Obj, e);
    const max = e.max as number | undefined;
    if (kind) count(e, { ...kind, ...(max !== undefined && { max }) });
    else if (max !== undefined) count(e, { max });
    else if ((steps[e.step] as Obj).type === "agent" && !FORWARD.includes(e.outcome)) agentRow.push(e);
  }

  // An agent's send-back counts only where it closes a loop nothing else counts: u → v lies on a
  // cycle of the uncounted edges exactly when v reaches u through them
  const next = new Map<string, string[]>();
  for (const e of edges)
    if (!counted.has(nameOf(e)) && Object.hasOwn(steps, e.to)) next.set(e.step, [...(next.get(e.step) ?? []), e.to]);
  for (const e of agentRow) if (reaches(next, e.to, e.step)) count(e, { max: AGENT_SEND_BACK });
  for (const [exit, group] of feeders) countExit(out, steps, exit, group, (e) => reaches(next, e.to, e.step));
  return out;
}

/**
 * One counter for the edges leaving a shared file through `exit`: its default comes from the kind of
 * the feeders that derive one, and `max:` on the use route replaces it and counts every feeder.
 */
function countExit(
  out: DerivedCounting,
  steps: Obj,
  exit: string,
  group: { route: ExitLeft; end?: string; edges: Array<{ e: WrittenEdge; kind: Kind | null; spec: CounterSpec | null }> },
  onLoop: (e: WrittenEdge) => boolean,
): void {
  const [use, name] = exit.split(".") as [string, string];
  const path = `/steps/${use}/outcomes/${name}`;
  const { max } = group.route;
  if (group.end) {
    out.errors.push({ path, message: `\`${exit}\` → \`${group.end}\` sets max, but there is no loop to bound` });
    return;
  }
  if (!group.edges.length) return;
  // agent feeders derive together, when any one of them closes a loop nothing else counts
  const agentsDerive = group.edges.some((f) => f.kind === "agent" && onLoop(f.e));
  const deriving = group.edges.filter((f) => f.spec || (f.kind === "agent" && agentsDerive));
  const kinds = [...new Set(deriving.map((f) => f.kind as Kind))];
  let spec: CounterSpec;
  let counted = deriving;
  if (max !== undefined) {
    counted = group.edges;
    spec = kinds.length === 1 ? { ...defaultOf(kinds[0] as Kind, deriving, steps), max } : { max };
  } else if (!kinds.length) return;
  else if (kinds.length > 1) {
    const fed = kinds.map((k) => `${KIND_LABEL[k]}: ${deriving.filter((f) => f.kind === k).map((f) => `\`${nameOf(f.e)}\``).join(", ")}`).join("; ");
    out.errors.push({ path, step: group.edges[0]?.e.step, message: `exit \`${name}\` of \`${use}\` is fed by edges of different kinds (${fed}): give max: on \`${use}\`'s route` });
    return;
  } else spec = defaultOf(kinds[0] as Kind, deriving, steps);
  for (const f of counted) out.edges[nameOf(f.e)] = exit;
  out.counters[exit] = spec;
}

/** The default counter of a shared exit whose deriving feeders are all of `kind`; a conflict resets on every other outcome of every feeder step. */
function defaultOf(kind: Kind, deriving: ReadonlyArray<{ e: WrittenEdge; spec: CounterSpec | null }>, steps: Obj): CounterSpec {
  if (kind === "agent") return { max: AGENT_SEND_BACK };
  if (kind !== "conflict") return deriving[0]?.spec as CounterSpec;
  const resets = [...new Set(deriving.flatMap((f) => otherOutcomes(steps[f.e.step] as Obj, f.e)))];
  return { max: CONFLICT, ...(resets.length && { reset_on: resets.length === 1 ? (resets[0] as string) : resets }) };
}

/** The kind of an edge that derives a counter by its kind. */
function kindOf(step: Obj, e: WrittenEdge): Kind {
  if (e.outcome === "stale") return "stale";
  if (e.outcome === "conflict") return "conflict";
  return step.type === "gate" ? "gate" : "check";
}

function otherOutcomes(step: Obj, e: WrittenEdge): string[] {
  return Object.entries(step.outcomes as Obj).filter(([o, r]) => o !== e.outcome && r !== undefined && OUTCOME_NAME.test(o)).map(([o]) => `${e.step}.${o}`);
}

function writtenEdges(steps: Obj): WrittenEdge[] {
  const out: WrittenEdge[] = [];
  for (const [step, s] of Object.entries(steps)) {
    if (!isObj(s) || !isObj(s.outcomes) || !STEP_NAME.test(step)) continue;
    for (const [outcome, route] of Object.entries(s.outcomes)) {
      if (!OUTCOME_NAME.test(outcome)) continue;
      if (typeof route === "string") out.push({ step, outcome, to: route });
      else if (isObj(route) && typeof route.to === "string")
        out.push({ step, outcome, to: route.to, ...(route.counter !== undefined && { counter: route.counter }), ...(route.max !== undefined && { max: route.max }) });
    }
  }
  return out;
}

/** The default counter of an edge by its kind, or null when its kind derives none. */
function kindDefault(step: Obj, e: WrittenEdge): CounterSpec | null {
  if (e.outcome === "stale") return { max: STALE };
  if (e.outcome === "conflict") {
    const others = otherOutcomes(step, e);
    return { max: CONFLICT, ...(others.length && { reset_on: others.length === 1 ? (others[0] as string) : others }) };
  }
  if (step.type === "check") {
    const named = isObj(step.exits) ? Object.values(step.exits) : [];
    if (e.outcome === "fail" || named.includes(e.outcome)) return { max: CHECK_FAIL };
  }
  if (step.type === "gate" && e.outcome === "reject") return { max: GATE_REJECT };
  return null;
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
