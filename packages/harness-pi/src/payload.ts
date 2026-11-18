/** Readers for the payload norn's pi extension sends: every field is optional and untyped until checked. */
export type JsonObject = Record<string, unknown>;

export const isObject = (v: unknown): v is JsonObject => typeof v === "object" && v !== null && !Array.isArray(v);

/** A non-empty string field, else undefined. */
export function str(o: unknown, key: string): string | undefined {
  const v = isObject(o) ? o[key] : undefined;
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

export function obj(o: unknown, key: string): JsonObject | undefined {
  const v = isObject(o) ? o[key] : undefined;
  return isObject(v) ? v : undefined;
}

export function bool(o: unknown, key: string): boolean | undefined {
  const v = isObject(o) ? o[key] : undefined;
  return typeof v === "boolean" ? v : undefined;
}

/**
 * A short id derived from the payload alone (FNV-1a), for events that carry no id of their own:
 * the same dialog seen twice gets the same id, so a reducer never counts it twice.
 */
export function stableId(prefix: string, ...parts: Array<string | undefined>): string {
  let h = 0x811c9dc5;
  for (const ch of parts.map((p) => p ?? "").join("\u0000")) {
    h ^= ch.codePointAt(0) as number;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${prefix}-${h.toString(16).padStart(8, "0")}`;
}

/** One line naming what a tool call acts on: the command, else the path or pattern, else compact JSON. */
export function summarize(input: JsonObject | undefined): string | undefined {
  if (!input) return undefined;
  for (const k of ["command", "path", "pattern", "url", "query"]) {
    const v = input[k];
    if (typeof v === "string" && v.length > 0) return v;
  }
  const json = JSON.stringify(input);
  if (json === "{}") return undefined;
  return json.length > 300 ? `${json.slice(0, 299)}…` : json;
}
