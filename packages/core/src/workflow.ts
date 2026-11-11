/** Workflow load-time validation and per-unit level checks. */
import {
  type CheckStep,
  type CounterSpec,
  type OutcomeEdge,
  outcomeEdge,
  RESERVED_STEP_NAMES,
  type Step,
  validate,
  type Workflow,
} from "@norn/schema";
import { cmd } from "./commands.ts";
import { LIGHT_OUTCOMES } from "./update-outcome.ts";

export type WorkflowIssueCode =
  | "schema"
  | "reserved_name"
  | "reserved_outcome"
  | "unknown_start"
  | "unknown_target"
  | "unknown_counter"
  | "unknown_reset"
  | "unknown_skill"
  | "unknown_outcome"
  | "cannot_reach_done"
  | "uncounted_cycle"
  | "open_pr_bypass"
  | "base_verify"
  | "verdict"
  | "level";

export interface WorkflowIssue {
  code: WorkflowIssueCode;
  /** JSON pointer into the workflow, e.g. `/steps/review/outcomes/changes_requested` */
  path: string;
  message: string;
  /** uncounted_cycle: the steps of the cycle, in order (back to the first) */
  cycle?: string[];
}

export type WorkflowCheck = { ok: true; workflow: Workflow; issues: [] } | { ok: false; workflow: Workflow | null; issues: WorkflowIssue[] };

export interface ValidateOptions {
  /** known skill names; omitted = skill existence not checked */
  skills?: Iterable<string>;
  /**
   * Skills each configured agent can see (its installed skill folder). A step's skill must be
   * visible to the agent that runs it (`step.agent ?? agent`); an agent not listed is not checked.
   */
  agentSkills?: { agent: string; visible: Readonly<Record<string, Iterable<string>>> };
}

/** Outcomes an agent step may declare to override a classified route. `exhausted` always goes to `$stuck`. */
export const OVERRIDABLE_ROUTES = ["silent", "died", "timeout", "stalled", "ask", "stuck"] as const;

/** What a check ends in without `exits`: exit 0 passes, anything else fails. */
const CHECK_OUTCOMES = ["pass", "fail"] as const;

/**
 * The outcome of a check run: `pass` on exit 0, the outcome `exits` names for its exit code, else
 * `fail`. A timeout has no exit code, so it always fails.
 */
export function checkOutcome(exits: CheckStep["exits"], res: { exit_code: number | null; timed_out: boolean }): string {
  if (res.timed_out || res.exit_code === null) return "fail";
  if (res.exit_code === 0) return "pass";
  return exits?.[String(res.exit_code)] ?? "fail";
}

const isReservedStep = (name: string) => name.startsWith("$") || (RESERVED_STEP_NAMES as readonly string[]).includes(name);

export interface Edge extends OutcomeEdge {
  from: string;
  outcome: string;
}

/** Every declared outcome edge of a workflow, normalized. */
export function edgesOf(wf: Workflow): Edge[] {
  return Object.entries(wf.steps).flatMap(([from, step]) =>
    Object.entries(step.outcomes as Record<string, Parameters<typeof outcomeEdge>[0] | undefined>).flatMap(([outcome, spec]) =>
      spec === undefined ? [] : [{ from, outcome, ...outcomeEdge(spec) }],
    ),
  );
}

export function edgeOf(wf: Workflow, step: string, outcome: string): OutcomeEdge | null {
  const spec = (wf.steps[step]?.outcomes as Record<string, Parameters<typeof outcomeEdge>[0] | undefined> | undefined)?.[outcome];
  return spec === undefined ? null : outcomeEdge(spec);
}

/** The edges `<step>.<outcome>` a counter's `reset_on` names, one or a list. */
export const resetEdges = (c: CounterSpec): string[] => (c.reset_on === undefined ? [] : Array.isArray(c.reset_on) ? c.reset_on : [c.reset_on]);

export function stepOf(wf: Workflow, name: string): Step | null {
  return Object.hasOwn(wf.steps, name) ? (wf.steps[name] as Step) : null;
}

