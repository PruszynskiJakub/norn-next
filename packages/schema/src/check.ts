/**
 * The ajv engine behind every schema check: compiled once per schema, errors as JSON pointers.
 * Imports no schema, so a schema module may check against its own schemas (config.ts, D2).
 */
import type { Static, TSchema } from "@sinclair/typebox";
import { Ajv, type ErrorObject, type ValidateFunction } from "ajv";
import addFormatsModule from "ajv-formats";

export interface SchemaError {
  /** JSON pointer into the value, e.g. `/steps/test/timeout`; "" for the root */
  path: string;
  message: string;
}
export type ValidationResult<T> = { ok: true; value: T } | { ok: false; errors: SchemaError[] };

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
