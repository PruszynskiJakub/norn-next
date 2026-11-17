/**
 * The machine contract: with `--json` a command prints exactly one JSON value; a refusal is a
 * `CliError` `{error, do_instead, code?, details?}` with an `ExitCode`. Without `--json` a command
 * prints markdown for an agent or a person, with the same exit code, so code branches on exit codes
 * and JSON data, never on the markdown.
 */
import { type CliError, ExitCode } from "@norn/schema";

export { ExitCode };

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
export const refuse = (error: string, do_instead: string | null, code = "refused", details?: unknown) =>
  new CliFailure(body(error, do_instead, code, details), ExitCode.refused);
/** Bad arguments (exit 2). */
export const usageError = (error: string, do_instead: string | null = "norn help", code = "usage") => new CliFailure(body(error, do_instead, code), ExitCode.usage);
/** A file norn keeps failed validation (exit 4). */
export const corruptError = (error: string, do_instead: string | null, details?: unknown, code = "corrupt") =>
  new CliFailure(body(error, do_instead, code, details), ExitCode.corrupt);
/** Another process holds the lock or claim (exit 5). */
export const busyError = (error: string, do_instead: string | null, code = "busy", details?: unknown) =>
  new CliFailure(body(error, do_instead, code, details), ExitCode.busy);
/** A config file a person wrote needs fixing (exit 6): never a guess at what they meant. */
export const configFailure = (error: string, do_instead: string | null, code = "config_invalid", details?: unknown) =>
  new CliFailure(body(error, do_instead, code, details), ExitCode.config);
/** Unexpected failure (exit 1). */
export const failure = (error: string, do_instead: string | null = null, code = "error", details?: unknown) =>
  new CliFailure(body(error, do_instead, code, details), ExitCode.error);

/** A command whose body another change fills in: a refusal, so a script never mistakes it for done. */
export const notBuilt = (command: string) => refuse(`norn ${command} is not built yet`, null, "not_built");

const EXIT = Symbol("norn.exit");

export interface WithExit {
  [EXIT]: true;
  value: unknown;
  exit: ExitCode;
}

/** A value with a non-zero exit code (a tick whose actions partly failed). */
export function withExit(value: unknown, exit: ExitCode): WithExit {
  return { [EXIT]: true, value, exit };
}

export function isWithExit(v: unknown): v is WithExit {
  return typeof v === "object" && v !== null && (v as Partial<WithExit>)[EXIT] === true;
}

const RENDERED = Symbol("norn.rendered");

/** A command's data with its markdown; `--json` prints `value`, otherwise the markdown. */
export interface Rendered {
  [RENDERED]: true;
  value: unknown;
  markdown: string;
}

export function rendered(value: unknown, markdown: string): Rendered {
  return { [RENDERED]: true, value, markdown: markdown.endsWith("\n") ? markdown : `${markdown}\n` };
}

export function isRendered(v: unknown): v is Rendered {
  return typeof v === "object" && v !== null && (v as Partial<Rendered>)[RENDERED] === true;
}

const RAW = Symbol("norn.raw");

/**
 * Bytes printed as they are, whatever the flags: a hook's answer belongs to the harness that asked,
 * and a hook must always answer, so it never becomes a CliError.
 */
export interface Raw {
  [RAW]: true;
  stdout: string;
  exit: number;
  /** runs once `stdout` is printed: what must never be marked done before the other program got it */
  after?: () => Promise<void>;
}

export function raw(stdout: string, exit: number, after?: () => Promise<void>): Raw {
  return { [RAW]: true, stdout, exit, ...(after && { after }) };
}

export function isRaw(v: unknown): v is Raw {
  return typeof v === "object" && v !== null && (v as Partial<Raw>)[RAW] === true;
}

/** Text safe inside a markdown table cell. */
export const tableCell = (s: string): string => s.replace(/\|/g, "\\|");

const FAILURE_TITLE: Partial<Record<ExitCode, string>> = {
  [ExitCode.refused]: "Refused",
  [ExitCode.usage]: "Usage error",
  [ExitCode.corrupt]: "Corrupt state",
  [ExitCode.busy]: "Busy",
  [ExitCode.config]: "Config error",
};

export function failureMarkdown(f: CliFailure): string {
  const { error, do_instead, code } = f.body;
  const title = FAILURE_TITLE[f.exit] ?? "Error";
  return `**${title}${code ? ` (${code})` : ""}:** ${error}\n${do_instead ? `\nDo instead: ${do_instead}\n` : ""}`;
}

/** Anything thrown, as a CliFailure: never prose on stdout. */
export function toFailure(e: unknown, debug = false): CliFailure {
  if (e instanceof CliFailure) return e;
  const err = e instanceof Error ? e : new Error(String(e));
  return failure(err.message, null, "error", debug ? { stack: err.stack } : undefined);
}

/** One JSON value and a newline. */
export const render = (value: unknown): string => `${JSON.stringify(value)}\n`;
