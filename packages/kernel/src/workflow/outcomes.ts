/**
 * Lowering outcome objects to the flat step a unit pins. A file may say everything about an outcome
 * on the outcome (`fail: { to: implement, verdict: fail, produces: [criteria, findings] }`) and give the
 * step a `produces:` list every outcome takes unless it lists its own; the pinned document keeps the
 * older shape (`means:`, `verdict:`, `hand_back:`, `criteria:`, `produces: {name: {file, on}}`), so a
 * pin's hash, and every unit and golden case pinned before, never depends on which spelling a file used.
 */
import type { WorkflowError } from "./graph.ts";
import { OVERRIDABLE_OUTCOMES } from "./graph.ts";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

const OVERRIDABLE: readonly string[] = OVERRIDABLE_OUTCOMES;
const FIELDS = ["means", "verdict", "produces"] as const;
/** What norn takes with a report itself; never a file of the spec folder. */
const REPORTS: readonly string[] = ["findings", "evidence", "criteria"];

type Entry = string | { name: string; file: string };
const nameOf = (e: Entry): string => (typeof e === "string" ? e : e.name);

/**
 * The step with its outcome objects lowered, or why they cannot be. A step that writes none of
 * `means`, `verdict` or `produces` on an outcome, and no `produces:` list, comes back as it was but
 * for its routes. `shared` says whether an outcome may leave by `exit:`.
 */
