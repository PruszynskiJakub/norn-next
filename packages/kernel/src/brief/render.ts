/**
 * The brief an agent reads: which step it is at, what to read, how to report it once (`done` with
 * one of the step's outcomes, `ask`, `stuck`), the rules, and where its handoff lives. Pure and
 * harness-neutral, so every harness gets the same text and the CLI's `brief` prints exactly what a
 * launch sent.
 */
import type { Verdict } from "@norn/schema";
import type { BriefInputs } from "../model/actions.ts";

/** The commands an agent reports with; the CLI in front decides their spelling. */
export interface BriefCommands {
  brief: string;
  done: string;
  ask: string;
  stuck: string;
}

export const DEFAULT_BRIEF_COMMANDS: BriefCommands = Object.freeze({ brief: "norn brief", done: "norn done", ask: "norn ask", stuck: "norn stuck" });

/** A question an earlier session of the step asked and a person answered; the question is absent when the record lost it. */
export interface AnsweredAsk {
  question?: string;
  answer: string;
}

/**
 * An input as the host resolved it for the agent: where it reads it (a path relative to the worktree),
 * the text itself when it is short, or a note saying how to get it or that nothing is recorded.
 */
export interface BriefInputView {
  /** the workflow's name for it (`spec`, `last_check`) or the file it names */
  name: string;
  /** what it is, in a few words */
  label?: string;
  path?: string;
  /** shown in the brief itself */
  text?: string;
  note?: string;
}

/** The story the unit delivers, as its tracker item names it. */
export interface BriefStory {
  key: string;
  title: string;
  url?: string;
}

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
  /**
   * `done` comes with a criteria report (`criteria: required`, or an outcome gated by a verdict);
   * `verdict` maps an outcome to the worst verdict it may be reported with
   */
  criteria?: { required: boolean; verdict: Readonly<Record<string, Verdict>> };
  /** a person works in the session: questions go to them, and `done` waits for their agreement */
  attended?: boolean;
  /** answers given to earlier sessions of this step, which a fresh session would otherwise never see */
  answered?: readonly AnsweredAsk[];
  /** for a run that replaces a session which ended without a report: how that session ended, already rendered */
  retry?: string;
  /** a person's gate rulings on the story, one rendered line each */
  rulings?: readonly string[];
  /** what the unit's steps did this round, oldest first, one rendered line each */
  history?: readonly string[];
  /** the inputs as the host made them readable; absent: the bare names the step lists */
  inputs?: readonly BriefInputView[];
  /** a line under the inputs on how the host keeps their files (what it reads back, what git ignores) */
  inputsNote?: string;
  story?: BriefStory;
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

