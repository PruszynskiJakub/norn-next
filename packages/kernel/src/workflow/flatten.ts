/**
 * Bringing a workflow's `like` steps in as copies of their targets and its `use` steps in as the steps
 * of the shared files they name, so everything after this sees one flat workflow: the graph, the
 * receipts and decide never meet a shared file. An exit a use step leaves unrouted goes to `$stuck`,
 * as it always has, so a workflow that ignores an exit stops visibly rather than guessing a step.
 */
import { check, StepName } from "@norn/schema";
import { type Route, SharedWorkflowDocument, type WorkflowDocument, type WorkflowFile, type WorkflowStepDoc } from "./document.ts";
import type { ExitLeft } from "./counters.ts";
import type { WorkflowError } from "./graph.ts";
import { lowerActor, type SurfaceNames } from "./actors.ts";
import { lowerOutcomes } from "./outcomes.ts";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

export interface Flat {
  /** the flat steps in file order, a use step replaced in place by its file's steps */
  steps: Record<string, WorkflowStepDoc>;
  start: string;
  base?: WorkflowDocument["base"];
  /** flat edge `<step>.<outcome>` → the shared exit it left by */
  exits: Record<string, ExitLeft>;
  /** included step → the shared file it came from */
  included: Record<string, string>;
}

interface Included {
  name: string;
  /** the use step that brings it in, and its routes for the file's exits */
  by: string;
  routes: Obj;
  start: string;
  steps: Obj;
  exits: string[];
}

const fileOf = (name: string) => `shared/${name}.yaml`;

export function flatten(doc: WorkflowFile, sharedFiles: Readonly<Record<string, unknown>>, names: SurfaceNames): { ok: true; flat: Flat } | { ok: false; errors: WorkflowError[] } {
  const written = doc.steps as Obj;
  const uses = Object.entries(written).filter((e): e is [string, Obj] => isObj(e[1]) && "use" in e[1]);
  const usedNames = [...new Set(uses.map(([, s]) => s.use).filter((u): u is string => typeof u === "string"))];

  // a copy resolves within its own file first, so the use steps bring in copies already filled
  const elsewhere = new Map<string, string>();
  for (const name of usedNames) {
    const shared = sharedFiles[name];
    if (isObj(shared) && isObj(shared.steps)) for (const s of Object.keys(shared.steps)) elsewhere.set(s, fileOf(name));
  }
  const own = resolveLikes(written, elsewhere, false, names);
  if ("errors" in own) return { ok: false, errors: own.errors };
  if (!uses.length) return { ok: true, flat: { steps: own.steps as Record<string, WorkflowStepDoc>, start: doc.start, ...(doc.base && { base: doc.base }), exits: {}, included: {} } };

  const errors: WorkflowError[] = [];
  const workflowSteps = new Map(Object.keys(own.steps).map((s) => [s, "the workflow"]));
  const byName = new Map<string, Included>();
  for (const [by, step] of uses) {
    const extra = Object.keys(step).filter((k) => !["use", "outcomes", "description"].includes(k));
    if (extra.length) {
      errors.push({ path: `/steps/${by}`, message: `a use step holds only use, outcomes and description, not ${extra.join(", ")}` });
      continue;
    }
    const name = step.use as string;
    const twice = byName.get(name);
    if (twice) {
      errors.push({ path: `/steps/${by}/use`, message: `${fileOf(name)} is used twice, by \`${twice.by}\` and \`${by}\`` });
      continue;
    }
    const inc = readShared(name, by, (step.outcomes as Obj | undefined) ?? {}, sharedFiles[name], workflowSteps, names);
    if ("errors" in inc) errors.push(...inc.errors);
    else byName.set(name, inc);
  }
  if (errors.length) return { ok: false, errors };

  errors.push(...clashes(own.steps, uses, [...byName.values()]));
  const byUse = new Map([...byName.values()].map((i) => [i.by, i]));
  for (const inc of byUse.values())
    for (const exit of Object.keys(inc.routes))
      if (!inc.exits.includes(exit))
        errors.push({ path: `/steps/${inc.by}/outcomes/${exit}`, message: `\`${exit}\` is not an exit of ${fileOf(inc.name)} (its exits: ${inc.exits.join(", ") || "none"})` });
  errors.push(...useStepNamedWhereAStepMustBe(doc, byUse));
  if (errors.length) return { ok: false, errors };

  const enter = (t: string) => byUse.get(t)?.start ?? t;
  const steps: Obj = {};
  const exits: Record<string, ExitLeft> = {};
  const included: Record<string, string> = {};
  for (const [name, step] of Object.entries(own.steps)) {
    const inc = byUse.get(name);
    if (!inc) {
      steps[name] = mapRoutes(step, (r) => retarget(r, enter));
      continue;
    }
    for (const [inner, s] of Object.entries(inc.steps)) {
      included[inner] = inc.name;
      for (const [o, route] of routesOf(s)) if (isObj(route) && typeof route.exit === "string") exits[`${inner}.${o}`] = exitOf(inc, route.exit);
      steps[inner] = mapRoutes(s, (r) => leave(r, inc.routes, enter));
    }
  }
  const base = doc.base && (doc.base.step === undefined ? doc.base : { ...doc.base, step: enter(doc.base.step) });
  return { ok: true, flat: { steps: steps as Record<string, WorkflowStepDoc>, start: enter(doc.start), ...(base && { base }), exits, included } };
}

