/**
 * What a pack and a repo offer, as a newcomer picks from them. Two readers share it:
 *
 * - `packCatalog`, for the generated reference: each pack workflow with when to pick it, its label, its
 *   start step and the skills each step uses, and each skill with when it applies. Loaded through the
 *   kernel's loader with the plugins' step kinds, so a step a shared file brings in is listed like one
 *   the workflow writes itself. Pure: the caller passes the pack and plugins.
 * - `readCatalog`, for the catalog commands: the workflows a repo can start (the pack's, the repo's laid
 *   over them, the ones held for the person) and the skills its agents can use. Read only, through the
 *   runtime env a tick builds, so a workflow lists as it would run. Outside a norn repo (no checkout, or
 *   no config yet) the bundled default pack is read alone, so a newcomer can look before `norn init`.
 */
import { DEFAULT_KERNEL_CONFIG, type LoadedWorkflow, loadProblem, type WorkflowLoad } from "@norn/kernel";
import type { NornPlugin, Pack } from "@norn/plugin-api";
import { collectSignals, collectStepKinds, type HeldWorkflow, loadPackWorkflows, NO_REPO_WORKFLOWS, REPO_WORKFLOWS_DIR, type RepoWorkflows, repoFileOf, signalDeclarations, workflowNameOf } from "@norn/runtime";
import type { SkillListEntry, WorkflowListEntry, WorkflowShow } from "@norn/schema";
import { parse } from "yaml";
import { CONFIG_DEFAULTS } from "./config/schema.ts";
import type { CliContext } from "./context.ts";
import { CliFailure, failure, refuse } from "./output.ts";
import { BUNDLED_PLUGINS } from "./plugins/bundled.ts";
import { lookupSkills } from "./skill-lookup.ts";

export interface CatalogStep {
  name: string;
  /** `agent (<role>)`, `check`, `gate`, `slices` or a plugin step kind's name */
  kind: string;
  skills: string[];
}

export interface CatalogWorkflow {
  name: string;
  /** when to pick it and what it does */
  description: string;
  start: string;
  /** the intake label that starts it; null for the workflow a story's `slices` step runs on each slice */
  label: string | null;
  steps: CatalogStep[];
}

export interface CatalogSkill {
  name: string;
  /** the description's "Use when" or "Use for" clause, to its end */
  useWhen: string;
  /** `disable-model-invocation`: only a person runs it, never a workflow step */
  personOnly: boolean;
}

export interface Catalog {
  workflows: CatalogWorkflow[];
  skills: CatalogSkill[];
}

const oneLine = (s: unknown): string => (typeof s === "string" ? s.trim().replace(/\s+/g, " ") : "");

function frontmatter(skillMd: string): Record<string, unknown> {
  const m = skillMd.match(/^---\n([\s\S]*?)\n---\n/);
  const fm = m ? (parse(m[1] as string) as unknown) : null;
  return fm !== null && typeof fm === "object" ? (fm as Record<string, unknown>) : {};
}

function catalogSkill(name: string, files: Readonly<Record<string, string>>): CatalogSkill {
  const fm = frontmatter(files["SKILL.md"] ?? "");
  const description = oneLine(fm.description);
  const at = description.search(/\bUse (when|for)\b/);
  return { name, useWhen: at < 0 ? description : description.slice(at), personOnly: fm["disable-model-invocation"] === true };
}

/** The pack's workflows and skills, each sorted by name. A workflow that does not load is listed without its steps. */
export function packCatalog(pack: Pack, plugins: readonly NornPlugin[]): Catalog {
  const kinds = collectStepKinds(plugins);
  const signals = collectSignals(plugins);
  const loads = kinds.ok && signals.ok ? loadPackWorkflows(pack, kinds.value, DEFAULT_KERNEL_CONFIG, signalDeclarations(signals.value)) : null;
  const byName = loads?.ok ? loads.value : {};
  const workflows = Object.entries(pack.workflows).map(([file, text]): CatalogWorkflow => {
    const doc = (parse(text) ?? {}) as Record<string, unknown>;
    const name = typeof doc.name === "string" ? doc.name : file.replace(/\.ya?ml$/, "");
    const load = byName[file.replace(/\.ya?ml$/, "")];
    const steps = load?.ok
      ? Object.values(load.workflow.graph.steps).map((s) => ({ name: s.name, kind: s.agent?.role ? `agent (${s.agent.role})` : s.kind, skills: [...(s.agent?.skills ?? [])] }))
      : [];
    return {
      name,
      description: oneLine(doc.description),
      // a `start:` naming a shared group is entered at the group's first step, which the steps list
      start: load?.ok ? load.workflow.graph.start : typeof doc.start === "string" ? doc.start : "",
      label: name === DEFAULT_KERNEL_CONFIG.sliceWorkflow ? null : `${DEFAULT_KERNEL_CONFIG.intakeWorkflowLabelPrefix}${name}`,
      steps,
    };
  });
  const skills = Object.entries(pack.skills).map(([name, files]) => catalogSkill(name, files));
  const byKey = <T extends { name: string }>(a: T, b: T) => a.name.localeCompare(b.name);
  return { workflows: workflows.sort(byKey), skills: skills.sort(byKey) };
}

/** The refusals that mean "not a norn repo": no checkout, or a checkout with no config at all. */
const NOT_A_NORN_REPO = new Set(["not_a_repo", "config_missing"]);

/** What the line under every catalog view says outside a norn repo. */
export const PACK_ALONE = "Not in a norn repo: the pack alone, no repo overrides were read.";

export interface RepoCatalog {
  /** the checkout read, or null for the pack alone */
  repo: string | null;
  pack: Pack;
  workflows: Readonly<Record<string, WorkflowLoad>>;
  repoWorkflows: RepoWorkflows;
  held: Readonly<Record<string, HeldWorkflow>>;
  skills(): Promise<SkillListEntry[]>;
}

