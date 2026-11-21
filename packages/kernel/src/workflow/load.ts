/**
 * Turning a workflow document into a pinned workflow and its compiled graph. Pure: the host reads the
 * files and passes their parsed contents; every refusal comes back as data, never a throw, so a host
 * can show all of a file's problems at once and a unit whose workflow fails keeps its pinned one.
 */
import { BUILTIN_SIGNALS, type SignalDeclaration, type StepKindDefinition } from "@norn/plugin-api";
import { check, parseDuration } from "@norn/schema";
import type { KernelConfig } from "../model/config.ts";
import { type CountedStep, deriveCounters } from "./counters.ts";
import { type CounterDoc, type OnRoute, type Route, WorkflowDocument, type WorkflowStepDoc } from "./document.ts";
import { type Flat, flatten } from "./flatten.ts";
import type { AgentStepSpec, CompiledCounter, CompiledRoute, CompiledStep, PinnedWorkflow, WorkflowError, WorkflowGraph, WorkflowLoad } from "./graph.ts";
import { flowErrors, producesOn, readersOf } from "./produces.ts";
import { checkGraph } from "./shape.ts";
import { type ReadStep, readStep } from "./steps.ts";

/** What the loader needs of a registered step kind; `run` stays with the host. */
export type StepKindInfo = Pick<StepKindDefinition, "name" | "configSchema" | "outcomes" | "mode" | "reads">;

export interface LoadWorkflowOptions {
  /** every step kind the configured plugins provide, by head key */
  stepKinds: Readonly<Record<string, StepKindInfo>>;
  /** parsed `shared/<name>.yaml` files a `use:` step may bring in, by name */
  sharedFiles: Readonly<Record<string, unknown>>;
  /** the bounds and limits a workflow falls back to where it sets none */
  config: Pick<KernelConfig, "counterDefaults" | "maxNudges" | "maxRetries" | "deadlineMs">;
  /** the signals configured plugins report, by name, beside the host's own (`BUILTIN_SIGNALS`), which they never replace */
  signals?: Readonly<Record<string, SignalDeclaration>>;
  /**
   * the input names the host's brief builder provides; an agent step naming another is refused. Left
   * out when loading a unit's pinned revision, which loads as it was pinned: it was accepted then, and
   * refusing it now would leave the unit with no workflow to decide by.
   */
  inputs?: readonly string[];
}

type Fail = { ok: false; errors: WorkflowError[] };
const fail = (errors: WorkflowError[]): Fail => ({ ok: false, errors });

/**
 * Validate and compile `doc` (a parsed workflow file, or a pinned workflow's flat document). Refuses:
 * a step without exactly one head key; a head that is neither built in nor a registered step kind
 * (`missing_kind` names it); a plugin step's extra keys failing its kind's configSchema; an outcome a
 * step can end with left unrouted (the overridable built-in outcomes excepted); a target that is not a
 * step, `$done` or `$stuck`; a step no route reaches; a route back that no counter bounds; and an
 * `on:` block on a step that does not wait, naming a signal no source reports, giving parameters the
 * signal does not take, or naming what `outcomes:` already routes; a `produces:` file outside the
 * spec folder, due on an outcome the step does not report, or named twice with two files; and, when
 * `opts.inputs` is given, an agent step's input name neither the host provides nor a step produces, a
 * produced name the host already provides, and a produced name an input or a step kind's `reads`
 * names that some path from `start` reaches with no producer on it.
 * Counters are derived by edge kind (see `deriveCounters`) and written into the pinned document, so
 * its hash covers them, and loading a pinned document again gives the same hash.
 */
