/**
 * How a provider plugin (tracker, forge) answers: a value or a failure, never a throw. A thrown
 * provider error reaches the host as an unknown, and a host that cannot tell a refused call from a
 * done one is how a failed `gh` call came to be reported as success.
 */
import { type Static, Type } from "@sinclair/typebox";

export const PluginFailureCode = Type.Union([
  Type.Literal("auth"),
  Type.Literal("not_found"),
  Type.Literal("conflict"),
  Type.Literal("rate_limited"),
  Type.Literal("unavailable"),
  Type.Literal("invalid"),
  Type.Literal("unknown"),
]);
export type PluginFailureCode = Static<typeof PluginFailureCode>;

export const PluginFailure = Type.Object(
  {
    code: PluginFailureCode,
    message: Type.String(),
    /** whether the same call may succeed later unchanged; the host backs off rather than giving up */
    retryable: Type.Boolean(),
  },
  { additionalProperties: false },
);
export type PluginFailure = Static<typeof PluginFailure>;

/**
 * A provider call's answer. A failed effect changes nothing it can avoid changing: the host records
 * the failure and performs the same effect again later under the same receipt id.
 */
export type PluginResult<T> = { ok: true; value: T } | { ok: false; failure: PluginFailure };

/** Codes a later identical call may get past without anyone changing anything. */
const RETRYABLE: ReadonlySet<PluginFailureCode> = new Set(["rate_limited", "unavailable"]);

export function ok<T>(value: T): PluginResult<T> {
  return { ok: true, value };
}

/** A failure; `retryable` defaults by code (rate limits and outages pass, the rest need a change). */
export function fail<T = never>(code: PluginFailureCode, message: string, retryable: boolean = RETRYABLE.has(code)): PluginResult<T> {
  return { ok: false, failure: { code, message, retryable } };
}
