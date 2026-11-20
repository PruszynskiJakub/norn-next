/**
 * Reading one flat step: which key is its head, whether its other keys belong to that head, which
 * outcomes it can end with, and which signals may interrupt it while it waits. A step kind is told
 * apart by its key alone, never by which plugin gave it, so a host that lacks a kind learns its name
 * (`missing_kind`) and can say which plugin to add.
 */
import { BUILTIN_STEP_KINDS, type SignalDeclaration, STEP_KEYWORDS } from "@norn/plugin-api";
import { check } from "@norn/schema";
import { Type } from "@sinclair/typebox";
import { ON_ROUTE_KEYS, type OnRoute, type Route, type WorkflowStepDoc } from "./document.ts";
import type { StepKindInfo } from "./load.ts";
import { BUILTIN_STEP_OUTCOMES, OVERRIDABLE_OUTCOMES, type StepRunner, type WorkflowError } from "./graph.ts";

/** A signal a step routes, as a tick weighs it: its name, and the parameters its `on:` entry gives. */
export interface ReadSignal {
  name: string;
  params?: Record<string, unknown>;
  /** routed under `on:`; false for a pinned revision's `stale` or `unpushed` under `outcomes:` */
  on: boolean;
}

export interface ReadStep {
  kind: string;
  runner: StepRunner;
  /** every outcome the step can end with by itself, in the order it is declared */
  outcomes: string[];
  /** the routes of both blocks, by outcome or signal name: an edge is `<step>.<name>` whichever block it sits in */
  routes: Record<string, Route>;
  /** the signals the step routes, first weighed first */
  signals: ReadSignal[];
  /** a plugin step's extra keys */
  config?: Record<string, unknown>;
}

const BUILTIN: readonly string[] = BUILTIN_STEP_KINDS;
const KEYWORDS: readonly string[] = STEP_KEYWORDS;
const OVERRIDABLE: readonly string[] = OVERRIDABLE_OUTCOMES;

/** The keys beside its head each built-in kind takes; a plugin kind takes `description`, `outcomes` and its configSchema's keys, and `on` when it waits. */
const KEYS_OF: Readonly<Record<string, readonly string[]>> = {
  agent: ["description", "outcomes", "means", "verdict", "skills", "inputs", "attended", "by", "model", "criteria", "hand_back", "deadline", "nudges", "retries"],
  check: ["description", "outcomes", "timeout", "exits"],
  gate: ["description", "outcomes", "on"],
  slices: ["description", "outcomes"],
};
const PLUGIN_KEYS: readonly string[] = ["description", "outcomes"];

/**
 * The signals a gate or a wait step without `on:` may route under `outcomes:`. A unit keeps the workflow
 * it pinned, so a pinned revision may route them there; it loads to the graph `on:` would give, the
 * signals weighed in this order.
 */
const LEGACY_SIGNALS: readonly string[] = ["stale", "unpushed"];

const NO_PARAMS = Type.Object({}, { additionalProperties: false });

