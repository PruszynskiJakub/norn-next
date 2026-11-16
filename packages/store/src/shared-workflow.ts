/**
 * Flattening a workflow's `use` steps into the steps of the shared files they name, before the
 * workflow is validated. The result is an ordinary flat workflow: core, decide and receipts never
 * see a shared file. Pure over a reader of shared texts, so a caller reading them from a branch
 * reads first (`sharedFilesUsed`) and passes them in.
 */
import { check, type SchemaError, UseStep, validate } from "@norn/schema";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

/** The folder of shared files, inside the workflows folder. */
export const SHARED_DIR = "shared";
export const sharedFile = (name: string) => `${SHARED_DIR}/${name}.yaml`;

/** The text of `shared/<name>.yaml`, or null when there is no such file. */
export type SharedReader = (name: string) => string | null;

export type Flattened =
  | {
      ok: true;
      /** the flat workflow as YAML text: what is pinned and hashed */
      source: string;
      /** included step → the shared file (name) it came from */
      included: Record<string, string>;
    }
  | { ok: false; errors: SchemaError[] };

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isReserved = (t: string) => t.startsWith("$");

const WORKFLOW_KEYS = ["name", "counters", "defaults", "mode", "base"];

function useSteps(doc: unknown): Array<[string, Obj]> {
  if (!isObj(doc) || !isObj(doc.steps)) return [];
  return Object.entries(doc.steps).filter((e): e is [string, Obj] => isObj(e[1]) && "use" in e[1]);
}

function parsed(text: string): { ok: true; value: unknown } | { ok: false; message: string } {
  try {
    return { ok: true, value: parseYaml(text) };
  } catch (e) {
    return { ok: false, message: `YAML: ${(e as Error).message.split("\n")[0]}` };
  }
}

/** The shared files (names) a workflow text brings in with `use:`. */
export function sharedFilesUsed(text: string): string[] {
  const p = parsed(text);
  if (!p.ok) return [];
  return [...new Set(useSteps(p.value).flatMap(([, s]) => (typeof s.use === "string" ? [s.use] : [])))];
}

interface Included {
  name: string;
  file: string;
  /** the use step that brings it in, and its routes for the file's exits */
  by: string;
  routes: Obj;
  start: string;
  steps: Obj;
  exits: string[];
}

/** null when the text has no `use` step (or is not YAML): it loads as written. */
export function flattenWorkflowText(text: string, read: SharedReader): Flattened | null {
  const p = parsed(text);
  if (!p.ok) return null;
  const doc = p.value;
  const uses = useSteps(doc);
  if (!uses.length || !isObj(doc)) return null;

  const errors: SchemaError[] = [];
  const included = new Map<string, Included>();
  for (const [by, step] of uses) {
    const r = check(UseStep, step);
    if (!r.ok) {
      errors.push(...r.errors.map((e) => ({ path: `/steps/${by}${e.path}`, message: e.message })));
      continue;
    }
    const name = step.use as string;
    const twice = included.get(name);
    if (twice) {
      errors.push({ path: `/steps/${by}/use`, message: `${sharedFile(name)} is used twice, by \`${twice.by}\` and \`${by}\`: its step \`${Object.keys(twice.steps)[0]}\` would come from both` });
      continue;
    }
    const s = readShared(name, by, (step.outcomes as Obj | undefined) ?? {}, read);
    if ("errors" in s) errors.push(...s.errors);
    else included.set(name, s);
  }
  if (errors.length) return { ok: false, errors };

  errors.push(...clashes(doc.steps as Obj, uses, [...included.values()]));
  if (errors.length) return { ok: false, errors };

  const byUse = new Map([...included.values()].map((i) => [i.by, i]));
  const enter = (t: unknown) => (typeof t === "string" ? (byUse.get(t)?.start ?? t) : t);
  for (const inc of byUse.values())
    for (const exit of Object.keys(inc.routes))
      if (!inc.exits.includes(exit))
        errors.push({ path: `/steps/${inc.by}/outcomes/${exit}`, message: `\`${exit}\` is not an exit of ${inc.file} (its exits: ${inc.exits.join(", ") || "none"})` });
  errors.push(...useStepNamedWhereAStepMustBe(doc, byUse));
  if (errors.length) return { ok: false, errors };

  const steps: Obj = {};
  const from: Record<string, string> = {};
  for (const [name, step] of Object.entries(doc.steps as Obj)) {
    const inc = byUse.get(name);
    if (!inc) {
      steps[name] = isObj(step) && isObj(step.outcomes) ? { ...step, outcomes: mapValues(step.outcomes, (o) => retarget(o, enter)) } : step;
      continue;
    }
    for (const [inner, s] of Object.entries(inc.steps)) {
      from[inner] = inc.name;
      steps[inner] = isObj(s) && isObj(s.outcomes) ? { ...s, outcomes: mapValues(s.outcomes, (o) => leave(o, inc.routes, enter)) } : s;
    }
  }
  const flat: Obj = {};
  for (const [k, v] of Object.entries(doc)) {
    if (k === "steps") flat[k] = steps;
    else if (k === "start") flat[k] = enter(v);
    else if (k === "base" && isObj(v) && "step" in v) flat[k] = { ...v, step: enter(v.step) };
    else flat[k] = v;
  }
  return { ok: true, source: stringifyYaml(flat, { lineWidth: 0 }), included: from };
}

