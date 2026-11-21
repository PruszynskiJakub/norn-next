/**
 * The command framework. One file per command under `src/commands/`, each exporting a
 * `defineCommand({...})` value listed in `src/commands/index.ts`, so two changes filling two commands
 * never edit the same file. Flags are parsed from `options` before `run`; an unknown flag or a wrong
 * argument count is a usage error (exit 2). `run` returns a value, `rendered(value, markdown)`,
 * `withExit(value, code)` or `raw(stdout, exit)`, or throws a CliFailure.
 */
import { type ParseArgsConfig, parseArgs } from "node:util";
import type { CliContext } from "./context.ts";
import { usageError } from "./output.ts";

export type OptionSpec = NonNullable<ParseArgsConfig["options"]>;

export interface ParsedArgs {
  values: Record<string, string | boolean | Array<string | boolean> | undefined>;
  positionals: string[];
  /** `--json` was given; the dispatcher takes it out of `values` */
  json: boolean;
}

export interface Command {
  /** as typed: `tick`, `story view` */
  name: string;
  /** one line for `norn help` */
  summary: string;
  /** e.g. `norn watch [--interval 30s]` */
  usage: string;
  options?: OptionSpec;
  /** one line per option for `norn help <command>`, keyed as typed (`--note <text>`) */
  optionHelp?: Record<string, string>;
  /** positional argument count bounds (default: none) */
  positionals?: { min?: number; max?: number };
  /** the rest of the line after the last fixed argument is one argument (`norn ask why is it red`) */
  restJoined?: boolean;
  /**
   * The command answers another program in that program's own format (a hook answers its harness):
   * it returns `raw(...)`, and a failure prints nothing with exit 0 rather than a CliError, so the
   * harness never takes a norn error for its own protocol.
   */
  answersRaw?: boolean;
  /**
   * The command changes run data, an item or a change, so it runs only on a norn at or above the
   * store's version floor and raises the floor to itself (`version-guard.ts`). Checked when the command
   * first builds its runtime env, so its own argument and env refusals still come first.
   */
  acts?: boolean;
  /**
   * Only a person runs it: a decision, a question's answer, or moving, starting, stopping or ending
   * a story's work. Refused before its arguments are read when the process runs in an agent's
   * session (`person-only.ts`), so the rule holds for every harness and runner and no flag lifts it.
   */
  personOnly?: boolean;
  run(ctx: CliContext, args: ParsedArgs): Promise<unknown>;
}

export function defineCommand(c: Command): Command {
  return c;
}

/** A noun and its verbs (`norn story view`); `norn <noun>` alone lists them. */
export interface Noun {
  name: string;
  summary: string;
  verbs: readonly Command[];
}

export function defineNoun(n: Noun): Noun {
  return n;
}

export function parseCommandArgs(c: Command, argv: string[], json: boolean): ParsedArgs {
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({ args: argv, options: c.options ?? {}, allowPositionals: true, strict: true });
  } catch (e) {
    throw usageError((e as Error).message, `norn help ${c.name}`);
  }
  let positionals = parsed.positionals;
  const max = c.positionals?.max ?? 0;
  if (c.restJoined && max > 0 && positionals.length > max) positionals = [...positionals.slice(0, max - 1), positionals.slice(max - 1).join(" ")];
  const min = c.positionals?.min ?? 0;
  const n = positionals.length;
  if (n < min || n > max) throw usageError(`${c.name}: expected ${min === max ? min : `${min} to ${max}`} argument(s), got ${n}`, c.usage);
  return { values: parsed.values as ParsedArgs["values"], positionals, json };
}

/** Typed option getters: parseArgs values are loosely typed. */
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