/** The bundled default pack, its workflows loaded with the bundled step kinds and signals. */
function packAlone(): RepoCatalog {
  const name = CONFIG_DEFAULTS.packs?.[0] ?? "sdlc";
  const pack = BUNDLED_PLUGINS.flatMap((p) => p.provides.packs?.[name] ?? [])[0];
  const kinds = collectStepKinds(BUNDLED_PLUGINS);
  const signals = collectSignals(BUNDLED_PLUGINS);
  if (!pack || !kinds.ok || !signals.ok) throw failure(`the bundled pack ${name} does not load`, "reinstall norn", "pack_missing");
  const loads = loadPackWorkflows(pack, kinds.value, DEFAULT_KERNEL_CONFIG, signalDeclarations(signals.value));
  if (!loads.ok) throw failure(`the bundled pack ${name} does not load: ${loads.failure.message}`, "reinstall norn", loads.failure.code);
  return { repo: null, pack, workflows: loads.value, repoWorkflows: NO_REPO_WORKFLOWS, held: {}, skills: () => lookupSkills(pack.skills, null) };
}

export async function readCatalog(ctx: CliContext): Promise<RepoCatalog> {
  try {
    const env = await ctx.runtimeEnv();
    const pack = env.slots.pack;
    const repo = { files: env.ctx.files, root: env.ctx.repo.root, harnesses: Object.values(env.slots.executors) };
    return { repo: env.ctx.repo.root, pack, workflows: env.workflows, repoWorkflows: env.repoWorkflows, held: env.held, skills: () => lookupSkills(pack.skills, repo) };
  } catch (e) {
    if (e instanceof CliFailure && NOT_A_NORN_REPO.has(e.body.code ?? "")) return packAlone();
    throw e;
  }
}

/** The `description:` a workflow file says, read off its text, so a held or invalid file still shows one. */
function said(text: string | undefined): { description: string | null } {
  let doc: unknown;
  try {
    doc = text === undefined ? null : parse(text);
  } catch {
    doc = null;
  }
  const field = (k: string): string | null => {
    const v = (doc as Record<string, unknown> | null)?.[k];
    return typeof v === "string" && v.trim() ? v.trim().replace(/\s+/g, " ") : null;
  };
  return { description: field("description") };
}

const fileText = (files: Readonly<Record<string, string>>, name: string): string | undefined => Object.entries(files).find(([f]) => workflowNameOf(f) === name)?.[1];

/** A name a person typed, looked up as a key of its own: `constructor` or `__proto__` names no workflow. */
const own = <T>(record: Readonly<Record<string, T>>, name: string): T | undefined => (Object.hasOwn(record, name) ? record[name] : undefined);

/** One workflow as the list shows it. */
export function workflowEntry(c: RepoCatalog, name: string): WorkflowListEntry {
  const file = repoFileOf(c.repoWorkflows, name, "workflow");
  const packText = fileText(c.pack.workflows, name);
  const source = file === null ? "pack" : packText === undefined ? "repo" : "replaces-pack";
  const entry: WorkflowListEntry = { name, ...said(file === null ? packText : fileText(c.repoWorkflows.workflows, name)), source, state: "ok", file };
  const held = own(c.held, name);
  if (held) return { ...entry, state: "held", changes: held.changes, confirm: `norn workflow confirm ${name}` };
  const load = own(c.workflows, name);
  if (load?.ok) return entry;
  return { ...entry, state: "invalid", problem: loadProblem(name, load) ?? `workflow ${name} does not load` };
}

export function workflowEntries(c: RepoCatalog): WorkflowListEntry[] {
  return [...new Set([...Object.keys(c.workflows), ...Object.keys(c.held)])].sort().map((n) => workflowEntry(c, n));
}

/**
 * The workflow `workflow show` reads: a held one's repo file as it would run once confirmed. A name no
 * file holds is refused with the ones that load; one that does not load, with why.
 */
export function shownWorkflow(c: RepoCatalog, name: string): { entry: WorkflowListEntry; workflow: LoadedWorkflow } {
  const load = own(c.workflows, name);
  const held = own(c.held, name);
  if (!load && !held) {
    const loading = workflowEntries(c).flatMap((w) => (w.state === "ok" ? [w.name] : []));
    throw refuse(`no workflow ${name}`, `name one of ${loading.join(", ")}${c.repo === null ? "" : `, or write ${REPO_WORKFLOWS_DIR}/${name}.yaml`}`, "unknown_workflow");
  }
  const entry = workflowEntry(c, name);
  if (held) return { entry, workflow: held.current };
  if (load?.ok) return { entry, workflow: load.workflow };
  throw refuse(entry.problem ?? `workflow ${name} does not load`, `fix ${entry.file ?? `the workflow ${name}`}, then norn doctor`, "invalid_workflow");
}

/** The JSON `workflow show` prints. */
export function workflowShow(c: RepoCatalog, entry: WorkflowListEntry, workflow: LoadedWorkflow): WorkflowShow {
  const { graph } = workflow;
  const steps = Object.values(graph.steps).map((s) => ({
    name: s.name,
    kind: s.kind,
    role: s.agent?.role ?? null,
    skills: s.agent?.skills ?? [],
    outcomes: Object.entries(s.routes).map(([outcome, r]) => ({ outcome, to: r.to, counter: r.counter ?? null })),
  }));
  const counters = Object.entries(graph.counters).map(([name, k]) => ({ name, max: k.max, reset_on: k.reset_on }));
  return { repo: c.repo, ...entry, hash: graph.hash, start: graph.start, steps, counters, gates: steps.filter((s) => s.kind === "gate").map((s) => s.name) };
}