function readShared(name: string, by: string, routes: Obj, read: SharedReader): Included | { errors: SchemaError[] } {
  const file = sharedFile(name);
  const text = read(name);
  if (text === null) return { errors: [{ path: `/steps/${by}/use`, message: `shared file \`${file}\` not found in \`.agents/workflows/${SHARED_DIR}/\`` }] };
  const p = parsed(text);
  if (!p.ok) return { errors: [{ path: `/steps/${by}/use`, message: `${file}: ${p.message}` }] };
  const value = p.value;
  const inFile = (e: SchemaError) => ({ path: e.path, message: `${file}: ${e.message}` });
  // Ahead of the schema's generic message, as misplaced step keys are: say where the key goes
  if (isObj(value)) {
    const misplaced = WORKFLOW_KEYS.filter((k) => k in value).map((k) => inFile({ path: `/${k}`, message: `\`${k}\` belongs in the workflow` }));
    const nested = useSteps(value).map(([s]) => inFile({ path: `/steps/${s}/use`, message: "a shared file cannot use another shared file" }));
    if (misplaced.length || nested.length) return { errors: [...misplaced, ...nested] };
  }
  const r = validate("workflow-shared", value);
  if (!r.ok) return { errors: r.errors.map(inFile) };
  const steps = r.value.steps as Obj;
  const errors: SchemaError[] = [];
  if (!Object.hasOwn(steps, r.value.start)) errors.push(inFile({ path: "/start", message: `\`${r.value.start}\` is not a step of this file` }));
  const exits: string[] = [];
  for (const [s, step] of Object.entries(steps))
    for (const [o, route] of Object.entries((step as { outcomes: Obj }).outcomes)) {
      if (isObj(route) && typeof route.exit === "string") {
        if (!exits.includes(route.exit)) exits.push(route.exit);
        continue;
      }
      const to = typeof route === "string" ? route : isObj(route) ? (route.to as string) : "";
      if (!isReserved(to) && !Object.hasOwn(steps, to))
        errors.push(inFile({ path: `/steps/${s}/outcomes/${o}`, message: `\`${to}\` is not a step of this file; a shared file leaves through an exit (\`{ exit: <name> }\`)` }));
    }
  return errors.length ? { errors } : { name, file, by, routes, start: r.value.start, steps, exits };
}

/** Included step names must be unique across the workflow: names are kept, so a clash has no answer. */
function clashes(steps: Obj, uses: Array<[string, Obj]>, included: Included[]): SchemaError[] {
  const useNames = new Set(uses.map(([n]) => n));
  const seen = new Map<string, Included>();
  const out: SchemaError[] = [];
  for (const inc of included)
    for (const name of Object.keys(inc.steps)) {
      const other = seen.get(name);
      const places = other
        ? `${other.file} and from ${inc.file}`
        : name === inc.by
          ? `${inc.file} and is the name of the use step that brings it in`
          : useNames.has(name)
            ? `${inc.file} and is the name of the use step \`${name}\``
            : Object.hasOwn(steps, name)
              ? `${inc.file} and from the workflow`
              : null;
      if (places) out.push({ path: `/steps/${name}`, message: `step \`${name}\` comes from ${places}` });
      else seen.set(name, inc);
    }
  return out;
}

/** `reset_on` and `base.verify` name one step, never a way in: a use step there is ambiguous. */
function useStepNamedWhereAStepMustBe(doc: Obj, byUse: Map<string, Included>): SchemaError[] {
  const out: SchemaError[] = [];
  if (isObj(doc.counters))
    for (const [c, spec] of Object.entries(doc.counters)) {
      if (!isObj(spec)) continue;
      const edges = Array.isArray(spec.reset_on) ? spec.reset_on : [spec.reset_on];
      for (const edge of edges) {
        const inc = typeof edge === "string" ? byUse.get(edge.split(".")[0] as string) : undefined;
        if (inc) out.push({ path: `/counters/${c}/reset_on`, message: `\`${inc.by}\` is a use step: name the step of ${inc.file} whose edge resets the counter` });
      }
    }
  const verify = isObj(doc.base) ? doc.base.verify : undefined;
  const inc = typeof verify === "string" ? byUse.get(verify) : undefined;
  if (inc) out.push({ path: "/base/verify", message: `\`${inc.by}\` is a use step: name the check step of ${inc.file}` });
  return out;
}

function mapValues(o: Obj, f: (v: unknown) => unknown): Obj {
  return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, f(v)]));
}

function retarget(route: unknown, enter: (t: unknown) => unknown): unknown {
  if (typeof route === "string") return enter(route);
  return isObj(route) && "to" in route ? { ...route, to: enter(route.to) } : route;
}

/** A shared route as the workflow sees it: an exit takes `to` and `counter` from the use step, `means` and `verdict` from the shared side. */
function leave(route: unknown, routes: Obj, enter: (t: unknown) => unknown): unknown {
  if (!isObj(route) || typeof route.exit !== "string") return route;
  const { exit, ...rest } = route;
  const r = routes[exit];
  const edge = r === undefined ? { to: "$stuck" } : typeof r === "string" ? { to: enter(r) } : retarget(r, enter);
  const full = { ...(edge as Obj), ...rest };
  return Object.keys(full).length === 1 ? full.to : full;
}
