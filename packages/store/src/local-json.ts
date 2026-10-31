/**
 * Validated reads of machine-local files (S2, BUG-4): the caches and bookkeeping norn keeps in the
 * checkout's machine dir (B5). A missing file reads as `fallback`; an unreadable one, invalid JSON, or a
 * value of the wrong shape (`@norn/schema` local-* schemas) also reads as `fallback`, never as a
 * cast of whatever was there, and leaves a `local_file` trace event naming the file. The next
 * write replaces the file, so a bad cache heals itself.
 */
import { type LocalSchemaName, type SchemaError, type SchemaType, validate } from "@norn/schema";
import { readText } from "./fsx.ts";
import { appendTrace, traceEvent } from "./trace.ts";

export type LocalParse<N extends LocalSchemaName> =
  | { ok: true; value: SchemaType<N> }
  | { ok: false; reason: "invalid_json" | "wrong_shape"; errors: SchemaError[] };

/** Parse and validate the raw text of a machine-local file. */
export function parseLocalJson<N extends LocalSchemaName>(name: N, raw: string): LocalParse<N> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return { ok: false, reason: "invalid_json", errors: [{ path: "", message: `invalid JSON: ${(e as Error).message}` }] };
  }
  const r = validate(name, parsed);
  return r.ok ? { ok: true, value: r.value } : { ok: false, reason: "wrong_shape", errors: r.errors };
}

/** Bad file contents already traced by this process (path + raw), so repeated reads trace once. */
const traced = new Set<string>();

function traceBad(root: string, path: string, name: LocalSchemaName, reason: "unreadable" | "invalid_json" | "wrong_shape", errors: SchemaError[], raw: string): void {
  const key = `${path}\0${raw}`;
  if (traced.has(key)) return;
  traced.add(key);
  try {
    appendTrace(root, traceEvent("local_file", Date.now(), { file: path, schema: name, reason, errors }));
  } catch {
    // diagnostic only: a read never fails because its trace line could not be written
  }
}

/**
 * Read a machine-local JSON file of schema `name` at `path`. Missing, unreadable or of the wrong
 * shape → `fallback`; with `root` given, the latter two leave a `local_file` trace event.
 */
export function readLocalJson<N extends LocalSchemaName>(name: N, path: string, fallback: SchemaType<N>, root?: string): SchemaType<N> {
  let raw: string | null;
  try {
    raw = readText(path);
  } catch (e) {
    if (root) traceBad(root, path, name, "unreadable", [{ path: "", message: (e as Error).message }], "");
    return fallback;
  }
  if (raw === null) return fallback;
  const r = parseLocalJson(name, raw);
  if (r.ok) return r.value;
  if (root) traceBad(root, path, name, r.reason, r.errors, raw);
  return fallback;
}
