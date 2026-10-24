/**
 * `runCli(argv, deps)`: parse → dispatch → one JSON value + exit code (P8). Never exits the
 * process and never prints; `main.ts` does both. Tests call this in-process with fakes.
 */
import { parseArgs } from "node:util";
import { ExitCode } from "@norn/schema";
import type { Command, ParsedArgs } from "./command.ts";
import { COMMANDS, findCommand } from "./commands/index.ts";
import { type CliDeps, Context } from "./context.ts";
import { CliFailure, isTextOutput, isWithExit, render, toFailure, usageError } from "./output.ts";

export interface CliResult {
  exit: ExitCode;
  /** the JSON value printed */
  value: unknown;
  /** exactly what goes to stdout */
  stdout: string;
}

const done = (value: unknown, exit: ExitCode = ExitCode.ok): CliResult => ({ exit, value, stdout: render(value) });
const failed = (f: CliFailure): CliResult => done(f.body, f.exit);

export function helpFor(c: Command) {
  return { command: c.name, summary: c.summary, usage: c.usage, options: Object.keys(c.options ?? {}) };
}

export function parseCommandArgs(c: Command, argv: string[]): ParsedArgs {
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({ args: argv, options: c.options ?? {}, allowPositionals: true, strict: true });
  } catch (e) {
    throw usageError((e as Error).message, `norn ${c.name} --help`);
  }
  const min = c.positionals?.min ?? 0;
  const max = c.positionals?.max ?? 0;
  const n = parsed.positionals.length;
  if (n < min || n > max) throw usageError(`${c.name}: expected ${min === max ? min : `${min}–${max}`} argument(s), got ${n}`, c.usage);
  return { values: parsed.values as ParsedArgs["values"], positionals: parsed.positionals };
}

export async function runCli(argv: string[], deps: CliDeps = {}): Promise<CliResult> {
  const [name, ...rest] = argv;
  if (!name || name === "--help" || name === "-h") return done({ commands: COMMANDS.map(helpFor) });
  const command = findCommand(name);
  if (!command) return failed(usageError(`unknown command '${name}'`, `norn help — commands: ${COMMANDS.map((c) => c.name).join(", ")}`, "unknown_command"));
  if (rest.includes("--help") || rest.includes("-h")) return done(helpFor(command));
  try {
    const args = parseCommandArgs(command, rest);
    const ctx = new Context(deps);
    if (command.repo !== false) await ctx.locate();
    const out = await command.run(ctx, args);
    if (isTextOutput(out)) return { exit: ExitCode.ok, value: out.text, stdout: out.text };
    return isWithExit(out) ? done(out.value, out.exit) : done(out ?? { ok: true });
  } catch (e) {
    return failed(toFailure(e));
  }
}
