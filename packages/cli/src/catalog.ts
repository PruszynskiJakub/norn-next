/**
 * What a pack offers, as a newcomer picks from it: each workflow with when to pick it, its label, its
 * start step and the skills each step uses, and each skill with when it applies. Read from the pack's
 * files and loaded through the kernel's loader with the plugins' step kinds, so a step a shared file
 * brings in is listed like one the workflow writes itself. Pure: the caller passes the pack and plugins.
 */
import { DEFAULT_KERNEL_CONFIG } from "@norn/kernel";
import type { NornPlugin, Pack } from "@norn/plugin-api";
import { collectSignals, collectStepKinds, loadPackWorkflows, signalDeclarations } from "@norn/runtime";
import { parse } from "yaml";

export interface CatalogStep {
  name: string;
  /** `agent (<role>)`, `check`, `gate`, `slices` or a plugin step kind's name */
  kind: string;
  skills: string[];
}

export interface CatalogWorkflow {
  name: string;
  when: string;
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
      when: oneLine(doc.when),
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
