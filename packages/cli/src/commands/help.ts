/** `norn help`: the commands grouped for a person, "Start here" first; `--json` for the list as data. */
import type { Command } from "../command.ts";
import { defineCommand } from "../command.ts";
import { rendered } from "../output.ts";

/** Help groups in print order; a command missing here lands in "Other". */
export const HELP_GROUPS: ReadonlyArray<{ title: string; commands: readonly string[] }> = [
  { title: "Start here", commands: ["init", "doctor", "sync", "watch", "inbox", "open"] },
  { title: "Answer what needs you", commands: ["answer", "approve", "unstick", "update", "mode", "workflow"] },
  { title: "Look around", commands: ["status", "trace", "why", "pane", "tick"] },
  { title: "Agent protocol (run by the agent)", commands: ["brief", "done", "ask", "stuck", "hook"] },
  { title: "Team", commands: ["take", "release", "drop"] },
  { title: "Housekeeping", commands: ["tidy", "uninstall", "help"] },
];

/** Spec ids such as `(A1, SK1, W1)` or `(§9.3)` mean nothing to a newcomer; the JSON keeps them. */
export const plainSummary = (summary: string): string =>
  summary.replace(/\s*\((?:(?:§[\d.]+|[A-Z]{1,3}\d+(?:\.\d+)?[a-z]?)(?:[–-][A-Z]{0,3}\d+)?(?:,\s*)?)+\)/g, "");

export function formatHelp(commands: readonly Command[]): string {
  const width = Math.max(...commands.map((c) => c.name.length)) + 2;
  const row = (c: Command) => `  norn ${c.name.padEnd(width)}${plainSummary(c.summary)}`;
  const grouped = new Set(HELP_GROUPS.flatMap((g) => g.commands));
  const groups = [...HELP_GROUPS, { title: "Other", commands: commands.map((c) => c.name).filter((n) => !grouped.has(n)) }];
  const out = ["norn — deliver software stories with coding agents; code decides the next step, agents do it.", ""];
  for (const g of groups) {
    const cs = g.commands.flatMap((n) => commands.filter((c) => c.name === n));
    if (cs.length) out.push(g.title, ...cs.map(row), "");
  }
  out.push("New here? `norn init` in your repository, then follow the steps it prints.", "`norn help <command>` shows one command's usage; add `--json` to any command for data.");
  return out.join("\n");
}

export function formatCommandHelp(c: Command): string {
  return `norn ${c.name} — ${plainSummary(c.summary)}\n\n    ${c.usage}`;
}

export const helpCommand = defineCommand({
  name: "help",
  summary: "List commands",
  usage: "norn help [command]",
  positionals: { max: 1 },
  markdown: true,
  repo: false,
  async run(_ctx, args) {
    // imported lazily: the registry imports this file
    const { COMMANDS, findCommand } = await import("./index.ts");
    const { helpFor } = await import("../cli.ts");
    const name = args.positionals[0];
    const c = name ? findCommand(name) : undefined;
    return c ? rendered(helpFor(c), formatCommandHelp(c)) : rendered({ commands: COMMANDS.map(helpFor) }, formatHelp(COMMANDS));
  },
});
