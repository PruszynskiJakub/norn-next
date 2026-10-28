/**
 * `runCli(argv, deps)`: parse → dispatch → one JSON value + exit code (P8). Never exits the
 * process and never prints; `main.ts` does both. Tests call this in-process with fakes.
 * A command with `markdown: true` prints markdown (its `rendered` result, refusals too) unless
 * `--json` is given; every command accepts `--json`. `value` is always the data. A JSON command
 * may print text the caller asked for with its own flag (`rendered(…, { asked: true })`).
 * `norn <noun> <verb>` runs the verb; `norn <noun>` alone is `norn help <noun>` (B2).
 */
import { parseArgs } from "node:util";
import { ExitCode } from "@norn/schema";
import type { Command, Noun, ParsedArgs } from "./command.ts";
import { COMMANDS, findCommand, findNoun, NOUNS } from "./commands/index.ts";
import { type CliDeps, Context } from "./context.ts";
import { CliFailure, failureMarkdown, isRendered, isWithExit, render, toFailure, usageError } from "./output.ts";
import { NORN_VERSION } from "./version.ts";
import { cmd } from "@norn/core";

export interface CliResult {
  exit: ExitCode;
  /** the JSON value printed with `--json` (the data, also when stdout is markdown) */
  value: unknown;
  /** exactly what goes to stdout */
  stdout: string;
}

const done = (value: unknown, exit: ExitCode = ExitCode.ok): CliResult => ({ exit, value, stdout: render(value) });
const failed = (f: CliFailure): CliResult => done(f.body, f.exit);
const unknownCommand = (name: string, doInstead: string): CliResult => failed(usageError(`Unknown command: ${name}`, doInstead, "unknown_command"));
const jsonOnly = (argv: string[]) => argv.filter((a) => a === "--json");
const asksHelp = (argv: string[]) => argv.includes("--help") || argv.includes("-h");

export function helpFor(c: Command) {
  return { command: c.name, summary: c.summary, usage: c.usage, options: Object.keys(c.options ?? {}) };
}

/** A noun as `norn help` lists it: its verbs in order (B2). */
export function nounHelp(n: Noun) {
  return { command: n.name, summary: n.summary, usage: `norn ${n.name} <verb>`, options: [], verbs: n.verbs.map(helpFor) };
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
  const [first, ...more] = argv;
  // `norn`, `norn --help` and `norn <command> --help` are `norn help`: markdown unless --json
  if (!first || first === "--help" || first === "-h") return runCli(["help", ...jsonOnly(more)], deps);
  const [name, ...rest] = argv as [string, ...string[]];
  if (name === "--version" || name === "-v") return done({ version: NORN_VERSION });
  const noun = findNoun(name);
  if (noun) {
    // B2: `norn run` (and `norn run --help`) lists the verbs
    const [verb, ...after] = rest;
    if (!verb || verb.startsWith("-")) return runCli(["help", name, ...jsonOnly(rest)], deps);
    const command = findCommand(`${name} ${verb}`);
    if (!command) return unknownCommand(`${name} ${verb}`, `norn help ${name} — verbs: ${noun.verbs.map((v) => v.name.slice(name.length + 1)).join(", ")}`);
    if (asksHelp(after)) return runCli(["help", name, verb, ...jsonOnly(after)], deps);
    return dispatch(command, after, deps);
  }
  const command = findCommand(name);
  if (!command) return unknownCommand(name, `${cmd.help()} — commands: ${[...COMMANDS, ...NOUNS].map((c) => c.name).join(", ")}`);
  if (name !== "help" && asksHelp(rest)) return runCli(["help", name, ...jsonOnly(rest)], deps);
  return dispatch(command, rest, deps);
}

async function dispatch(command: Command, rest: string[], deps: CliDeps): Promise<CliResult> {
  // `--json` is every command's; `--text` is the old opt-in for readable output, now the default
  const end = rest.indexOf("--");
  const flags = end < 0 ? rest : rest.slice(0, end);
  const json = flags.includes("--json");
  const markdown = command.markdown === true && !json;
  const argvOwn = [...flags.filter((a) => a !== "--json" && (command.markdown !== true || a !== "--text")), ...(end < 0 ? [] : rest.slice(end))];
  try {
    const args = { ...parseCommandArgs(command, argvOwn), json };
    const ctx = new Context(deps);
    if (command.repo !== false) await ctx.locate();
    const out = await command.run(ctx, args);
    const [value, exit] = isWithExit(out) ? [out.value, out.exit] : [out ?? { ok: true }, ExitCode.ok];
    if (isRendered(value)) return markdown || (value.asked && !json) ? { exit, value: value.value, stdout: value.markdown } : done(value.value, exit);
    return done(value, exit);
  } catch (e) {
    const f = toFailure(e);
    return markdown ? { exit: f.exit, value: f.body, stdout: failureMarkdown(f) } : failed(f);
  }
}
