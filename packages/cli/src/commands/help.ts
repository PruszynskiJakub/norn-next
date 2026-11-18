/** `norn help [<command>]`: every command, one noun's verbs, or one command's usage and flags. */
import { type Command, defineCommand, type Noun } from "../command.ts";
import { rendered, usageError } from "../output.ts";

export interface CommandHelp {
  command: string;
  summary: string;
  usage: string;
  options: Record<string, string>;
}

export function helpOf(c: Command): CommandHelp {
  return { command: c.name, summary: c.summary, usage: c.usage, options: { ...(c.optionHelp ?? {}), "--json": "print one JSON value instead of markdown" } };
}

function commandMarkdown(h: CommandHelp): string {
  const opts = Object.entries(h.options).map(([k, v]) => `- \`${k}\`: ${v}`);
  return [`# norn ${h.command}`, "", h.summary, "", "```", h.usage, "```", "", "## Options", "", ...opts].join("\n");
}

type Registry = typeof import("./index.ts");

function nounHelp(n: Noun) {
  return { command: n.name, summary: n.summary, usage: `norn ${n.name} <verb>`, verbs: n.verbs.map(helpOf) };
}

function nounMarkdown(n: Noun): string {
  return [`# norn ${n.name}`, "", n.summary, "", ...n.verbs.map((v) => `- \`${v.usage}\`: ${v.summary}`)].join("\n");
}

function allHelp({ COMMANDS, NOUNS }: Registry) {
  return { usage: "norn <command> [--json]", commands: COMMANDS.map(helpOf), nouns: NOUNS.map(nounHelp) };
}

function allMarkdown({ COMMANDS, NOUNS }: Registry): string {
  return [
    "# norn",
    "",
    "Usage: `norn <command> [--json]`. With `--json` every command prints one JSON value; a refusal is `{error, do_instead, code}` with a non-zero exit code.",
    "",
    "## Commands",
    "",
    ...COMMANDS.map((c) => `- \`${c.usage}\`: ${c.summary}`),
    ...NOUNS.flatMap((n) => ["", `## ${n.name}`, "", n.summary, "", ...n.verbs.map((v) => `- \`${v.usage}\`: ${v.summary}`)]),
  ].join("\n");
}

export const helpCommand = defineCommand({
  name: "help",
  summary: "Show every command, or one command's usage",
  usage: "norn help [<command>]",
  positionals: { min: 0, max: 2 },
  async run(_ctx, args) {
    // loaded here, not imported above: the registry imports this file, and a static cycle would read it before it is made
    const registry: Registry = await import("./index.ts");
    const { findCommand, findNoun } = registry;
    if (args.positionals.length === 0) return rendered(allHelp(registry), allMarkdown(registry));
    const name = args.positionals.join(" ");
    const c = findCommand(name);
    if (c) return rendered(helpOf(c), commandMarkdown(helpOf(c)));
    const n = args.positionals.length === 1 ? findNoun(name) : undefined;
    if (n) return rendered(nounHelp(n), nounMarkdown(n));
    throw usageError(`Unknown command: ${name}`, "norn help", "unknown_command");
  },
});
