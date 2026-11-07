import type { Static } from "@sinclair/typebox";
import { check, type SchemaError, type ValidationResult } from "./check.ts";
import { CheckOrder, ClaimBlob, LeaseFile } from "./claim.ts";
import { CliError } from "./cli.ts";
import { CriteriaReport } from "./criteria.ts";
import { LocalConfig, RepoConfig, ResolvedConfig, UserConfig } from "./config.ts";
import { SliceFrontmatter, StoryFrontmatter } from "./frontmatter.ts";
import {
  LocalBaseFile,
  LocalCheckoutFile,
  LocalCockpitFile,
  LocalFailuresFile,
  LocalForeignFile,
  LocalHeartbeatFile,
  LocalHookBackfillFile,
  LocalInboxFile,
  LocalLockFile,
  LocalNoticesFile,
  LocalRejectedFile,
  LocalSupersededFile,
  LocalNotifiedFile,
  LocalIssueFile,
  LocalPrFile,
  LocalRecordsFile,
  LocalRemoteFile,
} from "./local.ts";
import { Receipt } from "./receipt.ts";
import { UnitState } from "./state.ts";
import { HookFact, TraceEvent } from "./trace.ts";
import { Workflow } from "./workflow.ts";

export { check, type SchemaError, type ValidationResult } from "./check.ts";

/** Every published schema, by short name. JSON files are emitted as `json/<name>.schema.json`. */
export const SCHEMAS = {
  workflow: Workflow,
  story: StoryFrontmatter,
  slice: SliceFrontmatter,
  state: UnitState,
  receipt: Receipt,
  trace: TraceEvent,
  hook: HookFact,
  claim: ClaimBlob,
  lease: LeaseFile,
  "check-order": CheckOrder,
  "user-config": UserConfig,
  "local-config": LocalConfig,
  "repo-config": RepoConfig,
  "resolved-config": ResolvedConfig,
  "cli-error": CliError,
  "criteria-report": CriteriaReport,
  // machine-local files of one checkout (its machine dir), read through store readLocalJson
  "local-remote": LocalRemoteFile,
  "local-notified": LocalNotifiedFile,
  "local-records": LocalRecordsFile,
  "local-foreign": LocalForeignFile,
  "local-inbox": LocalInboxFile,
  "local-heartbeat": LocalHeartbeatFile,
  "local-failures": LocalFailuresFile,
  "local-base": LocalBaseFile,
  "local-pr": LocalPrFile,
  "local-issue": LocalIssueFile,
  "local-cockpit": LocalCockpitFile,
  "local-lock": LocalLockFile,
  "local-hook-backfill": LocalHookBackfillFile,
  "local-notices": LocalNoticesFile,
  "local-rejected": LocalRejectedFile,
  "local-superseded": LocalSupersededFile,
  "local-checkout": LocalCheckoutFile,
} as const;
export type SchemaName = keyof typeof SCHEMAS;
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
