/**
 * `runCli(argv, deps)`: parse → dispatch → one JSON value + exit code (P8). Never exits the
 * process and never prints; `main.ts` does both. Tests call this in-process with fakes.
 * A command with `markdown: true` prints markdown (its `rendered` result, refusals too) unless
 * `--json` is given; every command accepts `--json`. `value` is always the data.
 */
import { parseArgs } from "node:util";
import { ExitCode } from "@norn/schema";
import { version } from "../package.json";
import type { Command, ParsedArgs } from "./command.ts";
import { COMMANDS, findCommand } from "./commands/index.ts";
import { type CliDeps, Context } from "./context.ts";
import { CliFailure, failureMarkdown, isRendered, isWithExit, render, toFailure, usageError } from "./output.ts";

export interface CliResult {
  exit: ExitCode;
  /** the JSON value printed with `--json` (the data, also when stdout is markdown) */
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
    parsed = parseArgs({ args: argv, options: c.options ?? {}, allowPositionals: true, strict: true, tokens: true });
  } catch (e) {
    throw usageError((e as Error).message, `norn ${c.name} --help`);
  }
  const min = c.positionals?.min ?? 0;
  const max = c.positionals?.max ?? 0;
  const n = parsed.positionals.length;
  if (n < min || n > max) throw usageError(`${c.name}: expected ${min === max ? min : `${min}–${max}`} argument(s), got ${n}`, c.usage);
  const order = (parsed.tokens ?? []).flatMap((t) => (t.kind === "option" ? [{ name: t.name, value: t.value ?? true }] : []));
  return { values: parsed.values as ParsedArgs["values"], positionals: parsed.positionals, order };
}

export async function runCli(argv: string[], deps: CliDeps = {}): Promise<CliResult> {
  const [name, ...rest] = argv;
  if (!name || name === "--help" || name === "-h") return done({ commands: COMMANDS.map(helpFor) });
  if (name === "--version" || name === "-v") return done({ version });
  const command = findCommand(name);
  if (!command) return failed(usageError(`unknown command '${name}'`, `norn help — commands: ${COMMANDS.map((c) => c.name).join(", ")}`, "unknown_command"));
  if (rest.includes("--help") || rest.includes("-h")) return done(helpFor(command));
  // `--json` is every command's; `--text` is the old opt-in for readable output, now the default
  const end = rest.indexOf("--");
  const flags = end < 0 ? rest : rest.slice(0, end);
  const json = flags.includes("--json");
  const markdown = command.markdown === true && !json;
  const argvOwn = [...flags.filter((a) => a !== "--json" && (command.markdown !== true || a !== "--text")), ...(end < 0 ? [] : rest.slice(end))];
  try {
    const args = parseCommandArgs(command, argvOwn);
    const ctx = new Context(deps);
    if (command.repo !== false) await ctx.locate();
    const out = await command.run(ctx, args);
    const [value, exit] = isWithExit(out) ? [out.value, out.exit] : [out ?? { ok: true }, ExitCode.ok];
    if (isRendered(value)) return markdown ? { exit, value: value.value, stdout: value.markdown } : done(value.value, exit);
    return done(value, exit);
  } catch (e) {
    const f = toFailure(e);
    return markdown ? { exit: f.exit, value: f.body, stdout: failureMarkdown(f) } : failed(f);
  }
}
