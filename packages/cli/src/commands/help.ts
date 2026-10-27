/**
 * `norn help`: the commands grouped for a person, "Start here" first; `--json` for the list as data.
 * An agent may run it too, so it says up front which commands an agent runs (the B3–B6 protocol)
 * and marks every command and bundled skill (§16) with who it is for.
 */
import type { Command } from "../command.ts";
import { defineCommand } from "../command.ts";
import { rendered } from "../output.ts";
import { bundledSkills } from "../runtime/workflows.ts";

/** Who runs a command: a person, the agent doing a step, or the agent's hooks (never by hand). */
export type CommandFor = "person" | "agent" | "hooks";

/** Help groups in print order; a command missing here lands in "Other" (for a person). */
export const HELP_GROUPS: ReadonlyArray<{ title: string; for: CommandFor; commands: readonly string[] }> = [
  { title: "Start here", for: "person", commands: ["init", "doctor", "sync", "watch", "inbox", "open"] },
  { title: "Answer what needs you", for: "person", commands: ["answer", "approve", "unstick", "update", "mode", "workflow"] },
  { title: "Look around", for: "person", commands: ["status", "trace", "why", "pane", "config", "tick"] },
  { title: "Team", for: "person", commands: ["take", "release", "drop"] },
  { title: "Housekeeping", for: "person", commands: ["tidy", "uninstall", "help"] },
  { title: "Agent protocol: the only commands an agent runs", for: "agent", commands: ["brief", "done", "ask", "stuck"] },
  { title: "Called by the agent's hooks, not by hand", for: "hooks", commands: ["hook"] },
];

/** How a bundled skill is used (§16): only an agent loads skills; some steps also need a person with it. */
export type SkillFor = "protocol" | "step" | "attended" | "reference";

/** Skill groups in print order; a skill missing here lands in "Other skills" (a step skill). */
export const SKILL_GROUPS: ReadonlyArray<{ title: string; for: SkillFor; skills: readonly string[] }> = [
  { title: "the protocol, loaded first in every step", for: "protocol", skills: ["norn"] },
  { title: "step skills, the agent works alone", for: "step", skills: ["norn-implement", "norn-review", "norn-qa", "norn-merge", "norn-slice", "norn-pr", "norn-diagnose"] },
  { title: "step skills, a person works with the agent", for: "attended", skills: ["norn-refine", "norn-clarify", "norn-plan", "norn-interview", "norn-qa-person", "norn-prototype"] },
  { title: "references other skills read, never a step", for: "reference", skills: ["norn-tdd", "norn-codebase-design"] },
];

/** Printed right under the title: an agent that runs `norn help` must not take the person's commands for its own. */
export const AGENT_NOTE = [
  "Agent doing a norn step? Run only `norn brief`, then report once with `norn done`, `norn ask` or `norn stuck`",
  "(the `norn` skill says how). Every other command is the person's: run one only when the person asks you to directly.",
];

/** Spec ids such as `(A1, SK1, W1)` or `(§9.3)` mean nothing to a newcomer; the JSON keeps them. */
export const plainSummary = (summary: string): string =>
  summary.replace(/\s*\((?:(?:§[\d.]+|[A-Z]{1,3}\d+(?:\.\d+)?[a-z]?)(?:[–-][A-Z]{0,3}\d+)?(?:,\s*)?)+\)/g, "");

export const commandFor = (name: string): CommandFor => HELP_GROUPS.find((g) => g.commands.includes(name))?.for ?? "person";

export const skillFor = (name: string): SkillFor => SKILL_GROUPS.find((g) => g.skills.includes(name))?.for ?? "step";

export function formatHelp(commands: readonly Command[], skills: readonly string[] = []): string {
  const width = Math.max(...commands.map((c) => c.name.length)) + 2;
  const row = (c: Command) => `  norn ${c.name.padEnd(width)}${plainSummary(c.summary)}`;
  const grouped = new Set(HELP_GROUPS.flatMap((g) => g.commands));
  const other = { title: "Other", commands: commands.map((c) => c.name).filter((n) => !grouped.has(n)) };
  const groups = [...HELP_GROUPS.slice(0, -2), other, ...HELP_GROUPS.slice(-2)];
  const out = ["norn — deliver software stories with coding agents; code decides the next step, agents do it.", "", ...AGENT_NOTE, ""];
  for (const g of groups) {
    const cs = g.commands.flatMap((n) => commands.filter((c) => c.name === n));
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

export function formatCommandHelp(c: Command): string {
  const note = commandFor(c.name) === "person" ? "\n\nFor the person; an agent runs it only when the person asks it to." : "";
  return `norn ${c.name} — ${plainSummary(c.summary)}\n\n    ${c.usage}${note}`;
}

export const helpCommand = defineCommand({
  name: "help",
  summary: "List commands, and who runs each: a person or the agent",
  usage: "norn help [command]",
  positionals: { max: 1 },
  markdown: true,
  repo: false,
  async run(ctx, args) {
    // imported lazily: the registry imports this file
    const { COMMANDS, findCommand } = await import("./index.ts");
    const { helpFor } = await import("../cli.ts");
    const name = args.positionals[0];
    const c = name ? findCommand(name) : undefined;
    if (c) return rendered({ ...helpFor(c), for: commandFor(c.name) }, formatCommandHelp(c));
    const skills = bundledSkills(ctx.env);
    return rendered(
      { commands: COMMANDS.map((c) => ({ ...helpFor(c), for: commandFor(c.name) })), skills: skills.map((s) => ({ skill: s, for: skillFor(s) })) },
      formatHelp(COMMANDS, skills),
    );
  },
});