/**
 * Validate a parsed workflow document: schema, reserved names, targets, counters,
 * skills, reachability of `$done`, and every elementary cycle has a counted edge.
 */
export function validateWorkflowDefinition(input: unknown, opts: ValidateOptions = {}): WorkflowCheck {
  const issues: WorkflowIssue[] = [];
  const rawSteps = (input as { steps?: unknown } | null)?.steps;
  if (rawSteps && typeof rawSteps === "object")
    for (const name of Object.keys(rawSteps))
      if (isReservedStep(name))
        issues.push({ code: "reserved_name", path: `/steps/${name}`, message: `step name '${name}' is reserved` });

  issues.push(...mergeOutcomeIssues(rawSteps));
  const schema = validate("workflow", input);
  if (!schema.ok) {
    const reservedPaths = new Set(issues.map((i) => i.path));
    for (const e of schema.errors)
      if (![...reservedPaths].some((p) => e.path.startsWith(p)))
        issues.push({ code: "schema", path: e.path, message: e.message });
    return { ok: false, workflow: null, issues };
  }
  const wf = schema.value;
  issues.push(...graphIssues(wf, opts));
  return issues.length ? { ok: false, workflow: wf, issues } : { ok: true, workflow: wf, issues: [] };
}

/**
 * A merge step's one outcome is `stale`: the schema alone would report another as a failed match
 * of every step type, so it is named here with the reason.
 */
function mergeOutcomeIssues(rawSteps: unknown): WorkflowIssue[] {
  if (!rawSteps || typeof rawSteps !== "object") return [];
  const issues: WorkflowIssue[] = [];
  for (const [name, step] of Object.entries(rawSteps as Record<string, unknown>)) {
    const s = step as { type?: unknown; outcomes?: unknown } | null;
    if (s?.type !== "merge" || !s.outcomes || typeof s.outcomes !== "object") continue;
    for (const o of Object.keys(s.outcomes))
      if (o !== "stale")
        issues.push({ code: "unknown_outcome", path: `/steps/${name}/outcomes/${o}`, message: `a merge step has only the outcome 'stale'; '${o}' cannot be declared (the PR merging ends the wait)` });
  }
  return issues;
}

/**
 * `base.verify` runs a check step on the merged tree; under `stale: behind` every base move already
 * sends the story through update, so a verify would never run and only look like it does.
 */
function baseVerifyIssues(wf: Workflow): WorkflowIssue[] {
  const name = wf.base?.verify;
  if (name === undefined) return [];
  const path = "/base/verify";
  if (wf.base?.stale === "behind")
    return [{ code: "base_verify", path, message: "base.verify cannot be set with base.stale: behind (any base move already updates the story, so nothing would be verified)" }];
  const step = stepOf(wf, name);
  if (!step) return [{ code: "unknown_target", path, message: `base.verify '${name}' does not exist` }];
  if (step.type !== "check") return [{ code: "base_verify", path, message: `base.verify '${name}' is a ${step.type} step; it must name a check step, whose command norn runs on the merged tree` }];
  return [];
}