function readShared(name: string, by: string, routes: Obj, value: unknown, workflowSteps: Map<string, string>, names: SurfaceNames): Included | { errors: WorkflowError[] } {
  const file = fileOf(name);
  const inFile = (path: string, message: string): WorkflowError => ({ path, message: `${file}: ${message}`, shared: name });
  if (value === undefined) return { errors: [{ path: `/steps/${by}/use`, message: `shared file \`${file}\` not found`, shared: name }] };
  if (isObj(value) && isObj(value.steps)) {
    const nested = Object.entries(value.steps).filter(([, s]) => isObj(s) && "use" in s);
    if (nested.length) return { errors: nested.map(([s]) => inFile(`/steps/${s}/use`, "a shared file cannot use another shared file")) };
  }
  const r = check(SharedWorkflowDocument, value);
  if (!r.ok) return { errors: r.errors.map((e) => inFile(e.path, e.message)) };
  const own = resolveLikes(r.value.steps as Obj, workflowSteps, true, names);
  if ("errors" in own) return { errors: own.errors.map((e) => inFile(e.path, e.message)) };
  const steps = own.steps;
  const errors: WorkflowError[] = [];
  if (!Object.hasOwn(steps, r.value.start)) errors.push(inFile("/start", `\`${r.value.start}\` is not a step of this file`));
  const exits: string[] = [];
  for (const [s, step] of Object.entries(steps))
    for (const [o, route, block] of routesOf(step)) {
      if (isObj(route) && typeof route.exit === "string") {
        if (!exits.includes(route.exit)) exits.push(route.exit);
        continue;
      }
      const to = typeof route === "string" ? route : isObj(route) ? String(route.to) : "";
      if (!to.startsWith("$") && !Object.hasOwn(steps, to))
        errors.push(inFile(`/steps/${s}/${block}/${o}`, `\`${to}\` is not a step of this file; a shared file leaves through an exit (\`{ exit: <name> }\`)`));
    }
  return errors.length ? { errors } : { name, by, routes, start: r.value.start, steps, exits };
}

/**
 * Each `like` step of one file filled in from its target, shallowly: a key the copy writes replaces
 * the target's value whole. `elsewhere` names the file of a step that is not in this one, so a copy
 * across files is told why it cannot be. Every step is lowered to the pinned form after the copy, its
 * actor first and its outcome objects then, so a copy may write either form's keys over its target's
 * and an `outcomes:` the copy writes replaces the target's means and products with it.
 */
function resolveLikes(steps: Obj, elsewhere: Map<string, string>, shared: boolean, names: SurfaceNames): { steps: Obj } | { errors: WorkflowError[] } {
  const errors: WorkflowError[] = [];
  const out: Obj = {};
  for (const [name, step] of Object.entries(steps)) {
    // a step named `__proto__` would set the copy's prototype instead of naming a step
    if (!check(StepName, name).ok) {
      errors.push({ path: `/steps/${name}`, message: `step name '${name}' is not a valid name` });
      continue;
    }
    if (!isObj(step) || !("like" in step)) {
      out[name] = step;
      continue;
    }
    const { like: target, ...rest } = step;
    const refuse = (message: string) => errors.push({ path: `/steps/${name}/like`, message });
    const of = typeof target === "string" && Object.hasOwn(steps, target) ? steps[target] : undefined;
    if ("use" in step) refuse("a use step cannot carry `like`");
    else if (typeof target !== "string") refuse("must name a step of this file");
    else if (target === name) refuse("a step cannot be like itself");
    else if (!isObj(of)) {
      const other = elsewhere.get(target);
      refuse(other ? `\`${target}\` is a step of ${other}: like copies a step of its own file` : `\`${target}\` is not a step of this file`);
    } else if ("like" in of) refuse(`\`${target}\` is a like step: name the step it copies, \`${String(of.like)}\``);
    else if ("use" in of) refuse(`\`${target}\` is a use step: like copies a step written in its own file`);
    else out[name] = structuredClone({ ...of, ...rest });
  }
  for (const [name, step] of Object.entries(out)) {
    if (!isObj(step)) continue;
    const actor = "use" in step ? { step } : lowerActor(name, step, names);
    if ("errors" in actor) {
      errors.push(...actor.errors);
      continue;
    }
    const lowered = lowerOutcomes(name, actor.step, shared);
    if ("errors" in lowered) errors.push(...lowered.errors);
    else out[name] = lowered.step;
  }
  return errors.length ? { errors } : { steps: out };
}

