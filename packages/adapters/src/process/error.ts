import type { PortError } from "@norn/core";

/** Concrete `PortError` (ports.ts): stable `code` for callers, `retryable` for transient failures. */
class AdapterError extends Error implements PortError {
  readonly code: string;
  readonly retryable: boolean;
  constructor(code: string, message: string, retryable = false) {
    super(message);
    this.name = "AdapterError";
    this.code = code;
    this.retryable = retryable;
  }
}

export function portError(code: string, message: string, retryable = false): AdapterError {
  return new AdapterError(code, message, retryable);
}
