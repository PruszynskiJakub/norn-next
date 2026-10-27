/**
 * Command framework. One file per command under `src/commands/`, each exporting a
 * `defineCommand({...})` value that is listed in `src/commands/index.ts`.
 *
 * Arguments are parsed with `node:util` parseArgs from the command's `options`; unknown
 * options and wrong positional counts are usage errors (exit 2). `run` gets the Context
 * (repo located first unless `repo: false`) and returns one JSON value, `withExit(value, code)`,
 * or throws a `CliFailure` (`refuse`, `usageError`, `corruptError`, `busyError`, `failure`).
 * A command whose reader is an agent or a person sets `markdown: true` and returns
 * `rendered(value, markdown)`; `--json` (accepted by every command) prints the value instead.
 */
import type { ParseArgsConfig } from "node:util";
import type { Context } from "./context.ts";

export type OptionSpec = NonNullable<ParseArgsConfig["options"]>;

export interface ParsedArgs {
  /** option values by long name (strings, booleans, or arrays for `multiple`) */
  values: Record<string, string | boolean | Array<string | boolean> | undefined>;
  positionals: string[];
  /** options in the order given (`--note a --note-criterion AC1 --note b` pairs by position, NT1) */
  order?: Array<{ name: string; value: string | boolean }>;
  /** `--json` was given (the dispatcher takes it out of `values`); a command that draws a screen prints data instead */
  json?: boolean;
}

export interface Command {
  name: string;
  /** one line, shown by `norn help` */
  summary: string;
  /** e.g. `norn watch [--interval 30s]` */
  usage: string;
  options?: OptionSpec;
  /** positional argument count bounds (default: none allowed) */
  positionals?: { min?: number; max?: number };
  /** prints markdown unless `--json` (refusals too): its reader is an agent or a person, not a program */
  markdown?: boolean;
  /** needs a git repository (default true): `ctx.locate()` runs before `run` */
  repo?: boolean;
  run(ctx: Context, args: ParsedArgs): Promise<unknown>;
}

export function defineCommand(c: Command): Command {
  return c;
}

/** Typed option getters (parseArgs values are loosely typed). */
export const opt = {
  str(args: ParsedArgs, name: string): string | undefined {
    const v = args.values[name];
    return typeof v === "string" ? v : undefined;
  },
  bool(args: ParsedArgs, name: string): boolean {
    return args.values[name] === true;
  },
  list(args: ParsedArgs, name: string): string[] {
    const v = args.values[name];
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : typeof v === "string" ? [v] : [];
  },
};
