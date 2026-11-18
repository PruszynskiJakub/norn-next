/**
 * Plumbing shared by the provider contract suites. A suite registers the same tests for every
 * implementation; `failing` names tests one implementation is known to break, which then run as
 * `test.failing`, so the gap stays visible and its fix flips the test back by dropping the name.
 */
import { expect, test } from "bun:test";
import type { PluginFailure, PluginResult } from "@norn/plugin-api";

export interface ContractOptions<Name extends string> {
  /** tests this implementation breaks today, each with the reason */
  failing?: Partial<Record<Name, string>>;
}

export function contractTest<Name extends string>(opts: ContractOptions<Name>, name: Name, fn: () => Promise<void>): void {
  const reason = opts.failing?.[name];
  if (reason === undefined) test(name, fn);
  else test.failing(`${name} [known failure: ${reason}]`, fn);
}

/** The value of a successful answer; a failure fails the test with its message. */
export function valueOf<T>(r: PluginResult<T>): T {
  if (!r.ok) throw new Error(`expected ok, got ${r.failure.code}: ${r.failure.message}`);
  return r.value;
}

/** The failure of an answer that must fail, checked for the contract's shape. */
export function failureOf<T>(r: PluginResult<T>): PluginFailure {
  if (r.ok) throw new Error(`expected a failure, got ok: ${JSON.stringify(r.value)}`);
  expect(typeof r.failure.code).toBe("string");
  expect(typeof r.failure.message).toBe("string");
  expect(typeof r.failure.retryable).toBe("boolean");
  return r.failure;
}

/** Fail the test unless the validator accepts, naming the schema's complaints. */
export function expectValid(what: string, r: { ok: true } | { ok: false; errors: Array<{ path: string; message: string }> }): void {
  expect({ what, errors: r.ok ? [] : r.errors }).toEqual({ what, errors: [] });
}