function fenced(text: string, indent: string): string[] {
  const body = text.trimEnd();
  // a fence longer than any backtick run inside keeps the text from closing it early
  const longest = Math.max(2, ...[...body.matchAll(/`+/g)].map((m) => m[0].length));
  const fence = "`".repeat(longest + 1);
  return [`${indent}${fence}`, ...body.split("\n").map((l) => (l ? `${indent}${l}` : "")), `${indent}${fence}`];
}

function inputViewLines(v: BriefInputView): string[] {
  const what = v.label ? ` — ${v.label}` : "";
  const where = v.path ? `: \`${v.path}\`` : "";
  const note = v.note ? `${v.path || v.label ? ". " : " — "}${v.note}` : "";
  const out = [`- \`${v.name}\`${what}${where}${note}`];
  if (v.text !== undefined && v.text.trim() !== "") out.push(...fenced(v.text, "  "));
  return out;
}

function skillLine(skills: readonly string[]): string {
  const named = skills.map((s) => `\`${s}\``);
  const list = named.length === 1 ? named[0] : `${named.slice(0, -1).join(", ")} and ${named.at(-1)}`;
  return `Use the ${list} skill${named.length === 1 ? "" : "s"}.`;
}

function answeredLines(answered: readonly AnsweredAsk[]): string[] {
  const indent = (t: string) => t.trim().replaceAll("\n", "\n  ");
  return answered.map((a) => (a.question ? `- Asked: ${indent(a.question)}\n  Answered: ${indent(a.answer)}` : `- Answered: ${indent(a.answer)}`));
}

const CRITERIA_FLAG = "--criteria <file>";

function criteriaLine(criteria: NonNullable<BriefRenderInput["criteria"]>): string {
  const gated = Object.entries(criteria.verdict).map(([o, v]) => `\`${o}\` only when it is \`${v}\``);
  const rule = gated.length > 0 ? ` The worst verdict decides the outcome (fail > unverified > person > pass): ${gated.join(", ")}.` : "";
  const need = criteria.required ? "This step requires" : "An outcome gated by a verdict requires";
  return `- ${need} \`${CRITERIA_FLAG}\`: a JSON array with one entry per acceptance criterion, \`{"id", "verdict", ...}\` (\`pass\` needs \`evidence\`, \`fail\` \`repro\`, \`person\` \`how\`, \`unverified\` \`reason\` and \`how\`), covering exactly the unit's frontmatter \`criteria\`.${rule} A report without it, or that contradicts it, is refused.`;
}

function finishLines(input: BriefRenderInput, c: BriefCommands): string[] {
  const out: string[] = [];
  const criteria = input.criteria;
  for (const o of input.outcomes) {
    const means = input.means?.[o];
    const flag = criteria && (criteria.required || criteria.verdict[o] !== undefined) ? ` ${CRITERIA_FLAG}` : "";
    out.push(`- \`${c.done} ${o}${flag}\`${means ? ` — ${means}` : ""}`);
  }
  if (criteria) out.push(criteriaLine(criteria));
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
  if (input.story) {
    const s = input.story;
    out.push("## Story", "", `\`${s.key}\`: ${s.title.trim() || "(untitled)"}${s.url ? ` (${s.url})` : ""}`, "");
  }
  out.push("## Your work", "");
  if (input.instructions) out.push(input.instructions.trim(), "");
  if (input.description) out.push(input.description.trim(), "");
  if (b.skills.length > 0) out.push(skillLine(b.skills), "");
  if (!input.instructions && !input.description && b.skills.length === 0) out.push(`Work step \`${b.step}\` of workflow \`${b.workflow}\`.`, "");
  if (input.retry)
    out.push(
      "## Retry",
      "",
      `A previous session of this attempt ended without reporting (${input.retry.trim()}). This is a fresh session: nothing it did counts as reported. Look at \`git status\`, \`git log\` and the handoff for partial work, then finish the step.`,
      "",
    );
  if (input.rework) out.push("## Rework", "", "This attempt reworks what was sent back. Address the points below first.", "", input.rework.trim(), "");
  if (input.answered && input.answered.length > 0)
    out.push(
      "## Answers already given",
      "",
      "An earlier session of this step asked a person and these are the answers; treat them as decided and do not ask again:",
      "",
      ...answeredLines(input.answered),
      "",
    );
  if (input.rulings && input.rulings.length > 0)
    out.push(
      "## Rulings",
      "",
      "A person ruled at a gate of this story. A ruling settles the question it answers, even where the spec still says otherwise: follow it and do not raise it again. It judged the code of its time, so it never makes a criterion `pass` on its own.",
      "",
      ...input.rulings.map((r) => `- ${r.trim().replaceAll("\n", "\n  ")}`),
      "",
    );
  if (input.inputs && input.inputs.length > 0) {
    out.push("## Inputs", "", "Read these before you change anything:", "", ...input.inputs.flatMap(inputViewLines), "");
    if (input.inputsNote) out.push(input.inputsNote.trim(), "");
  }
  else if (b.inputs.length > 0) out.push("## Inputs", "", "Read these before you change anything:", "", ...b.inputs.map(inputLine), "");
  if (input.handoff)
    out.push(
      "## Handoff",
      "",
      `\`${input.handoff}\` is this unit's current state, for the next agent and the person. Rewrite it in place, never as a diary, and refresh it right before you report.`,
      "",
    );
  if (input.history && input.history.length > 0) out.push("## History", "", "What this unit's steps did this round, oldest first:", "", ...input.history.map((l) => `- ${l}`), "");
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
