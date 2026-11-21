/**
 * Lowering a step written with `by`/`do`/`with` to the pinned document's step, which keeps one head key
 * per step (`agent:`, `check:`, `gate:`, `slices:`, a step kind's bare name). A file names a step kind
 * or a signal by its surface name (`forge.open-pr`, `vcs.stale`) and the pinned document by the bare
 * key its plugin registers, so registry lookups, derived counter names (`<step>.<outcome>`) and
 * `reset_on` keep one dot, and a pin's hash never depends on which form a file used.
 */
import { BUILTIN_STEP_KINDS, type SignalDeclaration, STEP_KEYS, STEP_KEYWORDS } from "@norn/plugin-api";
import { AGENT_ROLES, check } from "@norn/schema";
import type { TSchema } from "@sinclair/typebox";
import { ExitsDoc, SkillsDoc } from "./document.ts";
import type { WorkflowError } from "./graph.ts";
import type { StepKindInfo } from "./load.ts";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

const ROLES: readonly string[] = AGENT_ROLES;

/** The capabilities `allow:` may ask for while the pinned document holds only `writes:`. */
const CAPABILITIES: readonly string[] = ["code:write", "docs:write"];

/** The keys only the step form holds: one beside an older head key mixes the two forms. */
const FORM_ONLY: readonly string[] = ["do", "with", "reads", "allow", "limits"];
const BUILTIN: readonly string[] = BUILTIN_STEP_KINDS;
const KEYWORDS: readonly string[] = STEP_KEYWORDS;
const KEYS: readonly string[] = STEP_KEYS;

/** The signals a waiting step routed under `outcomes:` before `on:`; the step form routes them under `on:` only. */
const LEGACY_SIGNALS: readonly string[] = ["stale", "unpushed"];

const NO_EXECUTOR = "the config chooses the executor and its model; a step that must name one keeps the older form (agent: with by: and model:)";

/** Where each key of the older form is written in the step form. */
const WRITTEN_NOW: Readonly<Record<string, string>> = {
  skills: "is written under with: (`with: { skills: [...] }`)",
  inputs: "is written as reads:",
  timeout: "is written under limits: (`limits: { timeout: ... }`)",
  deadline: "is written under limits: (`limits: { deadline: ... }`)",
  nudges: "is written under limits: (`limits: { nudges: ... }`)",
  retries: "is written under limits: (`limits: { retries: ... }`)",
  exits: "is written under with: (`with: { exits: { 3: stale } }`)",
  model: `is not written: ${NO_EXECUTOR}`,
  writes: "is written as allow: (`allow: [docs:write]`)",
  means: "is written on the outcome (`done: { to: ..., means: ... }`)",
  verdict: "is written on the outcome (`pass: { to: ..., verdict: pass }`)",
  criteria: "is written in what the outcomes produce (`produces: [criteria]`)",
  hand_back: "is written in what the outcomes produce (`produces: [findings]`)",
};

export interface SurfaceNames {
  stepKinds: Readonly<Record<string, StepKindInfo>>;
  signals: Readonly<Record<string, SignalDeclaration>>;
}

type Lowered = { step: Obj } | { errors: WorkflowError[] };

/** The namespace a file names a kind by; none when its host gave neither a namespace nor a slot. */
const namespaceOf = (k: StepKindInfo): string | undefined => k.namespace ?? k.slot;

/**
 * The step in the pinned document's form. A step with an older head key comes back as it is, unless it
 * also holds a key only the step form has; a step with neither `by:` nor such a key is left for the
 * step reader, which names an unknown head key.
 */
