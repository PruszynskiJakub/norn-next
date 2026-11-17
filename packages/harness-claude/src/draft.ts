import type { HarnessEvent } from "@norn/plugin-api";

type WithoutEnvelope<E> = E extends unknown ? Omit<E, "run_id" | "seq" | "at"> : never;
/** An event before normalize stamps the envelope on it. */
export type Draft = WithoutEnvelope<HarnessEvent>;

/** A payload that cannot be read: normalize turns it into one `hook.error`, never a throw. */
export class PayloadError extends Error {}

export function need<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new PayloadError(`payload lacks ${what}`);
  return value;
}
