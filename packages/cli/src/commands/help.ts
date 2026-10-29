/**
 * `norn help`: the commands grouped for a person, "Start here" first; `--json` for the list as data.
 * A noun is one row naming its verbs; `norn help <noun>` lists the verbs (B2), `norn help <noun> <verb>`
 * shows one verb (B4). A hidden group is printed only by `norn help --all`.
 * An agent may run it too, so it says up front which commands an agent runs (the B3–B6 protocol)
 * and marks every command and bundled skill (§16) with who it is for.
 */
import type { Command, Noun } from "../command.ts";
import { defineCommand, opt } from "../command.ts";
import { rendered, usageError } from "../output.ts";
import { bundledSkills } from "../runtime/workflows.ts";

/** Who runs a command: a person, the agent doing a step, or the agent's hooks (never by hand). */
export type CommandFor = "person" | "agent" | "hooks";

/** B14: `status --segment` is a mode of `status` that only Herdr runs, so it is a row of its own in `help --all`. */
const SEGMENT = {
  name: "status --segment",
  summary: "One line for Herdr's tab bar; sorts and marks the orient workspaces",
  usage: "norn status --segment [--ttl 30s]",
  options: ["ttl"],
};

/** Help groups in print order; a command missing here lands in "Other" (for a person). A `hidden` group only with `--all`. */
const HELP_GROUPS: ReadonlyArray<{ title: string; for: CommandFor; commands: readonly string[]; hidden?: boolean }> = [
  { title: "Start here", for: "person", commands: ["init", "doctor", "sync", "watch", "status", "open"] },
  { title: "Answer what needs you", for: "person", commands: ["story", "unstick", "mode", "workflow"] },
  { title: "Look around", for: "person", commands: ["run", "config", "tick"] },
  { title: "Housekeeping", for: "person", commands: ["tidy", "uninstall", "help"] },
  { title: "Run by Herdr, not by hand", for: "person", commands: [SEGMENT.name], hidden: true },
  { title: "Agent protocol: the only commands an agent runs", for: "agent", commands: ["brief", "done", "ask", "stuck"] },
  { title: "Called by the agent's hooks, not by hand", for: "hooks", commands: ["hook"] },
];

/** How a bundled skill is used (§16): only an agent loads skills; some steps also need a person with it. */
export type SkillFor = "protocol" | "step" | "attended" | "reference";

/** Skill groups in print order; a skill missing here lands in "Other skills" (a step skill). */
const SKILL_GROUPS: ReadonlyArray<{ title: string; for: SkillFor; skills: readonly string[] }> = [
  { title: "the protocol, loaded first in every step", for: "protocol", skills: ["norn"] },
  { title: "step skills, the agent works alone", for: "step", skills: ["norn-implement", "norn-review", "norn-qa", "norn-merge", "norn-slice", "norn-pr", "norn-diagnose"] },
  { title: "step skills, a person works with the agent", for: "attended", skills: ["norn-refine", "norn-clarify", "norn-plan", "norn-interview", "norn-qa-person", "norn-prototype"] },
  { title: "references other skills read, never a step", for: "reference", skills: ["norn-tdd", "norn-codebase-design"] },
];

/** Printed right under the title: an agent that runs `norn help` must not take the person's commands for its own. */
const AGENT_NOTE = [
  "Agent doing a norn step? Run only `norn brief`, then report once with `norn done`, `norn ask` or `norn stuck`",
  "(the `norn` skill says how). Every other command is the person's: run one only when the person asks you to directly.",
];

/** Spec ids such as `(A1, SK1, W1)` or `(§9.3)` mean nothing to a newcomer; the JSON keeps them. */
const plainSummary = (summary: string): string =>
  summary.replace(/\s*\((?:(?:§[\d.]+|[A-Z]{1,3}\d+(?:\.\d+)?[a-z]?)(?:[–-][A-Z]{0,3}\d+)?(?:,\s*)?)+\)/g, "");

/** A verb is for whoever its noun is for. */
const commandFor = (name: string): CommandFor => {
  const top = name.split(" ")[0] as string;
  return HELP_GROUPS.find((g) => g.commands.includes(top))?.for ?? "person";
};

const skillFor = (name: string): SkillFor => SKILL_GROUPS.find((g) => g.skills.includes(name))?.for ?? "step";

/** A row of `norn help`: a command, or a noun with its verbs. */
type Row = { name: string; summary: string };

const nounRow = (n: Noun): Row => ({ name: n.name, summary: `${n.summary} (${n.verbs.map((v) => v.name.slice(n.name.length + 1)).join(", ")})` });

