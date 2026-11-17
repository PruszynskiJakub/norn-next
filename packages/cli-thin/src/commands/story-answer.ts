/**
 * `norn story answer <key> <text>`: answer the question a story's agent asked.
 * Records an `answer.sent` receipt through the journal.
 */
import type { UnitJournal } from "@norn/kernel";
import type { RuntimeEnv } from "@norn/runtime";
import { defineCommand } from "../command.ts";
import type { CliContext } from "../context.ts";
import { failure, refuse, rendered, usageError } from "../output.ts";
import { ambiguous, readable, receiptId, stopParkId, unitsOf } from "./person-support.ts";

interface OpenQuestion {
  unit: UnitJournal;
  input_id: string;
  question: string;
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
  } catch {
    // a session that cannot be read shows no question; the record's own asks were read above
  }
  return null;
}

async function answer(ctx: CliContext, key: string, text: string) {
  const env = await ctx.runtimeEnv();
  const units = readable(await unitsOf(env, key), key);
  const open: OpenQuestion[] = [];
  for (const u of units) {
    const q = await openQuestion(env, u);
    if (q) open.push(q);
  }
  if (open.length === 0) throw refuse(`no agent of ${key} waits on an answer`, `norn story view ${key}`, "no_question");
  if (open.length > 1) ambiguous(`more than one unit of ${key} waits on an answer`, open.map((q) => q.unit.unit), (u) => `norn story answer ${u} "<answer>"`);
  const q = open[0] as OpenQuestion;
  const state = q.unit.state as NonNullable<UnitJournal["state"]>;
  const id = receiptId("answer", q.input_id);
  const wrote = await env.journal.record(q.unit.unit, {
    id,
    data: { kind: "answer.sent", input_id: q.input_id, text, by: env.config.holder, step: state.step, attempt: state.attempt },
  });
  if (!wrote.ok) throw failure(`cannot record the answer on ${q.unit.unit}: ${wrote.failure.message}`, `norn story answer ${key} again`, wrote.failure.code);
  const value = { unit: q.unit.unit, step: state.step, attempt: state.attempt, input_id: q.input_id, question: q.question, receipt_id: id, ...wrote.value };
  return rendered(value, `Answered ${q.unit.unit} at ${state.step}${wrote.value.replayed ? " (recorded before)" : ""}. The next tick delivers it to the agent.`);
}

export const storyAnswerCommand = defineCommand({
  name: "story answer",
  summary: "Answer the question a story's agent asked",
  usage: "norn story answer <key> <text>",
  positionals: { min: 2, max: 2 },
  restJoined: true,
  async run(ctx, args) {
    const [key, text] = args.positionals as [string, string];
    if (!text.trim()) throw usageError("an empty answer", 'norn story answer <key> "<answer>"');
    return answer(ctx, key, text.trim());
  },
});