function graphIssues(wf: Workflow, opts: ValidateOptions): WorkflowIssue[] {
  const issues: WorkflowIssue[] = [];
  const steps = Object.keys(wf.steps);
  const counters = wf.counters ?? {};
  const skills = opts.skills ? new Set(opts.skills) : null;
  const visible = opts.agentSkills
    ? new Map(Object.entries(opts.agentSkills.visible).map(([agent, names]) => [agent, new Set(names)]))
    : null;

  if (!stepOf(wf, wf.start)) issues.push({ code: "unknown_start", path: "/start", message: `start step '${wf.start}' does not exist` });

  for (const [name, step] of Object.entries(wf.steps)) {
    if (step.type === "agent") {
      if (skills && !skills.has(step.skill))
        issues.push({ code: "unknown_skill", path: `/steps/${name}/skill`, message: `skill '${step.skill}' is not installed` });
      const agent = step.agent ?? opts.agentSkills?.agent;
      const seen = agent === undefined ? undefined : visible?.get(agent);
      if (seen && !seen.has(step.skill))
        issues.push({
          code: "unknown_skill",
          path: `/steps/${name}/skill`,
          message: `skill '${step.skill}' is not installed for agent '${agent}' (run ${cmd.init()}, or add it to that agent's skill folder)`,
        });
      if ("exhausted" in step.outcomes)
        issues.push({
          code: "reserved_outcome",
          path: `/steps/${name}/outcomes/exhausted`,
          message: "'exhausted' always routes to $stuck and cannot be declared",
        });
    }
  }
  for (const [name, step] of Object.entries(wf.steps)) {
    if (step.type !== "git" || step.action === "update") continue;
    for (const outcome of LIGHT_OUTCOMES)
      if (Object.hasOwn(step.outcomes, outcome))
        issues.push({ code: "unknown_outcome", path: `/steps/${name}/outcomes/${outcome}`, message: `'${outcome}' is an outcome of a base update only (action: update), not of action: ${step.action}` });
  }
  for (const [name, step] of Object.entries(wf.steps)) {
    if (step.type !== "check") continue;
    const named = new Set(Object.values(step.exits ?? {}));
    for (const [code, outcome] of Object.entries(step.exits ?? {})) {
      const path = `/steps/${name}/exits/${code}`;
      if ((CHECK_OUTCOMES as readonly string[]).includes(outcome) || outcome === "exhausted")
        issues.push({ code: "reserved_outcome", path, message: `exit ${code} names '${outcome}', which a check reaches without exits` });
      else if (!Object.hasOwn(step.outcomes, outcome))
        issues.push({ code: "unknown_outcome", path, message: `exit ${code} names outcome '${outcome}', but ${name} declares no route for it in outcomes` });
    }
    for (const outcome of Object.keys(step.outcomes))
      if (!(CHECK_OUTCOMES as readonly string[]).includes(outcome) && !named.has(outcome))
        issues.push({
          code: "unknown_outcome",
          path: `/steps/${name}/outcomes/${outcome}`,
          message: `check outcome '${outcome}' is neither pass, fail nor named by an exit code in exits`,
        });
  }
  // `reset_on` names a declared edge `<step>.<outcome>`
  for (const [name, c] of Object.entries(counters))
    resetEdges(c).forEach((edge, i) => {
      const [from, outcome] = edge.split(".") as [string, string];
      if (!edgeOf(wf, from, outcome))
        issues.push({
          code: "unknown_reset",
          path: `/counters/${name}/reset_on${Array.isArray(c.reset_on) ? `/${i}` : ""}`,
          message: `counter '${name}' resets on '${edge}', but step '${from}' declares no outcome '${outcome}'`,
        });
    });
  // `base.step` names the step `norn story update-branch` re-enters
  if (wf.base?.step !== undefined && !stepOf(wf, wf.base.step))
    issues.push({ code: "unknown_target", path: "/base/step", message: `base.step '${wf.base.step}' does not exist` });
  issues.push(...baseVerifyIssues(wf));
  for (const e of edgesOf(wf)) {
    const path = `/steps/${e.from}/outcomes/${e.outcome}`;
    if (!e.to.startsWith("$") && !stepOf(wf, e.to))
      issues.push({ code: "unknown_target", path, message: `${e.from}.${e.outcome} → unknown step '${e.to}'` });
    if (e.counter && !Object.hasOwn(counters, e.counter))
      issues.push({ code: "unknown_counter", path, message: `counter '${e.counter}' is not declared in counters` });
    // A verdict gates what an agent reports with `norn done`; elsewhere nothing could check it
    if (e.verdict !== undefined && (wf.steps[e.from]?.type !== "agent" || (OVERRIDABLE_ROUTES as readonly string[]).includes(e.outcome)))
      issues.push({ code: "verdict", path, message: `${e.from}.${e.outcome} declares verdict '${e.verdict}', but only outcomes an agent reports with norn done can be gated by a verdict` });
  }

  // every step can reach $done: reverse search from $done; a merge step ends the round when its PR merges
  const reach = new Set<string>(["$done", ...steps.filter((s) => wf.steps[s]?.type === "merge")]);
  const edges = edgesOf(wf);
  for (let grew = true; grew; ) {
    grew = false;
    for (const e of edges)
      if (reach.has(e.to) && !reach.has(e.from)) {
        reach.add(e.from);
        grew = true;
      }
  }
  for (const s of steps)
    if (!reach.has(s)) issues.push({ code: "cannot_reach_done", path: `/steps/${s}`, message: `step '${s}' cannot reach $done` });

  issues.push(...openPrBypassIssues(wf));

  // A cycle is uncounted iff it is a cycle of the subgraph of uncounted edges
  const uncounted = new Map<string, Map<string, string>>();
  for (const e of edges) {
    if (e.counter || e.to.startsWith("$") || !stepOf(wf, e.to)) continue;
    const m = uncounted.get(e.from) ?? new Map<string, string>();
    if (!m.has(e.to) || e.outcome < (m.get(e.to) as string)) m.set(e.to, e.outcome);
    uncounted.set(e.from, m);
  }
  const adj = new Map([...uncounted].map(([k, m]) => [k, [...m.keys()].sort()]));
  for (const cycle of elementaryCycles(steps, adj)) {
    const hops = cycle.map((s, i) => `${s}.${uncounted.get(s)?.get(cycle[(i + 1) % cycle.length] as string)}`);
    issues.push({
      code: "uncounted_cycle",
      path: `/steps/${cycle[0]}`,
      message: `cycle without a counter: ${hops.join(" → ")} → ${cycle[0]}`,
      cycle,
    });
  }
  return issues;
}

