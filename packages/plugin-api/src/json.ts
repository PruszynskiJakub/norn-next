import { check } from "@norn/schema";
import type { Static, TSchema } from "@sinclair/typebox";
import { fail, ok, type PluginResult } from "./result.ts";

/**
 * Parse JSON a plugin got from outside (a CLI's stdout, a file it keeps) and validate it against
 * `schema`. The one place a plugin turns text into data: an unchecked shape from a provider is how a
 * half-understood answer becomes a wrong fact. `what` names the source in the failure message.
 */
export function parseJson<S extends TSchema>(schema: S, text: string, what: string): PluginResult<Static<S>> {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (e) {
    return fail("invalid", `${what}: not JSON (${e instanceof Error ? e.message : String(e)})`, false);
  }
  const r = check(schema, value);
  if (!r.ok) return fail("invalid", `${what}: ${r.errors.map((e) => `${e.path || "/"} ${e.message}`).join("; ")}`, false);
  return ok(r.value);
}
