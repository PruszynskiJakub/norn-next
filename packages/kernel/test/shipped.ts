/**
 * The shipped workflows as the kernel loads them: the files in packages/cli/assets/workflows with the
 * mechanical edits they need, and the plugin step kinds they use as the plugins providing them declare
 * them. Shared by the loader's tests and the golden corpus, so both load the same documents.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type TSchema, Type } from "@sinclair/typebox";
import { parse } from "yaml";
import { DEFAULT_KERNEL_CONFIG, type LoadedWorkflow, loadWorkflow, type StepKindInfo } from "../src/index.ts";

const ROOT = join(import.meta.dir, "..", "..", "..");
export const SHIPPED = join(ROOT, "packages", "cli", "assets", "workflows");

export const kind = (name: string, outcomes: string[], mode: "effect" | "wait" = "effect", configSchema: TSchema = Type.Object({}, { additionalProperties: false })): StepKindInfo => ({
  name,
  configSchema,
  outcomes,
  mode,
});

/** The step kinds the shipped workflows use, as the plugins that provide them declare them. */
export const STEP_KINDS: Record<string, StepKindInfo> = {
  "update-branch": kind("update-branch", ["done", "conflict", "clean", "resolved"]),
  integrate: kind("integrate", ["done", "conflict"]),
  "open-pr": kind("open-pr", ["done"]),
  push: kind("push", ["done"]),
  "await-merge": kind("await-merge", ["merged", "stale"], "wait"),
};

/**
 * The mechanical edits the shipped workflows need, and nothing else. The old engine let a fixed-outcome
 * step leave outcomes unrouted (the light path's `clean`/`resolved` were taken as `done`; the PR merging
 * ended the round with no route; a story waiting at ready or merge with commits its PR lacked went back
 * to the open-pr step with no route); the kernel routes every outcome a step can end with, so each edit
 * routes one where the old engine took it implicitly, to the same place.
 */
export const MECHANICAL_EDITS: ReadonlyArray<{ file: string; step: string; routes: Record<string, unknown> }> = [
  { file: "shared/sync.yaml", step: "sync", routes: { clean: { exit: "synced" }, resolved: { exit: "synced" } } },
  { file: "refinement.yaml", step: "sync", routes: { clean: "refine", resolved: "refine" } },
  { file: "shared/ship.yaml", step: "ready", routes: { unpushed: "open-pr" } },
  { file: "shared/ship.yaml", step: "merge", routes: { merged: "$done", unpushed: "open-pr" } },
];

export const readShipped = (file: string): Record<string, unknown> => parse(readFileSync(join(SHIPPED, file), "utf8"));

/** Every shipped workflow file by file name, and the shared files by name, with or without the edits. */
export function shipped(edited: boolean): { workflows: Record<string, unknown>; shared: Record<string, unknown> } {
  const apply = (file: string, doc: Record<string, unknown>) => {
    if (!edited) return doc;
    for (const e of MECHANICAL_EDITS.filter((m) => m.file === file)) {
      const step = (doc.steps as Record<string, Record<string, unknown>>)[e.step] as Record<string, unknown>;
      step.outcomes = { ...(step.outcomes as object), ...e.routes };
    }
    return doc;
  };
  const shared = Object.fromEntries(
    readdirSync(join(SHIPPED, "shared"))
      .filter((f) => f.endsWith(".yaml"))
      .map((f) => [f.replace(/\.yaml$/, ""), apply(`shared/${f}`, readShipped(`shared/${f}`))]),
  );
  const workflows = Object.fromEntries(
    readdirSync(SHIPPED)
      .filter((f) => f.endsWith(".yaml"))
      .map((f) => [f, apply(f, readShipped(f))]),
  );
  return { workflows, shared };
}

/** A shipped workflow (`story`, `quick`, ...) loaded with the edits, under the default config. */
export function loadShipped(name: string): LoadedWorkflow {
  const { workflows, shared } = shipped(true);
  const r = loadWorkflow(workflows[`${name}.yaml`], { stepKinds: STEP_KINDS, sharedFiles: shared, config: DEFAULT_KERNEL_CONFIG });
  if (!r.ok) throw new Error(`${name}: ${JSON.stringify(r.errors)}`);
  return r.workflow;
}
