/**
 * Writing the counters core derives from each route back into the workflow text a unit pins, so
 * every reader of counters (advance, park, brief, rerun, view) sees them through the pin alone.
 */
import { deriveEdgeCounters } from "@norn/core";
import type { SchemaError } from "@norn/schema";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { FLAT_YAML, sharedFile } from "./shared-workflow.ts";
import { stepWordingErrors, toModelSteps } from "./step-wording.ts";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * The flat workflow text `source` with its derived counters written in: `null` when it derives
 * nothing (it is pinned as is), else the text to pin. `included` names the shared file of an
 * included step, so a refusal says which file to fix. A text that does not parse, or a step in no
 * known wording, derives nothing here: the parse that follows reports it.
 */
export function withDerivedCounters(source: string, included: Record<string, string> = {}): { ok: true; source: string | null } | { ok: false; errors: SchemaError[] } {
  let doc: unknown;
  try {
    doc = parseYaml(source);
  } catch {
    return { ok: true, source: null };
  }
  // A counters: that is no map is left for the schema to refuse: merging into it would drop it.
  if (!isObj(doc) || !isObj(doc.steps) || stepWordingErrors(doc.steps).length || (doc.counters !== undefined && !isObj(doc.counters)))
    return { ok: true, source: null };
  const derived = deriveEdgeCounters({ ...doc, steps: toModelSteps(doc.steps) });
  if (derived.errors.length)
    return {
      ok: false,
      errors: derived.errors.map((e) => {
        const from = included[e.path.split("/")[2] ?? ""];
        return from && e.path.startsWith("/steps/") ? { ...e, message: `${sharedFile(from)}: ${e.message}` } : e;
      }),
    };
  if (!Object.keys(derived.edges).length) return { ok: true, source: null };
  // Each step and its outcomes are copied before the write-back: a YAML alias makes steps share
  // one parsed object, and writing into it would hand one step another step's counter.
  const steps: Obj = { ...doc.steps };
  for (const [edge, counter] of Object.entries(derived.edges)) {
    const [step, outcome] = edge.split(".") as [string, string];
    const s = steps[step] as Obj;
    const routes = s.outcomes as Obj;
    const route = routes[outcome];
    const { max: _max, ...rest } = isObj(route) ? route : { to: route };
    steps[step] = { ...s, outcomes: { ...routes, [outcome]: { ...rest, counter } } };
  }
  const flat: Obj = { ...doc, steps, counters: { ...(doc.counters as Obj | undefined), ...derived.counters } };
  return { ok: true, source: stringifyYaml(flat, FLAT_YAML) };
}