export function lowerActor(name: string, step: Obj, names: SurfaceNames): Lowered {
  const at = `/steps/${name}`;
  const heads = Object.keys(step).filter((k) => BUILTIN.includes(k) || Object.hasOwn(names.stepKinds, k));
  const formOnly = Object.keys(step).filter((k) => FORM_ONLY.includes(k));
  if (heads.length) {
    if (formOnly.length) return refused(at, `step '${name}' is written with the head key \`${heads[0]}\` and with \`${formOnly[0]}\`: write it with by: and do: alone`);
    if (typeof step.attended === "string") return refused(`${at}/attended`, `\`attended: ${step.attended}\` belongs to a step written with by:; ${/^[aeiou]/.test(heads[0] as string) ? "an" : "a"} ${heads[0]}: step takes attended: true`);
    return { step };
  }
  if (step.by === undefined) return formOnly.length ? refused(at, `step '${name}' names no actor: give it by: (an agent role, person, shell, or a step kind as <namespace>.<kind>)`) : { step };

  const errors: WorkflowError[] = [];
  for (const k of Object.keys(step))
    if (!KEYS.includes(k))
      errors.push({
        path: `${at}/${k}`,
        message: Object.hasOwn(WRITTEN_NOW, k)
          ? `step '${name}' is written with by:, so \`${k}\` ${WRITTEN_NOW[k]}`
          : `\`${k}\` is not a step key: a step is written with ${KEYS.join(", ")}, and a step kind's settings go under with:`,
      });
  if (errors.length) return { errors };

  const by = String(step.by);
  if (by === "person") return person(name, step, names);
  if (by === "shell") return shell(name, step);
  if (by.includes(".")) return stepKind(name, step, by, names);
  if (ROLES.includes(by)) return agent(name, step);
  const bare = Object.hasOwn(names.stepKinds, by) ? names.stepKinds[by] : undefined;
  const ns = bare && namespaceOf(bare);
  if (bare) return refused(`${at}/by`, ns ? `\`${by}\` is a step kind: name it \`${ns}.${by}\`` : `\`${by}\` is a step kind its host names no namespace for: write the step with the head key \`${by}:\``);
  return refused(`${at}/by`, `\`${by}\` is not an actor: name an agent role (${ROLES.join(", ")}), person, shell, or a step kind as <namespace>.<kind>`);
}

function agent(name: string, step: Obj): Lowered {
  const at = `/steps/${name}`;
  const errors = onlyKeys(name, step, "agent", ["by", "do", "with", "reads", "produces", "allow", "attended", "limits", "outcomes", "description"]);
  const out: Obj = pick(step, ["description", "outcomes", "produces"]);
  if (step.do === undefined) errors.push({ path: at, message: `step '${name}' says what to do with do:` });
  else out.agent = step.do;
  for (const [k, v] of Object.entries(isObj(step.with) ? step.with : {})) {
    if (k === "skills") out.skills = setting(`${at}/with/skills`, SkillsDoc, v, errors);
    else if (k === "executor" || k === "model") errors.push({ path: `${at}/with/${k}`, message: `\`${k}\` is not written: ${NO_EXECUTOR}` });
    else errors.push({ path: `${at}/with/${k}`, message: `\`${k}\` is not a setting of an agent step: with: holds skills` });
  }
  if (step.reads !== undefined) out.inputs = step.reads;
  if (Array.isArray(step.allow)) {
    step.allow.forEach((c, i) => {
      if (!CAPABILITIES.includes(String(c))) errors.push({ path: `${at}/allow/${i}`, message: `\`${String(c)}\` is not a capability a step may ask for: name ${CAPABILITIES.join(" or ")}` });
    });
    // asking for no code write narrows the agent to the story's documents
    if (!step.allow.includes("code:write")) out.writes = "docs";
  }
  if (step.attended === "person") out.attended = true;
  else if (step.attended !== undefined)
    errors.push({
      path: `${at}/attended`,
      message: typeof step.attended === "boolean" ? "attended: names who stays beside the agent: person" : "attended: takes person; agent and none come with supervised and unattended steps: leave attended out for a step nobody stays beside",
    });
  const limits = isObj(step.limits) ? step.limits : {};
  for (const [k, v] of Object.entries(limits)) {
    if (k === "deadline" || k === "nudges" || k === "retries") out[k] = v;
    else if (k === "timeout") errors.push({ path: `${at}/limits/timeout`, message: "an agent step is bounded by deadline, never timeout" });
    else if (k === "asks") errors.push({ path: `${at}/limits/asks`, message: "`asks` bounds a supervisor's answers, and no step has a supervisor yet" });
  }
  return errors.length ? { errors } : { step: out };
}

function shell(name: string, step: Obj): Lowered {
  const at = `/steps/${name}`;
  const errors = onlyKeys(name, step, "shell", ["by", "do", "with", "limits", "outcomes", "description"]);
  const out: Obj = pick(step, ["description", "outcomes"]);
  if (step.do === undefined) errors.push({ path: at, message: `step '${name}' says what to run with do:` });
  else out.check = step.do;
  for (const [k, v] of Object.entries(isObj(step.with) ? step.with : {})) {
    if (k === "exits") out.exits = setting(`${at}/with/exits`, ExitsDoc, v, errors);
    else errors.push({ path: `${at}/with/${k}`, message: `\`${k}\` is not a setting of a shell step: with: holds exits` });
  }
  const limits = isObj(step.limits) ? step.limits : {};
  for (const [k, v] of Object.entries(limits)) {
    if (k === "timeout") out.timeout = v;
    else errors.push({ path: `${at}/limits/${k}`, message: `\`${k}\` bounds an agent step: a shell step is bounded by timeout` });
  }
  if (limits.timeout === undefined) errors.push({ path: `${at}/limits`, message: "a shell step needs limits: { timeout }" });
  return errors.length ? { errors } : { step: out };
}