export function lowerOutcomes(name: string, step: Obj, shared: boolean): { step: Obj } | { errors: WorkflowError[] } {
  const at = `/steps/${name}`;
  const outcomes = isObj(step.outcomes) ? step.outcomes : {};
  const errors: WorkflowError[] = [];
  const routes: Obj = {};
  for (const [o, v] of Object.entries(outcomes)) {
    if (!isObj(v)) {
      routes[o] = v;
      continue;
    }
    const where = `${at}/outcomes/${o}`;
    if (v.to !== undefined && v.exit !== undefined) errors.push({ path: where, message: `outcome '${o}' of step '${name}' goes \`to:\` a step or leaves by \`exit:\`, not both` });
    else if (v.to === undefined && v.exit === undefined) errors.push({ path: where, message: `outcome '${o}' of step '${name}' names no target: give it \`to:\`${shared ? " or `exit:`" : ""}` });
    else if (v.exit !== undefined && (v.counter !== undefined || v.max !== undefined))
      errors.push({ path: where, message: `outcome '${o}' of step '${name}' leaves by \`exit:\`: its bound is set on the use step's route for the exit` });
    const route: Obj = {};
    for (const k of ["to", "exit", "counter", "max"]) if (v[k] !== undefined) route[k] = v[k];
    routes[o] = Object.keys(route).length === 1 && typeof route.to === "string" ? route.to : route;
  }

  const described = (f: (typeof FIELDS)[number]) => Object.entries(outcomes).filter((e): e is [string, Obj] => isObj(e[1]) && e[1][f] !== undefined);
  const listed = Array.isArray(step.produces);
  if (!FIELDS.some((f) => described(f).length) && !listed) return errors.length ? { errors } : { step: Object.keys(outcomes).length ? { ...step, outcomes: routes } : step };

  if (!("agent" in step)) {
    for (const [o, v] of Object.entries(outcomes))
      if (isObj(v)) for (const f of FIELDS) if (v[f] !== undefined) errors.push({ path: `${at}/outcomes/${o}/${f}`, message: `\`${f}\` describes an outcome an agent reports, and step '${name}' is not an agent step` });
    if (listed) errors.push({ path: `${at}/produces`, message: `\`produces\` lists what an agent step's outcomes produce, and step '${name}' is not an agent step` });
    return { errors };
  }

  // a verdict is read from a criteria report, so an outcome object's verdict lists it too, unless the step keeps the older report keys
  const olderReports = step.criteria !== undefined || step.hand_back !== undefined || isObj(step.produces);
  const newReports = listed || described("produces").length > 0 || (described("verdict").length > 0 && !olderReports);
  const moveOnto = (f: string) => `step '${name}' writes ${f} on its outcomes: move these onto the outcomes too (\`${Object.keys(outcomes)[0] ?? "done"}: { to: …, ${f}: … }\`)`;
  if (described("means").length && step.means !== undefined) errors.push({ path: `${at}/means`, message: moveOnto("means") });
  if (described("verdict").length && step.verdict !== undefined) errors.push({ path: `${at}/verdict`, message: moveOnto("verdict") });
  if (newReports) {
    const lists = `step '${name}' lists what its outcomes produce:`;
    if (step.criteria !== undefined) errors.push({ path: `${at}/criteria`, message: `${lists} a criteria report is listed there too (\`produces: [criteria]\`)` });
    if (step.hand_back !== undefined) errors.push({ path: `${at}/hand_back`, message: `${lists} findings or evidence handed back are listed there too (\`produces: [findings]\`)` });
    if (isObj(step.produces)) {
      const files = Object.entries(step.produces).map(([n, p]) => `{ name: ${n}, file: ${isObj(p) ? String(p.file) : "<path>"} }`);
      errors.push({ path: `${at}/produces`, message: `${lists} list the step's files too (\`produces: [${files.join(", ")}]\`)` });
    }
  }
  for (const [o, v] of Object.entries(outcomes))
    if (isObj(v) && OVERRIDABLE.includes(o))
      for (const f of FIELDS) if (v[f] !== undefined) errors.push({ path: `${at}/outcomes/${o}/${f}`, message: `'${o}' is a route the kernel takes, never one an agent reports: it has no ${f}` });
  if (errors.length) return { errors };

  const reportable = Object.keys(outcomes).filter((o) => !OVERRIDABLE.includes(o) && o !== "exhausted");
  const field = (o: string, f: string): unknown => (isObj(outcomes[o]) ? (outcomes[o] as Obj)[f] : undefined);
  const out: Obj = { ...step, outcomes: routes };
  const means = Object.fromEntries(reportable.flatMap((o) => (field(o, "means") === undefined ? [] : [[o, field(o, "means")]])));
  const verdict = Object.fromEntries(reportable.flatMap((o) => (field(o, "verdict") === undefined ? [] : [[o, field(o, "verdict")]])));
  if (Object.keys(means).length) out.means = means;
  if (Object.keys(verdict).length) out.verdict = verdict;
  if (!newReports) return { step: out };

  // every entry with where it is written: the step's list first, then each outcome's, in file order
  const stepList = (listed ? step.produces : []) as Entry[];
  const written: Array<{ entry: Entry; path: string; outcome?: string }> = [
    ...stepList.map((entry, i) => ({ entry, path: `${at}/produces/${i}` })),
    ...Object.keys(outcomes).flatMap((o) => ((field(o, "produces") ?? []) as Entry[]).map((entry, i) => ({ entry, path: `${at}/outcomes/${o}/produces/${i}`, outcome: o }))),
  ];
  const files = new Map<string, { file: string; path: string }>();
  for (const { entry, path } of written) if (typeof entry !== "string" && !REPORTS.includes(entry.name) && !files.has(entry.name)) files.set(entry.name, { file: entry.file, path });
  for (const { entry, path } of written) {
    if (typeof entry === "string") {
      if (!REPORTS.includes(entry) && !files.has(entry)) errors.push({ path, message: `\`${entry}\` names no file: declare it once in the step as \`{ name: ${entry}, file: <path> }\`` });
    } else if (REPORTS.includes(entry.name)) errors.push({ path, message: `\`${entry.name}\` is a report norn takes with the outcome, never a file: write it as the bare name` });
    else {
      const first = files.get(entry.name) as { file: string };
      if (first.file !== entry.file) errors.push({ path: `${path}/file`, message: `\`${entry.name}\` is declared as ${first.file} and as ${entry.file} in step '${name}': a produced name names one file` });
    }
  }
  if (errors.length) return { errors };

  const listAt = (o: string) => (field(o, "produces") !== undefined ? `${at}/outcomes/${o}/produces` : `${at}/produces`);
  const due = new Map(reportable.map((o) => [o, new Set(((field(o, "produces") ?? stepList) as Entry[]).map(nameOf))]));
  const has = (o: string, n: string) => due.get(o)?.has(n) === true;
  const everywhere = reportable.length > 0 && reportable.every((o) => has(o, "criteria"));
  const handBack: Obj = {};
  for (const o of reportable) {
    const v = field(o, "verdict");
    if (v !== undefined && !has(o, "criteria"))
      errors.push({ path: `${at}/outcomes/${o}/verdict`, message: `outcome '${o}' is gated by verdict '${String(v)}', which is read from a criteria report: add criteria to what it produces` });
    if (has(o, "criteria") && !everywhere && v === undefined)
      errors.push({ path: listAt(o), message: `outcome '${o}' produces criteria but has no verdict: give it one, or produce criteria on every outcome step '${name}' reports` });
    // the pinned step holds one hand-back per outcome
    if (has(o, "findings") && has(o, "evidence")) errors.push({ path: listAt(o), message: `outcome '${o}' hands back findings or evidence, not both` });
    else if (has(o, "findings")) handBack[o] = "findings";
    else if (has(o, "evidence")) handBack[o] = "evidence";
  }
  // the pinned form's default: every outcome reported but one that hands findings back
  const fallback = reportable.filter((o) => handBack[o] !== "findings");
  const produces: Obj = {};
  for (const [n, { file, path }] of files) {
    const on = reportable.filter((o) => has(o, n));
    if (!on.length) errors.push({ path, message: `\`${n}\` is due on no outcome step '${name}' reports: name it in the list of an outcome that writes it` });
    produces[n] = on.length === fallback.length && on.every((o, i) => fallback[i] === o) ? { file } : { file, on };
  }
  if (errors.length) return { errors };

  delete out.produces;
  if (Object.keys(produces).length) out.produces = produces;
  if (Object.keys(handBack).length) out.hand_back = handBack;
  if (everywhere) out.criteria = "required";
  return { step: out };
}
