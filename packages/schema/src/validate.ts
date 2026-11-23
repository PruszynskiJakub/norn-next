import type { Static } from "@sinclair/typebox";
import { check, type SchemaError, type ValidationResult } from "./check.ts";
import { SkillList, WorkflowList, WorkflowShow } from "./catalog.ts";
import { CheckOrder, ClaimBlob, LeaseFile } from "./claim.ts";
import { CliError } from "./cli.ts";
import { CriteriaReport } from "./criteria.ts";
import { SliceFrontmatter, StoryFrontmatter } from "./frontmatter.ts";
import { Receipt } from "./receipt.ts";
import { UnitState, UnitStateRecord } from "./state.ts";
import { Workflow, WorkflowShared, WorkflowSource } from "./workflow.ts";

export { check, type SchemaError, type ValidationResult } from "./check.ts";

/** Every schema `validate` checks against, by short name; those in `PUBLISHED_SCHEMAS` are emitted as `json/<name>.schema.json`. */
export const SCHEMAS = {
  // the loaded, flat workflow core reads; a person writes `workflow-source`, so it is not published
  workflow: Workflow,
  // a workflow file as written, and a shared file it brings in with `use:`; both flatten to `workflow`
  "workflow-source": WorkflowSource,
  "workflow-shared": WorkflowShared,
  story: StoryFrontmatter,
  slice: SliceFrontmatter,
  state: UnitState,
  // state.json as read and written: older shapes included, normalised by core normalizeUnitState
  "state-record": UnitStateRecord,
  receipt: Receipt,
  claim: ClaimBlob,
  lease: LeaseFile,
  "check-order": CheckOrder,
  "cli-error": CliError,
  "criteria-report": CriteriaReport,
  // what the catalog commands print with --json
  "workflow-list": WorkflowList,
  "workflow-show": WorkflowShow,
  "skill-list": SkillList,
} as const;
export type SchemaName = keyof typeof SCHEMAS;

/** The schemas emitted for editors and other tools: every one but the loaded workflow model. */
export const PUBLISHED_SCHEMAS = (Object.keys(SCHEMAS) as SchemaName[]).filter((n) => n !== "workflow");
export type SchemaType<N extends SchemaName> = Static<(typeof SCHEMAS)[N]>;

export class SchemaValidationError extends Error {
  constructor(
    readonly schema: string,
    readonly errors: SchemaError[],
  ) {
    super(`invalid ${schema}: ${errors.map((e) => `${e.path || "/"} ${e.message}`).join("; ")}`);
    this.name = "SchemaValidationError";
  }
}

/** Validate against a published schema by name. */
export function validate<N extends SchemaName>(name: N, value: unknown): ValidationResult<SchemaType<N>> {
  return check(SCHEMAS[name], value) as ValidationResult<SchemaType<N>>;
}

/** Validate or throw `SchemaValidationError`. */
export function assertValid<N extends SchemaName>(name: N, value: unknown): SchemaType<N> {
  const r = validate(name, value);
  if (!r.ok) throw new SchemaValidationError(name, r.errors);
  return r.value;
}

/** Plain JSON Schema object (TypeBox symbols dropped) for publishing. */
export function toJsonSchema(name: SchemaName): Record<string, unknown> {
  return {
    $schema: "http://json-schema.org/draft-07/schema#",
    ...(JSON.parse(JSON.stringify(SCHEMAS[name])) as Record<string, unknown>),
  };
}