export function loadWorkflow(doc: unknown, opts: LoadWorkflowOptions): WorkflowLoad {
  const schema = check(WorkflowDocument, doc);
  if (!schema.ok) return fail(schema.errors.map((e) => ({ path: e.path, message: e.message })));
  const written = schema.value;
  const signals: Record<string, SignalDeclaration> = { ...opts.signals, ...BUILTIN_SIGNALS };
  const flat = flatten(written, opts.sharedFiles);
  if (!flat.ok) return flat;
  const { steps: flatSteps, included } = flat.flat;
  const inShared = (e: WorkflowError): WorkflowError => {
    const from = e.path.startsWith("/steps/") ? included[e.path.split("/")[2] ?? ""] : undefined;
    return from && e.shared === undefined ? { ...e, message: `shared/${from}.yaml: ${e.message}`, shared: from } : e;
  };

  const read: Record<string, ReadStep> = {};
  const errors: WorkflowError[] = [];
  const produced = [...new Set(Object.values(flatSteps).flatMap((s) => Object.keys(s.produces ?? {})))];
  const fileOf = new Map<string, { step: string; file: string }>();
  for (const [name, step] of Object.entries(flatSteps)) {
    const r = readStep(name, step, opts.stepKinds, signals, opts.inputs, produced);
    if (r.ok) read[name] = r.step;
    else errors.push(...r.errors.map(inShared));
    // the host hands a reader the file by its name, so every producer of a name writes the same file
    for (const [p, { file }] of Object.entries(step.produces ?? {})) {
      const first = fileOf.get(p);
      if (!first) fileOf.set(p, { step: name, file });
      else if (first.file !== file)
        errors.push(inShared({ path: `/steps/${name}/produces/${p}/file`, message: `\`${p}\` is produced as ${first.file} by step ${first.step} and as ${file} here: a produced name names one file` }));
    }
  }
  if (errors.length) return fail(errors);

  const declared = written.counters ?? {};
  errors.push(...targetErrors(flat.flat, read, declared).map(inShared));
  if (errors.length) return fail(errors);

  const order = Object.keys(read);
  const counted: Record<string, CountedStep> = {};
  for (const [name, s] of Object.entries(read)) {
    const exits = flatSteps[name]?.exits;
    // a check that reads an outside fact itself, by an exit named for the signal, is bounded as the signal is
    const reads = Object.values(exits ?? {}).filter((o) => Object.hasOwn(signals, o));
    const moved = [...s.signals.map((x) => x.name), ...reads];
    const on = s.signals.filter((x) => x.on).map((x) => x.name);
    counted[name] = { kind: s.kind, routes: s.routes, ...(exits && { exits }), ...(moved.length && { signals: moved }), ...(on.length && { on }) };
  }
  const derived = deriveCounters(counted, order, declared, flat.flat.exits, opts.config.counterDefaults);
  if (derived.errors.length) return fail(derived.errors.map(inShared));

  const routes: Record<string, Record<string, CompiledRoute>> = {};
  for (const [name, s] of Object.entries(read)) {
    routes[name] = {};
    for (const [o, route] of Object.entries(s.routes)) {
      const to = typeof route === "string" ? route : route.to;
      const counter = derived.edges[`${name}.${o}`] ?? (typeof route === "string" ? undefined : route.counter);
      routes[name][o] = counter === undefined ? { to } : { to, counter };
    }
  }
  const shape = checkGraph(flat.flat.start, order, routes);
  if (shape.length) return fail(shape.map(inShared));
  if (opts.inputs !== undefined) {
    const host = opts.inputs;
    const names = new Set(produced);
    const readers = order.flatMap((name) => readersOf(name, flatSteps[name] as WorkflowStepDoc, read[name]?.kind as string, opts.stepKinds[read[name]?.kind ?? ""]?.reads, names, host));
    const flow = flowErrors(flat.flat.start, routes, flatSteps, readers);
    if (flow.length) return fail(flow.map(inShared));
  }

  const pinned = pin(written, flat.flat, read, routes, derived.counters);
  const graph = compile(pinned, read, routes, derived.counters, opts.config);
  return { ok: true, workflow: { pinned, graph } };
}

