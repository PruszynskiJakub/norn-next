/**
 * The kernel's golden corpus: `test/golden/<name>.json`, each a whole decide input (facts, the
 * workflow documents the host loaded, the step kinds its plugins declared, the config) and the
 * decisions decide must make from it, exactly. Every case is self-contained, so replaying it needs no
 * file outside it, and a case still replays after the workflow files it came from change.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  type Decision,
  decide,
  type KernelConfig,
  type KernelFacts,
  type KernelWorkflows,
  type LoadedWorkflow,
  loadWorkflow,
  type StepKindInfo,
  validateDecision,
  validateKernelConfig,
  validateKernelFacts,
  type WorkflowLoad,
} from "../src/index.ts";

export const GOLDEN_DIR = join(import.meta.dir, "golden");

/** A step kind as a case records it: what the loader reads of it, its config schema as JSON Schema. */
export type GoldenStepKind = Pick<StepKindInfo, "outcomes" | "mode"> & { configSchema: Record<string, unknown> };

export interface GoldenWorkflows {
  /** each workflow file by name, as the host parsed it now (a new round or an intake takes it); may fail to load */
  files: Record<string, unknown>;
  /** pinned documents of earlier versions some unit still runs, loaded by hash only */
  pinned: unknown[];
}

export interface GoldenCase {
  name: string;
  /** the scenario the case comes from, and what it pins */
  description: string;
  step_kinds: Record<string, GoldenStepKind>;
  workflows: GoldenWorkflows;
  config: KernelConfig;
  facts: KernelFacts;
  decisions: Decision[];
}

function stepKinds(c: Pick<GoldenCase, "step_kinds">): Record<string, StepKindInfo> {
  return Object.fromEntries(Object.entries(c.step_kinds).map(([name, k]) => [name, { name, outcomes: [...k.outcomes], mode: k.mode, configSchema: structuredClone(k.configSchema) } as StepKindInfo]));
}

/** The workflows decide sees for a case: every file loaded by name, every loaded file and pinned document by hash. */
export function caseWorkflows(c: Pick<GoldenCase, "step_kinds" | "workflows" | "config">): KernelWorkflows {
  const opts = { stepKinds: stepKinds(c), sharedFiles: {}, config: c.config };
  const byName: Record<string, WorkflowLoad> = {};
  const byHash: Record<string, LoadedWorkflow> = {};
  for (const [name, doc] of Object.entries(c.workflows.files)) {
    const load = loadWorkflow(structuredClone(doc), opts);
    byName[name] = load;
    if (load.ok) byHash[load.workflow.pinned.hash] = load.workflow;
  }
  for (const doc of c.workflows.pinned) {
    const load = loadWorkflow(structuredClone(doc), opts);
    if (!load.ok) throw new Error(`a pinned document fails to load: ${JSON.stringify(load.errors)}`);
    byHash[load.workflow.pinned.hash] = load.workflow;
  }
  return { byName, byHash };
}

/**
 * Decide a case again. Its facts and config must validate first, as the host validates them before
 * decide runs, and every decision must validate against the Decision schema.
 */
export function decideGolden(c: Omit<GoldenCase, "decisions" | "name" | "description">): Decision[] {
  const facts = validateKernelFacts(structuredClone(c.facts));
  if (!facts.ok) throw new Error(`facts fail validation: ${JSON.stringify(facts.errors)}`);
  const config = validateKernelConfig(structuredClone(c.config));
  if (!config.ok) throw new Error(`config fails validation: ${JSON.stringify(config.errors)}`);
  const out = decide(facts.value, caseWorkflows(c), config.value);
  for (const d of out) {
    const v = validateDecision(d);
    if (!v.ok) throw new Error(`decision ${d.rule} fails validation: ${JSON.stringify(v.errors)}`);
  }
  return out;
}

export function readCases(dir: string = GOLDEN_DIR): GoldenCase[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")) as GoldenCase);
}

/** The text a case is written as: two-space JSON and a final newline, so a regenerated case diffs line by line. */
export function caseText(c: GoldenCase): string {
  return `${JSON.stringify(c, null, 2)}\n`;
}
