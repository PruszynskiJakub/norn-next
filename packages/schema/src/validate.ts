import type { Static, TSchema } from "@sinclair/typebox";
import { Ajv, type ErrorObject, type ValidateFunction } from "ajv";
import addFormatsModule from "ajv-formats";
import { ClaimBlob, LeaseFile } from "./claim.ts";
import { CliError } from "./cli.ts";
import { ConfigLayer, ResolvedConfig } from "./config.ts";
import { SliceFrontmatter, StoryFrontmatter } from "./frontmatter.ts";
import { Receipt } from "./receipt.ts";
import { UnitState } from "./state.ts";
import { HookFact, TraceEvent } from "./trace.ts";
import { Workflow } from "./workflow.ts";

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
  config: ConfigLayer,
  "resolved-config": ResolvedConfig,
  "cli-error": CliError,
} as const;
export type SchemaName = keyof typeof SCHEMAS;
export type SchemaType<N extends SchemaName> = Static<(typeof SCHEMAS)[N]>;

export interface SchemaError {
  /** JSON pointer into the value, e.g. `/steps/test/timeout`; "" for the root */
  path: string;
  message: string;
}
export type ValidationResult<T> = { ok: true; value: T } | { ok: false; errors: SchemaError[] };

export class SchemaValidationError extends Error {
  constructor(
    readonly schema: string,
    readonly errors: SchemaError[],
  ) {
    super(`invalid ${schema}: ${errors.map((e) => `${e.path || "/"} ${e.message}`).join("; ")}`);
    this.name = "SchemaValidationError";
  }
}

const addFormats = addFormatsModule as unknown as (ajv: Ajv) => Ajv;
const ajv = addFormats(new Ajv({ allErrors: true, strict: true, strictTypes: false, discriminator: true }));
const compiled = new Map<TSchema, ValidateFunction>();

function compile(schema: TSchema): ValidateFunction {
  let fn = compiled.get(schema);
  if (!fn) {
    // strip $id so schemas embedded in several roots never collide in the registry
    const { $id: _id, ...rest } = schema as TSchema & { $id?: string };
    fn = ajv.compile(rest);
    compiled.set(schema, fn);
  }
  return fn;
}

function toErrors(errors: ErrorObject[] | null | undefined): SchemaError[] {
  const out: SchemaError[] = [];
  const seen = new Set<string>();
  for (const e of errors ?? []) {
    let message = e.message ?? "invalid";
    if (e.keyword === "additionalProperties") message = `unknown property '${e.params.additionalProperty}'`;
    else if (e.keyword === "enum" || e.keyword === "const")
      message = `must be ${JSON.stringify(e.params.allowedValues ?? e.params.allowedValue)}`;
    else if (e.keyword === "pattern") message = `must match ${e.params.pattern}`;
    const key = `${e.instancePath} ${message}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push({ path: e.instancePath, message });
    }
  }
  return out;
}

/** Validate any TypeBox schema (compiled once, cached). */
export function check<S extends TSchema>(schema: S, value: unknown): ValidationResult<Static<S>> {
  const fn = compile(schema);
  return fn(value) ? { ok: true, value: value as Static<S> } : { ok: false, errors: toErrors(fn.errors) };
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

export const validateWorkflow = (v: unknown) => validate("workflow", v);
export const validateStoryFrontmatter = (v: unknown) => validate("story", v);
export const validateSliceFrontmatter = (v: unknown) => validate("slice", v);
export const validateState = (v: unknown) => validate("state", v);
export const validateReceipt = (v: unknown) => validate("receipt", v);
export const validateTraceEvent = (v: unknown) => validate("trace", v);
export const validateHookFact = (v: unknown) => validate("hook", v);
export const validateClaim = (v: unknown) => validate("claim", v);
export const validateLease = (v: unknown) => validate("lease", v);
export const validateConfigLayer = (v: unknown) => validate("config", v);
export const validateCliError = (v: unknown) => validate("cli-error", v);

/** Plain JSON Schema object (TypeBox symbols dropped) for publishing. */
export function toJsonSchema(name: SchemaName): Record<string, unknown> {
  return {
    $schema: "http://json-schema.org/draft-07/schema#",
    ...(JSON.parse(JSON.stringify(SCHEMAS[name])) as Record<string, unknown>),
  };
}