/** Every route goes to a step, `$done` or `$stuck`; the counters, `start` and `base` name what exists. */
function targetErrors(flat: Flat, read: Readonly<Record<string, ReadStep>>, declared: Readonly<Record<string, CounterDoc>>): WorkflowError[] {
  const errors: WorkflowError[] = [];
  const isStep = (s: string) => Object.hasOwn(read, s);
  if (!isStep(flat.start)) errors.push({ path: "/start", message: `start step '${flat.start}' does not exist` });
  const named = new Set<string>();
  for (const [name, s] of Object.entries(read))
    for (const [o, route] of Object.entries(s.routes)) {
      const to = typeof route === "string" ? route : route.to;
      if (typeof route !== "string" && route.counter !== undefined) named.add(route.counter);
      const block = s.signals.some((x) => x.on && x.name === o) ? "on" : "outcomes";
      if (to !== "$done" && to !== "$stuck" && !isStep(to)) errors.push({ path: `/steps/${name}/${block}/${o}`, message: `${name}.${o} → '${to}', which is not a step, $done or $stuck` });
    }
  for (const [c, spec] of Object.entries(declared)) {
    // a pinned document carries the counters derived from its edges; a file may not invent one
    if (c.includes(".") && !named.has(c)) errors.push({ path: `/counters/${c}`, message: `counter name '${c}' is derived from its edge, never declared` });
    const resets = spec.reset_on === undefined ? [] : Array.isArray(spec.reset_on) ? spec.reset_on : [spec.reset_on];
    resets.forEach((edge, i) => {
      const [from, outcome] = edge.split(".") as [string, string];
      if (!Object.hasOwn(read[from]?.routes ?? {}, outcome))
        errors.push({ path: `/counters/${c}/reset_on${Array.isArray(spec.reset_on) ? `/${i}` : ""}`, message: `counter '${c}' resets on '${edge}', but step '${from}' routes no outcome '${outcome}'` });
    });
  }
  const base = flat.base;
  if (base?.step !== undefined && !isStep(base.step)) errors.push({ path: "/base/step", message: `base.step '${base.step}' does not exist` });
  if (base?.verify !== undefined) {
    if (base.stale === "behind") errors.push({ path: "/base/verify", message: "base.verify cannot be set with base.stale: behind (any base move already updates the story, so nothing would be verified)" });
    else if (read[base.verify]?.kind !== "check") errors.push({ path: "/base/verify", message: `base.verify '${base.verify}' must name a check step` });
  }
  return errors;
}

/** The flat document a unit records: shared steps brought in, copies filled, every bounded route naming its counter. */
function pin(
  written: WorkflowDocument,
  flat: Flat,
  read: Readonly<Record<string, ReadStep>>,
  routes: Record<string, Record<string, CompiledRoute>>,
  counters: Record<string, CompiledCounter>,
): PinnedWorkflow {
  const steps: Record<string, WorkflowStepDoc> = {};
  for (const [name, step] of Object.entries(flat.steps)) {
    const onBlock = new Map((read[name]?.signals ?? []).filter((s) => s.on).map((s) => [s.name, s.params]));
    const out: Record<string, Route> = {};
    const on: Record<string, OnRoute> = {};
    for (const [o, r] of Object.entries(routes[name] ?? {})) {
      const route: Route = r.counter === undefined ? r.to : { to: r.to, counter: r.counter };
      if (!onBlock.has(o)) out[o] = route;
      else {
        const params = onBlock.get(o);
        on[o] = params === undefined ? route : { ...(typeof route === "string" ? { to: route } : route), ...params };
      }
    }
    steps[name] = { ...step, outcomes: out, ...(onBlock.size && { on }) };
  }
  const docCounters: Record<string, CounterDoc> = {};
  for (const [name, c] of Object.entries(counters))
    docCounters[name] = { max: c.max, ...(c.reset_on.length === 1 ? { reset_on: c.reset_on[0] } : c.reset_on.length > 1 ? { reset_on: c.reset_on } : {}) };
  const { $schema: _schema, counters: _counters, steps: _steps, start: _start, base: _base, ...rest } = written;
  const doc: WorkflowDocument = {
    ...rest,
    start: flat.start,
    steps,
    ...(Object.keys(docCounters).length && { counters: docCounters }),
    ...(flat.base && { base: flat.base }),
  };
  return { name: written.name, hash: sha256(canonicalJson(doc)), doc };
}