export function readStep(
  name: string,
  step: WorkflowStepDoc,
  stepKinds: Readonly<Record<string, StepKindInfo>>,
  signals: Readonly<Record<string, SignalDeclaration>>,
): { ok: true; step: ReadStep } | { ok: false; errors: WorkflowError[] } {
  const at = `/steps/${name}`;
  const raw = step as Record<string, unknown>;
  const keys = Object.keys(raw);
  const heads = keys.filter((k) => BUILTIN.includes(k) || Object.hasOwn(stepKinds, k));
  const loose = keys.filter((k) => !heads.includes(k) && !KEYWORDS.includes(k));
  if (heads.length > 1) return refused({ path: at, message: `step '${name}' has ${heads.length} head keys (${heads.join(", ")}): a step does exactly one thing` });
  const head = heads[0];
  if (head === undefined) {
    const missing = loose[0];
    if (missing === undefined) return refused({ path: at, message: `step '${name}' has no head key: give it one of ${[...BUILTIN, ...Object.keys(stepKinds)].join(", ")}` });
    return refused({ path: `${at}/${missing}`, message: `\`${missing}\` is not a step kind the kernel or a configured plugin provides: add the plugin that provides it`, missing_kind: missing });
  }

  const plugin = Object.hasOwn(stepKinds, head) && !BUILTIN.includes(head) ? stepKinds[head] : undefined;
  const waits = plugin ? plugin.mode === "wait" : head === "gate";
  const allowed = plugin ? (waits ? [...PLUGIN_KEYS, "on"] : PLUGIN_KEYS) : (KEYS_OF[head] ?? []);
  const errors: WorkflowError[] = [];
  for (const k of keys) {
    if (k === head || !KEYWORDS.includes(k) || allowed.includes(k)) continue;
    // a running agent, check or effect is never interrupted: it ends by itself or by its own bounds
    if (k === "on") errors.push({ path: `${at}/on`, message: `\`on\` is only for a gate or a wait step, and step '${name}' is a ${plugin ? `${head} (an effect)` : head} step` });
    else errors.push({ path: `${at}/${k}`, message: `\`${k}\` is not a key of a ${head} step` });
  }
  if (!plugin) for (const k of loose) errors.push({ path: `${at}/${k}`, message: `\`${k}\` is not a key of a ${head} step` });

  const outcomeRoutes = (step.outcomes ?? {}) as Record<string, Route>;
  let config: Record<string, unknown> | undefined;
  if (plugin) {
    if (raw[head] !== null) errors.push({ path: `${at}/${head}`, message: `\`${head}\` takes no value: its settings are the step's other keys` });
    config = Object.fromEntries(loose.map((k) => [k, raw[k]]));
    const r = check(plugin.configSchema, config);
    if (!r.ok) errors.push(...r.errors.map((e) => ({ path: `${at}${e.path}`, message: `${head}: ${e.message}` })));
  }
  if (head === "check" && step.timeout === undefined) errors.push({ path: at, message: "a check needs a timeout" });

  const ends = endsOf(head, step, plugin, outcomeRoutes, at, errors);
  // a wait kind may answer by itself what the host also reports between its polls (await-merge's
  // `unpushed`): one route under on: serves both, so the name still sits in one block
  const onRoutes = waits ? ((step.on ?? {}) as Record<string, OnRoute>) : {};
  for (const o of ends) if (!Object.hasOwn(outcomeRoutes, o) && !(plugin && Object.hasOwn(onRoutes, o) && Object.hasOwn(signals, o))) errors.push({ path: `${at}/outcomes`, message: `step '${name}' can end with '${o}' but routes it nowhere` });
  // a step with an `on:` block is written in the new form, where `outcomes:` holds only how it ends by itself
  const legacy = waits && step.on === undefined ? LEGACY_SIGNALS.filter((o) => Object.hasOwn(outcomeRoutes, o)) : [];
  for (const o of Object.keys(outcomeRoutes)) {
    if (ends.includes(o) || legacy.includes(o) || (head === "agent" && OVERRIDABLE.includes(o))) continue;
    const hint = waits && Object.hasOwn(signals, o) ? `: '${o}' is a signal, routed under on:` : "";
    errors.push({ path: `${at}/outcomes/${o}`, message: `step '${name}' (${head}) never ends with '${o}'${hint}` });
  }

  const routes: Record<string, Route> = { ...outcomeRoutes };
  const read: ReadSignal[] = [];
  if (waits)
    for (const [signal, entry] of Object.entries(onRoutes)) {
      const where = `${at}/on/${signal}`;
      const declared = Object.hasOwn(signals, signal) ? signals[signal] : undefined;
      if (!declared) {
        errors.push({ path: where, message: `\`${signal}\` is not a signal the host or a configured plugin reports: add the plugin that provides it` });
        continue;
      }
      if (Object.hasOwn(outcomeRoutes, signal)) {
        errors.push({ path: where, message: `step '${name}' routes '${signal}' under both outcomes and on: a name sits in one block` });
        continue;
      }
      const { route, params } = splitEntry(entry);
      const r = check(declared.params ?? NO_PARAMS, params ?? {});
      if (!r.ok) {
        errors.push(...r.errors.map((e) => ({ path: `${where}${e.path}`, message: `${signal}: ${e.message}` })));
        continue;
      }
      routes[signal] = route;
      read.push({ name: signal, ...(params && { params }), on: true });
    }
  for (const o of legacy) read.push({ name: o, on: false });

  if (errors.length) return { ok: false, errors };
  const runner: StepRunner = plugin ? { type: "plugin", mode: plugin.mode } : { type: "builtin" };
  return { ok: true, step: { kind: head, runner, outcomes: ends, routes, signals: read, ...(config && { config }) } };
}

/** An `on:` entry as its route and the signal's parameters beside it; no parameters is `undefined`. */
function splitEntry(entry: OnRoute): { route: Route; params?: Record<string, unknown> } {
  if (typeof entry === "string") return { route: entry };
  const route: Record<string, unknown> = {};
  const params: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(entry)) (ON_ROUTE_KEYS.includes(k) ? route : params)[k] = v;
  return { route: (Object.keys(route).length === 1 && typeof route.to === "string" ? route.to : route) as Route, ...(Object.keys(params).length && { params }) };
}

/** The outcomes a step can end with that must each be routed; agent steps declare their own by routing them. */
function endsOf(head: string, step: WorkflowStepDoc, plugin: StepKindInfo | undefined, routes: Record<string, Route>, at: string, errors: WorkflowError[]): string[] {
  if (plugin) return [...plugin.outcomes];
  if (head === "check") {
    const named: string[] = [];
    for (const [code, o] of Object.entries(step.exits ?? {})) {
      if (o === "pass" || o === "fail" || o === "exhausted") errors.push({ path: `${at}/exits/${code}`, message: `exit ${code} names '${o}', which a check reaches without exits` });
      else if (!named.includes(o)) named.push(o);
    }
    return ["pass", "fail", ...named];
  }
  if (head === "agent") return agentEnds(step, routes, at, errors);
  return [...(BUILTIN_STEP_OUTCOMES[head as keyof typeof BUILTIN_STEP_OUTCOMES] ?? [])];
}

function agentEnds(step: WorkflowStepDoc, routes: Record<string, Route>, at: string, errors: WorkflowError[]): string[] {
  const reportable = Object.keys(routes).filter((o) => !OVERRIDABLE.includes(o));
  if (Object.hasOwn(routes, "exhausted")) errors.push({ path: `${at}/outcomes/exhausted`, message: "'exhausted' always routes to $stuck and cannot be declared" });
  if (!reportable.length) errors.push({ path: `${at}/outcomes`, message: "an agent step declares at least one outcome it reports" });
  const about = { hand_back: step.hand_back, means: step.means, verdict: step.verdict };
  for (const [key, map] of Object.entries(about))
    for (const o of Object.keys(map ?? {}))
      if (!reportable.includes(o))
        errors.push({
          path: `${at}/${key}/${o}`,
          message: OVERRIDABLE.includes(o) ? `${key} names '${o}', a route the kernel takes, never one an agent reports` : `${key} names outcome '${o}', but the step declares no route for it in outcomes`,
        });
  return reportable.filter((o) => o !== "exhausted");
}

function refused(e: WorkflowError): { ok: false; errors: WorkflowError[] } {
  return { ok: false, errors: [e] };
}
