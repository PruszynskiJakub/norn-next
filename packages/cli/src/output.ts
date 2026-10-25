/**
 * Machine contract (P8, §9.3): every command prints exactly one JSON value on stdout and
 * exits with an `ExitCode`. Failures and refusals are `CliError` `{error, do_instead, code?}`.
 * Commands return a value (exit 0) or `withExit(value, code)`, and throw `CliFailure` to refuse.
 */
import { type ClaimBlob, type CliError, ExitCode } from "@norn/schema";

export class CliFailure extends Error {
  constructor(
    readonly body: CliError,
    readonly exit: ExitCode,
  ) {
    super(body.error);
    this.name = "CliFailure";
  }
}

const body = (error: string, do_instead: string | null, code?: string, details?: unknown): CliError => ({
  error,
  do_instead,
  ...(code ? { code } : {}),
  ...(details === undefined ? {} : { details }),
});

/** A rule says no (exit 3); `do_instead` is the command or action that would succeed. */
export const refuse = (error: string, do_instead: string | null, code?: string, details?: unknown) =>
  new CliFailure(body(error, do_instead, code, details), ExitCode.refused);
/** Bad arguments (exit 2). */
export const usageError = (error: string, do_instead: string | null = "norn help", code = "usage") =>
  new CliFailure(body(error, do_instead, code), ExitCode.usage);
/** A state or config file failed validation (S2, exit 4). */
export const corruptError = (error: string, do_instead: string | null, details?: unknown) =>
  new CliFailure(body(error, do_instead, "corrupt", details), ExitCode.corrupt);
/** Another process holds the lock or claim (exit 5). */
export const busyError = (error: string, do_instead: string | null, code = "busy", details?: unknown) =>
  new CliFailure(body(error, do_instead, code, details), ExitCode.busy);
/**
 * Another heartbeat holds the story's claim (T3): busy, exit 5, code `claim_held` — the one
 * refusal every verb uses (§9.3), so scripts tell "wait / --force" apart from rule refusals.
 */
export const claimHeld = (claim: Pick<ClaimBlob, "holder" | "acquired_at" | "expires_at">, do_instead: string, note = "") =>
  busyError(`held by ${claim.holder} since ${claim.acquired_at} (expires ${claim.expires_at})${note}`, do_instead, "claim_held", { claim });
/** Unexpected failure (exit 1). */
export const failure = (error: string, do_instead: string | null = null, code = "error", details?: unknown) =>
  new CliFailure(body(error, do_instead, code, details), ExitCode.error);

const EXIT = Symbol("norn.exit");

export interface WithExit {
  [EXIT]: true;
  value: unknown;
  exit: ExitCode;
}

/** Return a value with a non-zero exit code (e.g. a tick whose actions partly failed). */
export function withExit(value: unknown, exit: ExitCode): WithExit {
  return { [EXIT]: true, value, exit };
}

export function isWithExit(v: unknown): v is WithExit {
  return typeof v === "object" && v !== null && (v as Partial<WithExit>)[EXIT] === true;
}

const TEXT = Symbol("norn.text");

/** Plain text on stdout instead of JSON: the explicit human mode of views (`--text`), and `norn brief`, whose reader is an agent. */
export interface TextOutput {
  [TEXT]: true;
  text: string;
}

export function textOutput(text: string): TextOutput {
  return { [TEXT]: true, text: text.endsWith("\n") ? text : `${text}\n` };
}

export function isTextOutput(v: unknown): v is TextOutput {
  return typeof v === "object" && v !== null && (v as Partial<TextOutput>)[TEXT] === true;
}

/** Normalize anything thrown into a CliFailure (never prose on stdout). */
export function toFailure(e: unknown): CliFailure {
  if (e instanceof CliFailure) return e;
  const err = e instanceof Error ? e : new Error(String(e));
  return failure(err.message, null, "error", process.env.NORN_DEBUG ? { stack: err.stack } : undefined);
}

/** One JSON value + newline. */
export const render = (value: unknown): string => `${JSON.stringify(value)}\n`;
