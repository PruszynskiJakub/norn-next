/**
 * The brief an agent reads: which step it is at, what to read, how to report it once (`done` with
 * one of the step's outcomes, `ask`, `stuck`), the rules, and where its handoff lives. Pure and
 * harness-neutral, so every harness gets the same text and the CLI's `brief` prints exactly what a
 * launch sent.
 */
import type { BriefInputs } from "../model/actions.ts";

/** The commands an agent reports with; the CLI in front decides their spelling. */
export interface BriefCommands {
  brief: string;
  done: string;
  ask: string;
  stuck: string;
}

export const DEFAULT_BRIEF_COMMANDS: BriefCommands = Object.freeze({ brief: "norn brief", done: "norn done", ask: "norn ask", stuck: "norn stuck" });

export interface BriefRenderInput {
  brief: BriefInputs;
  /** `gh-12` or `gh-12/03` */
  unit: string;
  /** the outcomes `done` may report at this step, in the order the workflow lists them */
  outcomes: string[];
  /** the unit's handoff file, relative to its worktree, when the workflow keeps one */
  handoff?: string;
  /** the rework a red check or a reject asks for, already rendered (the check's output tail, findings) */
  rework?: string;
  commands?: BriefCommands;
  /** the step's orientation (its `agent:` text) */
  instructions?: string;
  description?: string;
  /** what each outcome means, as the workflow's `means:` says it */
  means?: Readonly<Record<string, string>>;
  /** a person works in the session: questions go to them, and `done` waits for their agreement */
  attended?: boolean;
}

/** What a hook's stop block and a nudge say about reporting: the one line every harness repeats. */
export interface ReportHintInput {
  unit: string;
  step: string;
  outcomes: readonly string[];
  attended?: boolean;
  commands?: BriefCommands;
}

function doneCommand(c: BriefCommands, outcomes: readonly string[]): string {
  return outcomes.length > 0 ? `${c.done} <${outcomes.join("|")}>` : c.done;
}

function reportWays(input: ReportHintInput, c: BriefCommands): string {
  const done = `\`${doneCommand(c, input.outcomes)}\``;
  return input.attended ? `${done} once the person agrees the work is finished, or \`${c.stuck} "<reason>"\`` : `${done}, \`${c.ask} "<question>"\` or \`${c.stuck} "<reason>"\``;
}

/** One sentence: how to end the step, for a stop block's reason. */
export function renderReportHint(input: ReportHintInput): string {
  const c = input.commands ?? DEFAULT_BRIEF_COMMANDS;
  return `norn: step ${input.step} of ${input.unit} has no report for this run. Before ending your turn, report exactly once: ${reportWays(input, c)}. Run \`${c.brief}\` to see what each outcome means.`;
}

/** What a session that lost its brief (a resume, a compaction) is told again. */
export function renderStepReminder(input: ReportHintInput): string {
  const c = input.commands ?? DEFAULT_BRIEF_COMMANDS;
  return `norn: this session works step ${input.step} of ${input.unit}. Report exactly once: ${reportWays(input, c)}. Run \`${c.brief}\` for the rest.`;
}

const RULES: readonly string[] = [
  "Work only in this worktree and only on this step: nothing that belongs to later work, no drive-by changes.",
  "Never `git push`, never switch branches or worktrees, and never change the remote (a pull request, an issue, a comment): only norn does, under a receipt.",
  "Never edit norn's run state (its data folder outside the worktree): a hand-edited file fails validation and makes the unit corrupt.",
  "Of the norn commands, run only the four this brief names; every other one is the person's.",
  "A subagent you start works under these rules though it never sees this brief: tell it the ones its work can break.",
  "A usage limit is not a reason to report stuck: it resets on its own, and the session continues after it.",
];

function inputLine(input: BriefInputs["inputs"][number]): string {
  if (typeof input === "string") return `- \`${input}\``;
  return input.label ? `- ${input.label}: \`${input.file}\`` : `- \`${input.file}\``;
}

function skillLine(skills: readonly string[]): string {
  const named = skills.map((s) => `\`${s}\``);
  const list = named.length === 1 ? named[0] : `${named.slice(0, -1).join(", ")} and ${named.at(-1)}`;
  return `Use the ${list} skill${named.length === 1 ? "" : "s"}.`;
}

function finishLines(input: BriefRenderInput, c: BriefCommands): string[] {
  const out: string[] = [];
  for (const o of input.outcomes) {
    const means = input.means?.[o];
    out.push(`- \`${c.done} ${o}\`${means ? ` — ${means}` : ""}`);
  }
  if (input.outcomes.length === 0) out.push(`- \`${c.done}\` — the step's work is finished`);
  if (input.attended) out.push("- A question goes to the person in this session, never through `" + c.ask + "`.");
  else out.push(`- \`${c.ask} "<one self-contained question>"\` — you need a person's decision; the step waits until it is answered.`);
  out.push(`- \`${c.stuck} "<reason>"\` — you cannot go on; say what would unblock it.`);
  return out;
}

/** Markdown. Deterministic: the same input renders the same text, byte for byte. */
export function renderBrief(input: BriefRenderInput): string {
  const c = input.commands ?? DEFAULT_BRIEF_COMMANDS;
  const b = input.brief;
  const out: string[] = [];
  out.push(`# norn brief — ${input.unit} · ${b.step} #${b.attempt}`, "");
  out.push("You do one step of a larger delivery and report how it ended, once; code decides what happens next.", "");
  out.push("## Where you run", "");
  out.push(
    input.attended
      ? "- A person works with you in this session: ask them here, and report `done` only once they agree the work is finished."
      : `- You run unattended: no person reads this session. A question goes through \`${c.ask}\`, which parks the step until a person answers it.`,
    "",
  );
  out.push("## Your work", "");
  if (input.instructions) out.push(input.instructions.trim(), "");
  if (input.description) out.push(input.description.trim(), "");
  if (b.skills.length > 0) out.push(skillLine(b.skills), "");
  if (!input.instructions && !input.description && b.skills.length === 0) out.push(`Work step \`${b.step}\` of workflow \`${b.workflow}\`.`, "");
  if (input.rework) out.push("## Rework", "", "This attempt reworks what was sent back. Address the points below first.", "", input.rework.trim(), "");
  if (b.inputs.length > 0) out.push("## Inputs", "", "Read these before you change anything:", "", ...b.inputs.map(inputLine), "");
  if (input.handoff)
    out.push(
      "## Handoff",
      "",
      `\`${input.handoff}\` is this unit's current state, for the next agent and the person. Rewrite it in place, never as a diary, and refresh it right before you report.`,
      "",
    );
  out.push("## Rules", "", ...RULES.map((r) => `- ${r}`), "");
  out.push("## Finish with exactly one of", "", ...finishLines(input, c), "");
  out.push(
    "Report exactly once, from the worktree root, with the outcome whose meaning is true. A refused report says what to do instead: do exactly that, then report again. After a report succeeds, end your turn.",
    "",
    `After a long session or a lost thread, run \`${c.brief}\` again: it is rendered from the unit's record each time.`,
    "",
  );
  return out.join("\n");
}