function formatHelp(rows: readonly Row[], skills: readonly string[] = [], all = false): string {
  const width = Math.max(...rows.map((c) => c.name.length)) + 2;
  const row = (c: Row) => `  norn ${c.name.padEnd(width)}${plainSummary(c.summary)}`;
  const grouped = new Set(HELP_GROUPS.flatMap((g) => g.commands));
  const other = { title: "Other", commands: rows.map((c) => c.name).filter((n) => !grouped.has(n)) };
  const groups = [...HELP_GROUPS.slice(0, -2), other, ...HELP_GROUPS.slice(-2)].filter((g) => all || !("hidden" in g && g.hidden));
  const out = ["norn — deliver software stories with coding agents; code decides the next step, agents do it.", "", ...AGENT_NOTE, ""];
  for (const g of groups) {
    const cs = g.commands.flatMap((n) => rows.filter((c) => c.name === n));
    if (cs.length) out.push(g.title, ...cs.map(row), "");
  }
  if (skills.length) {
    const listed = new Set(SKILL_GROUPS.flatMap((g) => g.skills));
    const sgroups = [...SKILL_GROUPS, { title: "other skills", skills: skills.filter((s) => !listed.has(s)) }];
    out.push("Skills (in .agents/skills/; only an agent loads one, the one its brief names)");
    for (const g of sgroups) {
      const names = g.skills.filter((s) => skills.includes(s));
      if (names.length) out.push(`  ${g.title}: ${names.join(", ")}`);
    }
    out.push("");
  }
  out.push("New here? `norn init` in your repository, then follow the steps it prints.", "`norn help <command>` shows one command's usage; add `--json` to any command for data.");
  return out.join("\n");
}

function formatCommandHelp(c: Command): string {
  const note = commandFor(c.name) === "person" ? "\n\nFor the person; an agent runs it only when the person asks it to." : "";
  const opts = Object.entries(c.optionHelp ?? {});
  const width = Math.max(0, ...opts.map(([k]) => k.length)) + 2;
  const options = opts.length ? `\n\nOptions\n${opts.map(([k, v]) => `  ${k.padEnd(width)}${v}`).join("\n")}` : "";
  return `norn ${c.name} — ${plainSummary(c.summary)}\n\n    ${c.usage}${options}${note}`;
}

/** B2: `norn <noun>` — its verbs, in order. */
function formatNounHelp(n: Noun): string {
  const width = Math.max(...n.verbs.map((v) => v.name.length)) + 2;
  const verbs = n.verbs.map((v) => `  norn ${v.name.padEnd(width)}${plainSummary(v.summary)}`);
  return [`norn ${n.name} — ${plainSummary(n.summary)}`, "", ...verbs, "", `\`norn help ${n.name} <verb>\` shows one verb's usage and options.`].join("\n");
}

export const helpCommand = defineCommand({
  name: "help",
  summary: "List commands, and who runs each: a person or the agent",
  usage: "norn help [--all] [<command> | <noun> [<verb>]]",
  options: { all: { type: "boolean" } },
  positionals: { max: 2 },
  markdown: true,
  repo: false,
  async run(ctx, args) {
    // imported lazily: the registry imports this file
    const { COMMANDS, NOUNS, findCommand, findNoun } = await import("./index.ts");
    const { helpFor, nounHelp } = await import("../cli.ts");
    const [name, verb] = args.positionals;
    const noun = name ? findNoun(name) : undefined;
    if (noun && verb) {
      const c = findCommand(`${noun.name} ${verb}`);
      if (!c) throw usageError(`Unknown command: ${noun.name} ${verb}`, `norn help ${noun.name}`, "unknown_command");
      return rendered({ ...helpFor(c), for: commandFor(c.name) }, formatCommandHelp(c));
    }
    if (noun) return rendered({ ...nounHelp(noun), for: commandFor(noun.name) }, formatNounHelp(noun));
    const c = name ? findCommand(name) : undefined;
    // B5: an unknown name, or a word after a plain command, is a usage error, as it is for `norn <name>`
    if (name && (!c || verb)) throw usageError(`Unknown command: ${args.positionals.join(" ")}`, "norn help", "unknown_command");
    if (c) return rendered({ ...helpFor(c), for: commandFor(c.name) }, formatCommandHelp(c));
    const skills = bundledSkills(ctx.env);
    const all = opt.bool(args, "all");
    const hidden = new Set(HELP_GROUPS.filter((g) => g.hidden && !all).flatMap((g) => g.commands));
    const segment = { command: SEGMENT.name, summary: SEGMENT.summary, usage: SEGMENT.usage, options: SEGMENT.options, for: commandFor(SEGMENT.name) };
    const commands = [...COMMANDS.map((c) => ({ ...helpFor(c), for: commandFor(c.name) })), ...NOUNS.map((n) => ({ ...nounHelp(n), for: commandFor(n.name) })), segment].filter((c) => !hidden.has(c.command));
    return rendered(
      { commands, skills: skills.map((s) => ({ skill: s, for: skillFor(s) })) },
      formatHelp([...COMMANDS, ...NOUNS.map(nounRow), SEGMENT], skills, all),
    );
  },
});
