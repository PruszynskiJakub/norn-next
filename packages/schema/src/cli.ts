import { type Static, Type } from "@sinclair/typebox";
import { NonEmpty } from "./common.ts";

/**
 * Every CLI refusal/failure prints exactly this object as JSON on stdout.
 * `do_instead` is the next command or action that would succeed, or null when none applies.
 */
export const CliError = Type.Object(
  {
    error: NonEmpty,
    do_instead: Type.Union([NonEmpty, Type.Null()]),
    /** stable machine code, e.g. `not_in_unit`, `stale_attempt`, `claim_held` */
    code: Type.Optional(Type.String({ pattern: "^[a-z][a-z0-9_]*$" })),
    details: Type.Optional(Type.Unknown()),
  },
  { $id: "https://norn.dev/schema/cli-error.json", title: "norn CLI error", additionalProperties: false },
);
export type CliError = Static<typeof CliError>;

/** Process exit codes of every `norn` command. */
export const ExitCode = {
  ok: 0,
  /** unexpected failure (bug, IO) */
  error: 1,
  /** bad arguments */
  usage: 2,
  /** refused by a rule; `do_instead` says what to do */
  refused: 3,
  /** a state file failed validation */
  corrupt: 4,
  /** another process holds the lock or claim */
  busy: 5,
  /** a config file a person wrote needs fixing; no unit is broken */
  config: 6,
  /** `norn story wait` ran out of time before its condition held */
  timeout: 7,
} as const;
export type ExitCode = (typeof ExitCode)[keyof typeof ExitCode];