function compile(
  pinned: PinnedWorkflow,
  read: Readonly<Record<string, ReadStep>>,
  routes: Record<string, Record<string, CompiledRoute>>,
  counters: Record<string, CompiledCounter>,
  config: LoadWorkflowOptions["config"],
): WorkflowGraph {
  const { doc } = pinned;
  const d = doc.defaults ?? {};
  const steps: Record<string, CompiledStep> = {};
  for (const [name, s] of Object.entries(read)) {
    const written = doc.steps[name] as WorkflowStepDoc;
    const step: CompiledStep = {
      name,
      kind: s.kind,
      runner: s.runner,
      ...(written.description !== undefined && { description: written.description }),
      outcomes: s.outcomes,
      routes: routes[name] ?? {},
    };
    if (s.signals.length) step.signals = s.signals.map((x) => ({ name: x.name, ...(x.params && { params: structuredClone(x.params) }) }));
    if (s.kind === "agent") step.agent = agentSpec(written, d, config);
    else if (s.kind === "check") step.check = { command: written.check as string, timeout_ms: parseDuration(written.timeout as string), exits: { ...(written.exits ?? {}) } };
    else if (s.kind === "gate") step.gate = { prompt: written.gate as string };
    else if (s.config) step.config = s.config;
    steps[name] = step;
  }
  return {
    name: pinned.name,
    hash: pinned.hash,
    start: doc.start,
    ...(doc.mode && { mode: doc.mode }),
    stalled_ms: d.stalled === undefined ? null : parseDuration(d.stalled),
    steps,
    counters,
    ...(doc.base && { base: doc.base }),
  };
}

function agentSpec(s: WorkflowStepDoc, d: NonNullable<WorkflowDocument["defaults"]>, config: LoadWorkflowOptions["config"]): AgentStepSpec {
  const deadline = s.deadline ?? d.deadline;
  return {
    instructions: s.agent as string,
    skills: [...(s.skills ?? [])],
    inputs: [...(s.inputs ?? [])],
    executor: s.by ?? null,
    ...(s.model !== undefined && { model: s.model }),
    attended: s.attended ?? false,
    criteria: s.criteria === "required",
    hand_back: { ...(s.hand_back ?? {}) },
    ...(s.produces !== undefined && { produces: Object.fromEntries(Object.entries(producesOn(s)).map(([name, on]) => [name, { file: s.produces?.[name]?.file as string, on }])) }),
    writes: s.writes ?? "worktree",
    means: { ...(s.means ?? {}) },
    verdict: { ...(s.verdict ?? {}) },
    deadline_ms: deadline === undefined ? config.deadlineMs : parseDuration(deadline),
    nudges: s.nudges ?? d.nudges ?? config.maxNudges,
    retries: s.retries ?? d.retries ?? config.maxRetries,
  };
}

/** JSON with object keys sorted, so key order in the file never changes the hash. */
function canonicalJson(value: unknown): string {
  const sort = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sort);
    if (v === null || typeof v !== "object") return v;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v).sort()) {
      const x = (v as Record<string, unknown>)[k];
      if (x !== undefined) out[k] = sort(x);
    }
    return out;
  };
  return JSON.stringify(sort(value));
}

function sha256(text: string): string {
  return new Bun.CryptoHasher("sha256").update(text).digest("hex");
}
