/**
 * A step as the new wording writes it (one head key, `skills:`, `by:`, `outcomes:` with sibling
 * `means:` / `verdict:` maps) checked and turned into the loaded model, the `type`-tagged union core
 * reads. The checks run before the model's schema, so a person reads what is wrong in the words they
 * wrote, never the union's noise.
 */
import type { SchemaError } from "@norn/schema";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/** Head key → the model's `type` (and `action`), and the model key that holds the head's value. */
const HEADS: Record<string, { type: string; action?: string; content?: string }> = {
  agent: { type: "agent", content: "instructions" },
  check: { type: "check", content: "run" },
  gate: { type: "gate", content: "prompt" },
  "update-branch": { type: "git", action: "update" },
  "open-pr": { type: "git", action: "open-pr" },
  integrate: { type: "git", action: "integrate" },
  push: { type: "git", action: "push" },
  "await-merge": { type: "merge" },
  slices: { type: "slices" },
};
export const HEAD_KEYS = Object.keys(HEADS);

// Route overrides an agent never reports with `norn done`: they need no meaning
const OVERRIDABLE = new Set(["silent", "died", "timeout", "stalled", "ask", "stuck"]);
const PROSE = ["means", "verdict"] as const;

const headsOf = (step: Obj) => HEAD_KEYS.filter((k) => Object.hasOwn(step, k));

/**
 * What is wrong with each step of a flat file (no `use` or `like` left) in the words it is written in.
 * `use` steps are skipped: their own check runs where they are flattened.
 */
export function stepWordingErrors(steps: Obj): SchemaError[] {
  const out: SchemaError[] = [];
  for (const [name, step] of Object.entries(steps)) {
    if (!isObj(step) || "use" in step) continue;
    const at = `/steps/${name}`;
    const heads = headsOf(step);
    if (heads.length === 0) {
      out.push({ path: at, message: `a step opens with one head key: ${HEAD_KEYS.map((k) => `\`${k}\``).join(", ")}, or \`use\`` });
      continue;
    }
    if (heads.length > 1) {
      out.push({ path: at, message: `a step has one head key, this one has ${heads.length}: ${heads.map((k) => `\`${k}\``).join(", ")}` });
      continue;
    }
    const head = heads[0] as string;
    const value = step[head];
    if (HEADS[head]?.content === undefined) {
      if (value !== null) out.push({ path: `${at}/${head}`, message: `\`${head}:\` takes no value` });
    } else if (typeof value !== "string" || value.trim() === "") {
      const what = head === "agent" ? "an orientation: what the step is for" : head === "check" ? "the command to run" : "what the person decides";
      out.push({ path: `${at}/${head}`, message: `\`${head}:\` needs ${what}` });
    }
    if (Array.isArray(step.skills)) {
      const seen = new Set<unknown>();
      for (const s of step.skills) {
        if (seen.has(s)) out.push({ path: `${at}/skills`, message: `names the skill \`${String(s)}\` twice` });
        seen.add(s);
      }
    }
    out.push(...proseErrors(at, head, step));
  }
  return out;
}

function proseErrors(at: string, head: string, step: Obj): SchemaError[] {
  const out: SchemaError[] = [];
  const routes = isObj(step.outcomes) ? step.outcomes : {};
  for (const key of PROSE) {
    if (!(key in step)) continue;
    if (head !== "agent") {
      out.push({ path: `${at}/${key}`, message: `only an agent step has \`${key}:\`` });
      continue;
    }
    const map = step[key];
    // The model has no place for a scalar here, so the schema never sees it: refuse it before it is dropped.
    if (!isObj(map)) {
      out.push({ path: `${at}/${key}`, message: `\`${key}:\` is a map from outcome to ${key === "means" ? "meaning" : "verdict"}` });
      continue;
    }
    for (const o of Object.keys(map))
      if (!Object.hasOwn(routes, o)) out.push({ path: `${at}/${key}/${o}`, message: `\`${o}\` is not an outcome this step routes` });
  }
  if (head === "agent") {
    const means = isObj(step.means) ? step.means : {};
    for (const o of Object.keys(routes))
      if (!OVERRIDABLE.has(o) && !Object.hasOwn(means, o))
        out.push({ path: `${at}/outcomes/${o}`, message: `the agent may report \`${o}\`: say what it means in \`means:\`` });
  }
  return out;
}

/** Each step in the model's form; call after `stepWordingErrors` found nothing. */
export function toModelSteps(steps: Obj): Obj {
  const out: Obj = {};
  for (const [name, step] of Object.entries(steps)) out[name] = isObj(step) && !("use" in step) ? toModelStep(step) : step;
  return out;
}

function toModelStep(step: Obj): Obj {
  const head = headsOf(step)[0];
  const spec = head === undefined ? undefined : HEADS[head];
  if (head === undefined || spec === undefined) return step;
  const out: Obj = { type: spec.type };
  for (const [k, v] of Object.entries(step)) {
    if (k === head) {
      if (spec.content) out[spec.content] = v;
      if (spec.action) out.action = spec.action;
    } else if (k === "by") out.agent = v;
    else if (k === "means" || k === "verdict") continue;
    else if (k === "outcomes" && isObj(v)) out.outcomes = withProse(v, step.means, step.verdict);
    else out[k] = v;
  }
  return out;
}

/** Each route carrying its meaning and verdict, as the model's edges do. */
function withProse(routes: Obj, means: unknown, verdict: unknown): Obj {
  const m = isObj(means) ? means : {};
  const v = isObj(verdict) ? verdict : {};
  const out: Obj = {};
  for (const [o, r] of Object.entries(routes)) {
    if (m[o] === undefined && v[o] === undefined) {
      out[o] = r;
      continue;
    }
    const edge: Obj = typeof r === "string" ? { to: r } : isObj(r) ? { ...r } : { to: r };
    if (m[o] !== undefined) edge.means = m[o];
    if (v[o] !== undefined) edge.verdict = v[o];
    out[o] = edge;
  }
  return out;
}
