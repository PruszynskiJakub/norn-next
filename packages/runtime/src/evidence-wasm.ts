/**
 * Bundle-time macro: imported `with { type: "macro" }`, so it runs while Bun transpiles or bundles,
 * never at run time. Each codec otherwise `fetch`es its `.wasm` beside the script, which the compiled
 * binary and the one-file npm bundle do not carry; inlining the bytes makes every form self-contained.
 */
import { readFileSync } from "node:fs";

export function wasmBase64(specifier: string): string {
  return readFileSync(Bun.resolveSync(specifier, import.meta.dir)).toString("base64");
}