const isOpenPr = (step: Step | null | undefined) => step?.type === "git" && step.action === "open-pr";
/** A step that can change the story branch's code: an agent's commits, or a base merge. */
const changesCode = (step: Step | null | undefined) => step?.type === "agent" || (step?.type === "git" && step.action === "update");

/** The workflow's `git: open-pr` step (the first one); null = none. */
export function openPrStep(wf: Workflow): string | null {
  return Object.entries(wf.steps).find(([, s]) => isOpenPr(s as Step))?.[0] ?? null;
}

/**
 * Gates and merge steps the round can end from without passing `open-pr` again: every merge step,
 * and each gate with a path to a merge step or `$done` that avoids `open-pr`. Past one of them the
 * PR head is what a person merges, so it must be the commit `ci` checked.
 */
export function mergeBoundSteps(wf: Workflow): Set<string> {
  const ends = new Set<string>(["$done", ...Object.keys(wf.steps).filter((s) => wf.steps[s]?.type === "merge")]);
  const edges = edgesOf(wf);
  for (let grew = true; grew; ) {
    grew = false;
    for (const e of edges)
      if (ends.has(e.to) && !ends.has(e.from) && !isOpenPr(stepOf(wf, e.from))) {
        ends.add(e.from);
        grew = true;
      }
  }
  return new Set([...ends].filter((s) => ["gate", "merge"].includes(stepOf(wf, s)?.type ?? "")));
}

/**
 * A path from `open-pr` that reaches a merge-bound step through an agent step or `git: update`
 * without passing `open-pr` again would let a person merge a head CI never ran on.
 */
function openPrBypassIssues(wf: Workflow): WorkflowIssue[] {
  const bound = mergeBoundSteps(wf);
  const next = new Map<string, string[]>();
  for (const e of edgesOf(wf)) if (stepOf(wf, e.to)) next.set(e.from, [...(next.get(e.from) ?? []), e.to]);
  const found = new Map<string, string[]>();
  for (const [start, step] of Object.entries(wf.steps)) {
    if (!isOpenPr(step as Step)) continue;
    // Breadth-first over (step, changed since open-pr): the first path found is a shortest one
    type Node = { step: string; changed: boolean; path: string[] };
    const seen = new Set<string>();
    const queue: Node[] = (next.get(start) ?? []).map((s) => ({ step: s, changed: false, path: [start, s] }));
    while (queue.length) {
      const n = queue.shift() as Node;
      const key = `${n.step}:${n.changed}`;
      const step = stepOf(wf, n.step);
      if (seen.has(key) || isOpenPr(step)) continue;
      seen.add(key);
      if (n.changed && bound.has(n.step) && !found.has(n.step)) found.set(n.step, n.path);
      const changed = n.changed || changesCode(step);
      for (const s of next.get(n.step) ?? []) queue.push({ step: s, changed, path: [...n.path, s] });
    }
  }
  return [...found].map(([step, path]) => ({
    code: "open_pr_bypass",
    path: `/steps/${step}`,
    message: `${path.join(" → ")}: a change reaches ${step} without going through open-pr again, so the PR head a person merges would not be the commit CI checked`,
  }));
}

