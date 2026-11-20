/**
 * Reading one flat step: which key is its head, whether its other keys belong to that head, and which
 * outcomes it can end with. A step kind is told apart by its key alone, never by which plugin gave it,
 * so a host that lacks a kind learns its name (`missing_kind`) and can say which plugin to add.
 */
import { BUILTIN_STEP_KINDS, STEP_KEYWORDS } from "@norn/plugin-api";
import { check, isSignalKind, SIGNAL_KINDS } from "@norn/schema";
import type { Route, WorkflowStepDoc } from "./document.ts";
import type { StepKindInfo } from "./load.ts";
import { BUILTIN_STEP_OUTCOMES, OVERRIDABLE_OUTCOMES, type StepRunner, type WorkflowError } from "./graph.ts";

export interface ReadStep {
  kind: string;
  runner: StepRunner;
  /** every outcome the step can end with, in the order it is declared */
  outcomes: string[];
  routes: Record<string, Route>;
  /** a plugin step's extra keys */
  config?: Record<string, unknown>;
}

const BUILTIN: readonly string[] = BUILTIN_STEP_KINDS;
const KEYWORDS: readonly string[] = STEP_KEYWORDS;
const OVERRIDABLE: readonly string[] = OVERRIDABLE_OUTCOMES;

/** The keys beside its head each built-in kind takes; a plugin kind takes `description`, `outcomes` and its configSchema's keys. */
const KEYS_OF: Readonly<Record<string, readonly string[]>> = {
  agent: ["description", "outcomes", "means", "verdict", "skills", "inputs", "attended", "by", "model", "criteria", "hand_back", "deadline", "nudges", "retries"],
  check: ["description", "outcomes", "timeout", "exits"],
  gate: ["description", "outcomes"],
  slices: ["description", "outcomes"],
  await: ["description", "outcomes", "deadline", "grace"],
};
const PLUGIN_KEYS: readonly string[] = ["description", "outcomes"];

/**
 * Outcomes a built-in step ends with only where it routes them: a gate goes `stale` when the base moved
 * under a story waiting there, and `unpushed` when the story's branch holds commits its change lacks,
 * each only through a route the workflow gives it.
 */
const ROUTED_ONLY: Readonly<Record<string, readonly string[]>> = { gate: ["stale", "unpushed"], await: ["stale", "unpushed"] };
/** A story waiting on a `wait` step kind leaves it the same way a waiting gate does, by the kind's mode rather than its name. */
const WAIT_ROUTED_ONLY: readonly string[] = ["unpushed"];

function routedOnly(head: string, step: WorkflowStepDoc, plugin: StepKindInfo | undefined): readonly string[] {
  // an await step ends `timeout` only once a deadline it sets has passed, and only where it routes it
  if (head === "await") return [...(ROUTED_ONLY.await ?? []), ...(step.deadline === undefined ? [] : ["timeout"])];
  if (!plugin) return ROUTED_ONLY[head] ?? [];
  return plugin.mode === "wait" ? WAIT_ROUTED_ONLY.filter((o) => !plugin.outcomes.includes(o)) : [];
}

export function readStep(
  name: string,
  step: WorkflowStepDoc,
  stepKinds: Readonly<Record<string, StepKindInfo>>,
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
  const allowed = plugin ? PLUGIN_KEYS : (KEYS_OF[head] ?? []);
  const errors: WorkflowError[] = [];
  for (const k of keys)
    if (k !== head && KEYWORDS.includes(k) && !allowed.includes(k)) errors.push({ path: `${at}/${k}`, message: `\`${k}\` is not a key of ${article(head)} ${head} step` });
  if (!plugin) for (const k of loose) errors.push({ path: `${at}/${k}`, message: `\`${k}\` is not a key of ${article(head)} ${head} step` });

  const routes = (step.outcomes ?? {}) as Record<string, Route>;
  let config: Record<string, unknown> | undefined;
  if (plugin) {
    if (raw[head] !== null) errors.push({ path: `${at}/${head}`, message: `\`${head}\` takes no value: its settings are the step's other keys` });
    config = Object.fromEntries(loose.map((k) => [k, raw[k]]));
    const r = check(plugin.configSchema, config);
    if (!r.ok) errors.push(...r.errors.map((e) => ({ path: `${at}${e.path}`, message: `${head}: ${e.message}` })));
  }
  if (head === "check" && step.timeout === undefined) errors.push({ path: at, message: "a check needs a timeout" });

  const ends = endsOf(name, head, step, plugin, routes, at, errors);
  for (const o of ends) if (!Object.hasOwn(routes, o)) errors.push({ path: `${at}/outcomes`, message: `step '${name}' can end with '${o}' but routes it nowhere` });
  const optional = routedOnly(head, step, plugin);
  for (const o of Object.keys(routes)) {
    if (ends.includes(o) || optional.includes(o) || (head === "agent" && OVERRIDABLE.includes(o))) continue;
    errors.push({ path: `${at}/outcomes/${o}`, message: `step '${name}' (${head}) never ends with '${o}'` });
  }
  if (errors.length) return { ok: false, errors };
  const runner: StepRunner = plugin ? { type: "plugin", mode: plugin.mode } : { type: "builtin" };
  const outcomes = [...ends, ...optional.filter((o) => Object.hasOwn(routes, o))];
  return { ok: true, step: { kind: head, runner, outcomes, routes, ...(config && { config }) } };
}

/** The outcomes a step can end with that must each be routed; agent steps declare their own by routing them. */
function endsOf(name: string, head: string, step: WorkflowStepDoc, plugin: StepKindInfo | undefined, routes: Record<string, Route>, at: string, errors: WorkflowError[]): string[] {
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
  if (head === "await") return awaitEnds(name, step, at, errors);
  const optional = ROUTED_ONLY[head] ?? [];
  return (BUILTIN_STEP_OUTCOMES[head as keyof typeof BUILTIN_STEP_OUTCOMES] ?? []).filter((o) => !optional.includes(o));
}

/** An await step ends with each signal kind it lists, which must each be one norn knows. */
function awaitEnds(name: string, step: WorkflowStepDoc, at: string, errors: WorkflowError[]): string[] {
  const on = step.await ?? [];
  on.forEach((k, i) => {
    if (!isSignalKind(k)) errors.push({ path: `${at}/await/${i}`, message: `\`${k}\` is not a signal kind: one of ${SIGNAL_KINDS.join(", ")}` });
  });
  if (step.grace !== undefined && !on.includes("ci.none")) errors.push({ path: `${at}/grace`, message: `grace counts down to ci.none, which step '${name}' does not wait on` });
  return [...on];
}

function agentEnds(step: WorkflowStepDoc, routes: Record<string, Route>, at: string, errors: WorkflowError[]): string[] {
  const reportable = Object.keys(routes).filter((o) => !OVERRIDABLE.includes(o));
  // a dotted name is a signal kind, which only an await step takes
  for (const o of reportable) if (o.includes(".")) errors.push({ path: `${at}/outcomes/${o}`, message: `'${o}' is a signal kind's spelling: an agent reports a plain outcome` });
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

function article(word: string): string {
  return /^[aeiou]/.test(word) ? "an" : "a";
}

function refused(e: WorkflowError): { ok: false; errors: WorkflowError[] } {
  return { ok: false, errors: [e] };
}