/** Step names stay as written once brought in, so two places giving one name have no answer. */
function clashes(steps: Obj, uses: Array<[string, Obj]>, included: Included[]): WorkflowError[] {
  const useNames = new Set(uses.map(([n]) => n));
  const seen = new Map<string, Included>();
  const out: WorkflowError[] = [];
  for (const inc of included)
    for (const name of Object.keys(inc.steps)) {
      const other = seen.get(name);
      const places = other
        ? `${fileOf(other.name)} and from ${fileOf(inc.name)}`
        : useNames.has(name)
          ? `${fileOf(inc.name)} and is the name of the use step \`${name}\``
          : Object.hasOwn(steps, name)
            ? `${fileOf(inc.name)} and from the workflow`
            : null;
      if (places) out.push({ path: `/steps/${name}`, message: `step \`${name}\` comes from ${places}` });
      else seen.set(name, inc);
    }
  return out;
}

/** `reset_on` and `base.verify` name one step, never a way in: a use step there is ambiguous. */
function useStepNamedWhereAStepMustBe(doc: WorkflowFile, byUse: Map<string, Included>): WorkflowError[] {
  const out: WorkflowError[] = [];
  for (const [c, spec] of Object.entries(doc.counters ?? {})) {
    const edges = spec.reset_on === undefined ? [] : Array.isArray(spec.reset_on) ? spec.reset_on : [spec.reset_on];
    for (const edge of edges) {
      const inc = byUse.get(edge.split(".")[0] as string);
      if (inc) out.push({ path: `/counters/${c}/reset_on`, message: `\`${inc.by}\` is a use step: name the step of ${fileOf(inc.name)} whose edge resets the counter` });
    }
  }
  const inc = doc.base?.verify === undefined ? undefined : byUse.get(doc.base.verify);
  if (inc) out.push({ path: "/base/verify", message: `\`${inc.by}\` is a use step: name the check step of ${fileOf(inc.name)}` });
  return out;
}

function exitOf(inc: Included, exit: string): ExitLeft {
  const r = inc.routes[exit];
  return {
    exit: `${inc.by}.${exit}`,
    ...(isObj(r) && typeof r.counter === "string" && { counter: r.counter }),
    ...(isObj(r) && typeof r.max === "number" && { max: r.max }),
  };
}

/** The routes a step writes under both blocks, `outcomes:` and `on:`, each with the block it sits in. */
function routesOf(step: unknown): Array<[string, unknown, "outcomes" | "on"]> {
  if (!isObj(step)) return [];
  const out: Array<[string, unknown, "outcomes" | "on"]> = [];
  for (const block of ["outcomes", "on"] as const) {
    const routes = step[block];
    if (isObj(routes)) for (const [o, r] of Object.entries(routes)) out.push([o, r, block]);
  }
  return out;
}

/** The step with every route of both blocks mapped; a step without them is returned as it is. */
function mapRoutes(step: unknown, f: (v: unknown) => unknown): unknown {
  if (!isObj(step)) return step;
  const out = { ...step };
  for (const block of ["outcomes", "on"] as const) if (isObj(step[block])) out[block] = mapValues(step[block], f);
  return out;
}

function mapValues(o: Obj, f: (v: unknown) => unknown): Obj {
  return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, f(v)]));
}

function retarget(route: unknown, enter: (t: string) => string): unknown {
  if (typeof route === "string") return enter(route);
  return isObj(route) && typeof route.to === "string" ? { ...route, to: enter(route.to) } : route;
}

/** A shared route as the workflow sees it: an exit takes `to`, `counter` and `max` from the use step's route for it. */
function leave(route: unknown, routes: Obj, enter: (t: string) => string): Route {
  if (!isObj(route) || typeof route.exit !== "string") return route as Route;
  const { exit, ...rest } = route;
  const r = routes[exit];
  const edge = r === undefined ? { to: "$stuck" } : typeof r === "string" ? { to: enter(r) } : (retarget(r, enter) as Obj);
  const full = { ...edge, ...rest } as Obj;
  return (Object.keys(full).length === 1 ? full.to : full) as Route;
}