/**
 * All elementary cycles of a directed graph (Johnson's algorithm). Each cycle is listed
 * once, starting at its lowest-ordered node (order of `nodes`); self-loops are cycles of length 1.
 */
export function elementaryCycles(nodes: readonly string[], adj: ReadonlyMap<string, readonly string[]>): string[][] {
  const index = new Map(nodes.map((n, i) => [n, i]));
  const cycles: string[][] = [];
  for (let s = 0; s < nodes.length; s++) {
    const start = nodes[s] as string;
    const next = (v: string) => (adj.get(v) ?? []).filter((w) => (index.get(w) ?? -1) >= s);
    const blocked = new Set<string>();
    const blockMap = new Map<string, Set<string>>();
    const stack: string[] = [];
    const unblock = (u: string) => {
      blocked.delete(u);
      for (const w of blockMap.get(u) ?? []) if (blocked.has(w)) unblock(w);
      blockMap.delete(u);
    };
    const circuit = (v: string): boolean => {
      let found = false;
      stack.push(v);
      blocked.add(v);
      for (const w of next(v)) {
        if (w === start) {
          cycles.push([...stack]);
          found = true;
        } else if (!blocked.has(w) && circuit(w)) found = true;
      }
      if (found) unblock(v);
      else for (const w of next(v)) (blockMap.get(w) ?? blockMap.set(w, new Set()).get(w))?.add(v);
      stack.pop();
      return found;
    };
    circuit(start);
  }
  return cycles;
}

export type UnitLevel = "story" | "slice";

/** `slices`, `git: open-pr` and `git: update` only on a story; `git: integrate` only on a slice. Checked at unit start. */
export function checkWorkflowLevel(wf: Workflow, level: UnitLevel): WorkflowIssue[] {
  const issues: WorkflowIssue[] = [];
  for (const [name, step] of Object.entries(wf.steps)) {
    const what = step.type === "git" ? `git: ${step.action}` : step.type;
    const storyOnly = step.type === "slices" || (step.type === "git" && (step.action === "open-pr" || step.action === "update"));
    const sliceOnly = step.type === "git" && step.action === "integrate";
    if ((storyOnly && level !== "story") || (sliceOnly && level !== "slice"))
      issues.push({
        code: "level",
        path: `/steps/${name}`,
        message: `step '${name}' (${what}) runs only on a ${storyOnly ? "story" : "slice"}, not on a ${level}`,
      });
  }
  return issues;
}

/** The step `norn story update-branch` re-enters — `base.step`, else the first step with `action: update`; null = none. */
export function baseUpdateStep(wf: Workflow): string | null {
  if (wf.base?.step) return stepOf(wf, wf.base.step) ? wf.base.step : null;
  return Object.entries(wf.steps).find(([, s]) => s.type === "git" && s.action === "update")?.[0] ?? null;
}

/**
 * Is the story stale against its base under this workflow? `conflict` (default): a merge of
 * the base would conflict; `behind`: the base has any commit the story lacks.
 */
export function isStale(wf: Workflow | null, base: { behind: number; conflicts: readonly string[] } | undefined): boolean {
  if (!base) return false;
  return (wf?.base?.stale ?? "conflict") === "behind" ? base.behind > 0 : base.conflicts.length > 0;
}

/** Outcomes an agent can report with `norn done` (declared, minus route overrides). */
export function reportableOutcomes(step: Step): string[] {
  if (step.type !== "agent") return [];
  return Object.keys(step.outcomes).filter((o) => !(OVERRIDABLE_ROUTES as readonly string[]).includes(o));
}