function person(name: string, step: Obj, names: SurfaceNames): Lowered {
  const at = `/steps/${name}`;
  const errors = onlyKeys(name, step, "person", ["by", "do", "outcomes", "on", "description"]);
  const out: Obj = pick(step, ["description", "outcomes"]);
  if (step.do === undefined) errors.push({ path: at, message: `step '${name}' says what the person decides with do:` });
  else out.gate = step.do;
  errors.push(...signalsUnderOutcomes(name, step, ["approve", "reject"], names));
  const on = lowerOn(name, step, names, errors);
  if (on) out.on = on;
  return errors.length ? { errors } : { step: out };
}

function stepKind(name: string, step: Obj, by: string, names: SurfaceNames): Lowered {
  const at = `/steps/${name}`;
  const dot = by.lastIndexOf(".");
  const ns = by.slice(0, dot);
  const bare = by.slice(dot + 1);
  if (ns === "norn") return bare === "each" ? each(name, step) : refused(`${at}/by`, `\`${by}\` is not a step kind of the core: the core's is norn.each`);
  const info = Object.hasOwn(names.stepKinds, bare) && !BUILTIN.includes(bare) ? names.stepKinds[bare] : undefined;
  if (!info) return { errors: [{ path: `${at}/by`, message: `\`${by}\` is not a step kind the kernel or a configured plugin provides: add the plugin that provides it`, missing_kind: bare }] };
  const real = namespaceOf(info);
  if (real !== ns) return refused(`${at}/by`, real ? `\`${by}\` is named \`${real}.${bare}\`` : `\`${bare}\` is a step kind its host names no namespace for: write the step with the head key \`${bare}:\``);

  const waits = info.mode === "wait";
  const errors = onlyKeys(name, step, by, ["by", "with", "outcomes", "description", ...(waits ? ["on"] : [])]);
  for (const e of errors) if (e.path === `${at}/on`) e.message = `\`on\` is only for a person step or a wait step, and step '${name}' is a ${by} step (an effect)`;
  const out: Obj = { [bare]: null, ...pick(step, ["description", "outcomes"]) };
  for (const [k, v] of Object.entries(isObj(step.with) ? step.with : {})) {
    // a setting named like a step key would be read as that key once lowered beside the head
    if (KEYWORDS.includes(k) || BUILTIN.includes(k) || Object.hasOwn(names.stepKinds, k)) errors.push({ path: `${at}/with/${k}`, message: `\`${k}\` is a step key, never a setting of ${by}` });
    else out[k] = v;
  }
  if (waits) {
    errors.push(...signalsUnderOutcomes(name, step, info.outcomes, names));
    const on = lowerOn(name, step, names, errors);
    if (on) out.on = on;
  }
  return errors.length ? { errors } : { step: out };
}

function each(name: string, step: Obj): Lowered {
  const at = `/steps/${name}`;
  const errors = onlyKeys(name, step, "norn.each", ["by", "reads", "outcomes", "description", "with"]);
  if (step.with !== undefined) errors.push({ path: `${at}/with`, message: "norn.each runs the config's slice_workflow and takes no with:" });
  const reads = step.reads;
  if (reads !== undefined && !(Array.isArray(reads) && reads.length === 1 && reads[0] === "slices"))
    errors.push({ path: `${at}/reads`, message: "norn.each reads the story's slices: write reads: [slices], or leave it out" });
  return errors.length ? { errors } : { step: { slices: null, ...pick(step, ["description", "outcomes"]) } };
}

/** The keys an actor takes; any other step key is refused at its path. */
function onlyKeys(name: string, step: Obj, actor: string, allowed: readonly string[]): WorkflowError[] {
  const article = /^[aeiou]/.test(actor) ? "an" : "a";
  return Object.keys(step)
    .filter((k) => !allowed.includes(k))
    .map((k) => ({ path: `/steps/${name}/${k}`, message: `\`${k}\` is not a key of ${article} ${actor} step` }));
}

