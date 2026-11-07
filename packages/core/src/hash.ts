import type { Workflow } from "@norn/schema";

/** JSON with object keys sorted recursively; `undefined` members dropped. Stable across key order. */
function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v).sort()) {
      const x = (v as Record<string, unknown>)[k];
      if (x !== undefined) out[k] = sortKeys(x);
    }
    return out;
  }
  return v;
}

export function sha256(text: string): string {
  return new Bun.CryptoHasher("sha256").update(text).digest("hex");
}

/**
 * Hash of a parsed workflow's canonical JSON, so YAML formatting and key order never change it.
 * state.json's `workflow_hash` hashes the pinned file text instead; use this one to compare meaning.
 */
export function workflowHash(workflow: Workflow): string {
  return sha256(canonicalJson(workflow));
}
