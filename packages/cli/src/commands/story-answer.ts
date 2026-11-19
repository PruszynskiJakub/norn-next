/**
 * `norn story answer <key> <text>`: answer the question a story's agent asked, or the dialog its pane
 * shows (a permission prompt, or the trust prompt that keeps a silent run's hooks from loading).
 * Records an `answer.sent` receipt through the journal, or sends it to the machine holding the story
 * through the mailbox (decision-route). A dialog's answer is recorded `to: dialog`, so the tick
 * presses the keys the harness names for it instead of typing it to the agent; an executor that
 * cannot press keys in a pane, or an answer the dialog takes no key for, is refused before anything
 * is recorded.
 */
import type { UnitJournal } from "@norn/kernel";
import { dialogInputId, type RuntimeEnv } from "@norn/runtime";
import { defineCommand } from "../command.ts";
import type { CliContext } from "../context.ts";
import { refuse, rendered, usageError } from "../output.ts";
import { deliverDecision, deliveredLine, routeDecision } from "./decision-route.ts";
import { ambiguous, readable, receiptId, stopParkId, syncStore, unitsOf } from "./person-support.ts";

interface OpenQuestion {
  unit: UnitJournal;
  input_id: string;
  question: string;
  /** a dialog in the agent's pane, answered with keys */
  dialog?: true;
}

const answeredAfter = (u: UnitJournal, seq: number): boolean => u.receipts.some((r) => r.data.kind === "answer.sent" && r.seq > seq);

/**
 * What the unit's live run waits on a person for: an ask it reported, a question its session shows,
 * or a stop a person ordered. Each is named by the id the answer carries, so it is answered once.
 */
async function openQuestion(env: RuntimeEnv, u: UnitJournal): Promise<OpenQuestion | null> {
  const state = u.state;
  const run = state?.run;
  if (!state || state.ended !== undefined || !run) return null;
  const rejected = new Set(u.receipts.flatMap((r) => (r.data.kind === "receipt.rejected" ? [r.data.seq] : [])));
  const ask = u.receipts.findLast((r) => r.data.kind === "run.reported" && r.data.run_id === run.id && r.data.verb === "ask" && !rejected.has(r.seq));
  if (ask?.data.kind === "run.reported" && !answeredAfter(u, ask.seq)) return { unit: u, input_id: ask.id, question: ask.data.text ?? "" };
  const stop = u.receipts.find((r) => r.id === stopParkId(run.id));
  if (stop && !answeredAfter(u, stop.seq)) return { unit: u, input_id: stop.id, question: state.parked?.reason ?? "the run was stopped" };
  try {
    const session = await env.sessions.facts(u.unit, run.id, run.session);
    if (session?.ask) return { unit: u, input_id: session.ask.id, question: session.ask.question };
    const permission = session?.permission;
    if (permission) return { unit: u, input_id: dialogInputId(permission, run.id), question: permission.call ? `${permission.call.tool}: ${permission.prompt}` : permission.prompt, dialog: true };
    // no event yet, and decide parked it for the dialog its pane most likely shows
    if (session === null && state.parked?.reason === "agent.no_events.park") return { unit: u, input_id: dialogInputId(null, run.id), question: "the dialog in its pane (most likely a trust prompt)", dialog: true };
  } catch {
    // a session that cannot be read shows no question; the record's own asks were read above
  }
  return null;
}

/** A dialog is answered only by keys its executor can press and its harness names for the answer. */
function checkDialog(env: RuntimeEnv, q: OpenQuestion, text: string): void {
  const run = q.unit.state?.run;
  if (!q.dialog || !run) return;
  const rerun = `answer it in the agent's pane, or start the step again with norn run rerun ${q.unit.unit}`;
  if (env.launcher.modesOf?.(run.executor)?.dialogKeys !== true) throw refuse(`${q.unit.unit}'s executor '${run.executor}' cannot answer a dialog in its pane`, rerun, "dialog_unanswerable");
  if (!env.slots.executors[run.executor]?.dialogKeys?.(text))
    throw refuse(`the dialog takes no ${JSON.stringify(text)}: answer with an option's number, yes or no`, `norn story answer ${q.unit.unit} 1`, "not_an_option");
}

async function answer(ctx: CliContext, key: string, text: string) {
  const env = await ctx.runtimeEnv();
  const retry = `norn story answer ${key}`;
  await syncStore(env, key, retry);
  const units = readable(await unitsOf(env, key), key);
  const open: OpenQuestion[] = [];
  for (const u of units) {
    const q = await openQuestion(env, u);
    if (q) open.push(q);
  }
  if (open.length === 0) throw refuse(`no agent of ${key} waits on an answer`, `norn story view ${key}`, "no_question");
  if (open.length > 1) ambiguous(`more than one unit of ${key} waits on an answer`, open.map((q) => q.unit.unit), (u) => `norn story answer ${u} "<answer>"`);
  const q = open[0] as OpenQuestion;
  checkDialog(env, q, text);
  const state = q.unit.state as NonNullable<UnitJournal["state"]>;
  const id = receiptId("answer", q.input_id);
  const route = await routeDecision(env, key.split("/")[0] as string, retry);
  const data = { kind: "answer.sent" as const, input_id: q.input_id, text, by: env.config.holder, ...(q.dialog && { to: "dialog" as const }), step: state.step, attempt: state.attempt };
  const sent = await deliverDecision(env, route, q.unit.unit, { id, data }, retry);
  const value = { unit: q.unit.unit, step: state.step, attempt: state.attempt, input_id: q.input_id, question: q.question, receipt_id: id, ...sent };
  const again = sent.replayed ? " (recorded before)" : "";
  const delivers = q.dialog ? "presses its keys in the agent's pane" : "delivers it to the agent";
  const line = sent.via === "local" ? `Answered ${q.unit.unit} at ${state.step}${again}. The next tick ${delivers}.` : deliveredLine(sent, `the answer to ${q.unit.unit} at ${state.step}`);
  return rendered(value, line);
}

export const storyAnswerCommand = defineCommand({
  name: "story answer",
  summary: "Answer the question a story's agent asked, or the permission or trust prompt in its pane",
  usage: "norn story answer <key> <text>   (a prompt in the pane: an option's number, yes or no)",
  positionals: { min: 2, max: 2 },
  restJoined: true,
  async run(ctx, args) {
    const [key, text] = args.positionals as [string, string];
    if (!text.trim()) throw usageError("an empty answer", 'norn story answer <key> "<answer>"');
    return answer(ctx, key, text.trim());
  },
});
