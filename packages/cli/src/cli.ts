/**
 * `runCli(argv, io)`: parse, dispatch, and the machine contract's one output. It never prints and
 * never exits, so a test runs the whole CLI in-process; the entry does both. `norn <noun>` alone,
 * `norn --help` and `<command> --help` are `norn help`.
 */
import { PLUGIN_API_VERSION } from "@norn/plugin-api";
import { type Command, parseCommandArgs } from "./command.ts";
import { COMMANDS, findCommand, findNoun, NOUNS } from "./commands/index.ts";
import { CliContext, type CliIo } from "./context.ts";
import { type CliFailure, ExitCode, failureMarkdown, isRaw, isRendered, isWithExit, render, rendered, toFailure, usageError } from "./output.ts";
import { personOnlyRefusal } from "./person-only.ts";
import { bundledNames } from "./plugins/bundled.ts";

export interface CliResult {
  exit: number;
  /** the JSON value `--json` prints; for a raw command, null */
  value: unknown;
  /** exactly what goes to stdout */
  stdout: string;
  /** lines for a person, never data */
  stderr?: string;
  /** the entry calls it once stdout is written (a raw command's `after`) */
  after?: () => Promise<void>;
}

const JSON_FLAG = "--json";
const flagsOf = (argv: readonly string[]) => {
  const end = argv.indexOf("--");
  return end < 0 ? argv : argv.slice(0, end);
};
const asksJson = (argv: readonly string[]) => flagsOf(argv).includes(JSON_FLAG);
const asksHelp = (argv: readonly string[]) => flagsOf(argv).some((a) => a === "--help" || a === "-h");

function out(value: unknown, json: boolean, exit: number = ExitCode.ok): CliResult {
  if (isRendered(value)) return { exit, value: value.value, stdout: json ? render(value.value) : value.markdown };
  return { exit, value, stdout: render(value) };
}

function failed(f: CliFailure, json: boolean): CliResult {
  return { exit: f.exit, value: f.body, stdout: json ? render(f.body) : failureMarkdown(f) };
}

export function versionInfo(version: string) {
  const value = { version, plugin_api: PLUGIN_API_VERSION, bundled: bundledNames() };
  return rendered(value, [`norn ${version}`, `plugin API ${PLUGIN_API_VERSION}`, `bundled: ${value.bundled.join(", ")}`].join("\n"));
}

export async function runCli(argv: readonly string[], io: CliIo): Promise<CliResult> {
  const json = asksJson(argv);
  const [first, ...rest] = argv;
  if (!first || first === "--help" || first === "-h" || (first === JSON_FLAG && rest.length === 0)) return runCli(["help", ...(json ? [JSON_FLAG] : [])], io);
  if (first === "--version" || first === "-v") return out(versionInfo(io.version), json);
  const noun = findNoun(first);
  if (noun) {
    const [verb, ...after] = rest;
    if (!verb || verb.startsWith("-")) return runCli(["help", first, ...(json ? [JSON_FLAG] : [])], io);
    const command = findCommand(`${first} ${verb}`);
    if (!command)
      return failed(usageError(`Unknown command: ${first} ${verb}`, `norn help ${first}; verbs: ${noun.verbs.map((v) => v.name.slice(first.length + 1)).join(", ")}`, "unknown_command"), json);
    if (asksHelp(after)) return runCli(["help", first, verb, ...(json ? [JSON_FLAG] : [])], io);
    return dispatch(command, after, json, io);
  }
  const command = findCommand(first);
  if (!command) return failed(usageError(`Unknown command: ${first}`, `norn help; commands: ${[...COMMANDS, ...NOUNS].map((c) => c.name).join(", ")}`, "unknown_command"), json);
  if (first !== "help" && asksHelp(rest)) return runCli(["help", first, ...(json ? [JSON_FLAG] : [])], io);
  return dispatch(command, rest, json, io);
}

async function dispatch(command: Command, rest: readonly string[], json: boolean, io: CliIo): Promise<CliResult> {
  const end = rest.indexOf("--");
  const own = [...flagsOf(rest).filter((a) => a !== JSON_FLAG), ...(end < 0 ? [] : rest.slice(end))];
  const ctx = new CliContext(io, { acts: command.acts === true });
  const withStderr = (r: CliResult): CliResult => (ctx.stderr.length > 0 ? { ...r, stderr: ctx.stderr.map((l) => `${l}\n`).join("") } : r);
  try {
    const refused = personOnlyRefusal(command, io.env);
    if (refused) throw refused;
    const args = parseCommandArgs(command, own, json);
    const result = await command.run(ctx, args);
    if (isRaw(result)) return withStderr({ exit: result.exit, value: null, stdout: result.stdout, ...(result.after && { after: result.after }) });
    if (isWithExit(result)) return withStderr(out(result.value, json, result.exit));
    return withStderr(out(result ?? { ok: true }, json));
  } catch (e) {
    const f = toFailure(e, Boolean(io.env.NORN_DEBUG));
    // a harness waits on its hook: one that cannot run answers with nothing (the harness's default) and says why on stderr
    if (command.answersRaw) return { exit: ExitCode.ok, value: null, stdout: "", stderr: `norn ${command.name}: ${f.body.error}\n` };
    return withStderr(failed(f, json));
  }
}