/** A signal routed under `outcomes:` of a waiting step; the step form routes it under `on:`. */
function signalsUnderOutcomes(name: string, step: Obj, own: readonly string[], names: SurfaceNames): WorkflowError[] {
  const outcomes = isObj(step.outcomes) ? Object.keys(step.outcomes) : [];
  return outcomes
    .filter((o) => !own.includes(o) && (LEGACY_SIGNALS.includes(o) || Object.hasOwn(names.signals, o)))
    .map((o) => ({ path: `/steps/${name}/outcomes/${o}`, message: `\`${o}\` is a signal: route it under on: as \`${surfaceOf(names.signals[o]) ?? o}\`` }));
}

/** The `on:` block with each signal's surface name resolved to its bare one, in the order written. */
function lowerOn(name: string, step: Obj, names: SurfaceNames, errors: WorkflowError[]): Obj | undefined {
  if (!isObj(step.on)) return undefined;
  const bySurface = new Map(Object.values(names.signals).flatMap((d) => (surfaceOf(d) ? [[surfaceOf(d) as string, d.name] as const] : [])));
  const out: Obj = {};
  for (const [key, route] of Object.entries(step.on)) {
    const where = `/steps/${name}/on/${key}`;
    const bare = bySurface.get(key);
    if (bare !== undefined) out[bare] = route;
    else if (!key.includes(".") && Object.hasOwn(names.signals, key) && surfaceOf(names.signals[key]))
      errors.push({ path: where, message: `\`${key}\` is named \`${surfaceOf(names.signals[key])}\`` });
    else errors.push({ path: where, message: `\`${key}\` is not a signal the host or a configured plugin reports: add the plugin that provides it` });
  }
  return out;
}

const surfaceOf = (d: SignalDeclaration | undefined): string | undefined => (d?.namespace ? `${d.namespace}.${d.name}` : undefined);

/** A `with:` value checked by the schema of the pinned key it lowers to, since the pin is read back by that schema on every tick. */
function setting(path: string, schema: TSchema, value: unknown, errors: WorkflowError[]): unknown {
  const r = check(schema, value);
  if (!r.ok) errors.push(...r.errors.map((e) => ({ path: `${path}${e.path}`, message: e.message })));
  return value;
}

function pick(step: Obj, keys: readonly string[]): Obj {
  return Object.fromEntries(keys.filter((k) => step[k] !== undefined).map((k) => [k, step[k]]));
}

function refused(path: string, message: string): { errors: WorkflowError[] } {
  return { errors: [{ path, message }] };
}

/**
 * A refusal of the pinned `base:` said where a file that wrote `signals:` and `entries:` gave it, in its
 * words, so the author is pointed at a key the file has.
 */
export function inWorkflowKeys(e: WorkflowError): WorkflowError {
  if (e.path === "/base/step") return { ...e, path: "/entries/update-branch", message: e.message.replace("base.step", "entries.update-branch") };
  if (e.path === "/base/verify")
    return { ...e, path: "/signals/vcs.stale/verify", message: e.message.replace("base.verify", "vcs.stale's verify").replace("base.stale: behind", "when: behind").replace("a check step", "a shell step") };
  return e;
}

/** The settings a workflow file gives under `signals:` and `entries:`, as the pinned document's `base:`. */
export function lowerWorkflowKeys<D extends Obj>(doc: D): { doc: Omit<D, "signals" | "entries"> } | { errors: WorkflowError[] } {
  const { signals, entries, ...rest } = doc;
  if (signals === undefined && entries === undefined) return { doc: rest };
  if (rest.base !== undefined) return refused("/base", "base: is written as signals: and entries:, never beside them");
  const errors: WorkflowError[] = [];
  const base: Obj = {};
  for (const [key, settings] of Object.entries(isObj(signals) ? signals : {})) {
    if (key === "vcs.stale" && isObj(settings)) {
      if (settings.when !== undefined) base.stale = settings.when;
      if (settings.verify !== undefined) base.verify = settings.verify;
    } else if (key === "stale") errors.push({ path: "/signals/stale", message: "`stale` is named `vcs.stale`" });
    else errors.push({ path: `/signals/${key}`, message: "only vcs.stale takes settings here (when, verify)" });
  }
  for (const [key, step] of Object.entries(isObj(entries) ? entries : {})) {
    if (key === "update-branch") base.step = step;
    else errors.push({ path: `/entries/${key}`, message: `\`${key}\` is not an entry norn re-enters: name update-branch` });
  }
  if (errors.length) return { errors };
  return { doc: { ...rest, ...(Object.keys(base).length && { base }) } };
}
