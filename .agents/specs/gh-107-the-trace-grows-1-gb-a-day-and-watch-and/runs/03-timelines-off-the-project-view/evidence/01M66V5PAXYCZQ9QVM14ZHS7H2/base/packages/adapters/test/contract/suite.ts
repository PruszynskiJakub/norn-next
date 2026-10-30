/**
 * Shared plumbing for the port contract suites (refactor plan 0.4). A suite registers the same
 * tests for every implementation of a port; `failing` names the tests one implementation is known
 * to break, which then run as `test.failing` (they pass while the defect stands, and the fix flips
 * them back by dropping the name).
 */
import { expect, test } from "bun:test";

export interface ContractOptions<Name extends string> {
  /** tests this implementation breaks today, each with the reason (a defect id or a known gap) */
  failing?: Partial<Record<Name, string>>;
}

/** `test`, or `test.failing` when the implementation is known to break this test. */
export function contractTest<Name extends string>(opts: ContractOptions<Name>, name: Name, fn: () => Promise<void> | void): void {
  const reason = opts.failing?.[name];
  if (reason === undefined) test(name, fn);
  else test.failing(`${name} [known failure: ${reason}]`, fn);
}

/** A PortError (ports.ts): an Error with a string `code` and a boolean `retryable`. */
export function expectPortError(err: unknown): void {
  expect(err).toBeInstanceOf(Error);
  expect(typeof (err as { code?: unknown }).code).toBe("string");
  expect(typeof (err as { retryable?: unknown }).retryable).toBe("boolean");
}
