/**
 * `norn run view <run|unit>` (B44): one run of a unit from @norn/view — its step row: step,
 * attempt, outcome, durations, who, reason, receipts; a unit key means its latest run.
 *
 * `norn run view <unit> --why [--tick <id>] [--step <s>] [--attempt <n>] [--transition <step>.<outcome>] [--rule <prefix>]`
 * (B45, O5, H3; what `why` was, JSON unchanged, B70): explain a tick's decision for a unit by replaying the pure `decide` on the facts
 * snapshot, workflows and config recorded in the trace, showing the rule that fired, what
 * triggered it — the receipt applied (with its reason text: handoff, comment, check output) or the
 * fact the rule read — and verifying the replay equals the recorded decision. A mismatch exits 1
 * (decide was not pure, or the trace was edited). A tick recorded by another norn version
 * (`norn_version` on the trace) is still replayed and diffed with this one's decide, and the replay
 * is labelled `recorded by norn <X>` — a mismatch there may just be a rule that changed between
 * versions; the exit code is the same either way.
 *
 * Without `--tick` the matching ticks are found automatically: by default the latest decision for
 * the unit; with `--step` / `--attempt` / `--transition` / `--rule` every decision that matches
 * (noops excluded unless `--rule` names them), newest explained, all listed under `matches`.
 * Intake decisions are keyed by the story (F5), so `norn run view gh-1 --why --rule remote.intake` covers them.
 * `--receipt <id>` (NT2: the command of a note's inbox item) picks the decision that applied that
 * receipt (the unit may be left out: it is the one whose decision applied it); its reason text
 * lists the report's criteria not passed and its notes.
 *
 * R5.4 (N2): a tick with a `tick.start` but no end died during act. `--why` explains it from its
 * recorded decisions ("tick crashed during act") — `--tick <id>` resolves the tick a receipt cites,
 * and without `--tick` a crashed tick newer than the unit's last finished one is the one explained.
 *
 * O7, D10 (B20): `--tick <id>` for a tick not in the trace whose ulid time is older than the retention
 * window and whose day file is gone is refused as `tick_pruned`, never guessed at.
 */
import { cmd, criterionLine, decide, type Decision, legacyAction, type NumberedReceipt, type StoryFacts, type UnitFacts, unitDecision } from "@norn/core";
import { ExitCode, isUlid, type Receipt, storyOf, type TickStartTrace, type TickTrace, type TickUnitRecord, ULID_PATTERN, ulidTime } from "@norn/schema";
import { crashedTicksFor, decisionUnit, findCrashedTick, findTick, hasTraceDay, readTrace, type TickReader, tickReader } from "@norn/store";
import { formatRunView, loadRunView } from "@norn/view";
import { defineCommand, opt, type ParsedArgs } from "../command.ts";
import type { Context } from "../context.ts";
import { corruptError, refuse, rendered, usageError, withExit } from "../output.ts";
import { parseUnitKey } from "../runtime/args.ts";
import { hasRun, targetKey } from "../runtime/target.ts";
import { effectiveRetain } from "../runtime/trace-retention.ts";
import { NORN_VERSION } from "../version.ts";

/** An action as compared with its replay; one an older norn recorded drops the fields since removed (O5). */
const canon = (v: unknown) => JSON.stringify(JSON.parse(JSON.stringify(legacyAction(v ?? null))));

interface Filter {
  step?: string;
  attempt?: number;
  transition?: { step: string; outcome: string };
  rule?: string;
  /** NT2: the decision that applied this receipt (the note item's command) */
  receipt?: string;
}

/** What made a rule fire: a receipt (with its reason text) or a fact. */
export interface Trigger {
  source: "receipt" | "fact";
  kind: string;
  step?: string;
  attempt?: number;
  outcome?: string;
  by?: string;
  at?: string;
  /** receipt file as observed */
  file?: string;
  /** the reason in its own words: handoff, comment, check output tail, classify detail, question, … */
  reason: string | null;
}

const outcomeOf = (r: Receipt): string | undefined => ("outcome" in r ? r.outcome : r.kind === "approve" || r.kind === "reject" ? r.kind : undefined);

function reasonOf(r: Receipt): string | null {
  switch (r.kind) {
    case "done": {
      const findings = r.findings?.length ? `\n\nFindings:\n${r.findings.map((f, i) => `${i + 1}. [${f.severity}] ${f.title}${f.detail ? ` — ${f.detail}` : ""}`).join("\n")}` : "";
      const evidence = r.evidence ? `\n\nEvidence: ${r.evidence}` : "";
      // QV2, NT1: the verdicts not passed and the notes for a person
      const open = r.criteria?.filter((c) => c.verdict !== "pass") ?? [];
      const criteria = r.criteria ? `\n\nCriteria: ${r.criteria.length - open.length}/${r.criteria.length} pass${open.length ? `\n${open.map((c) => `- ${criterionLine(c)}${c.repro ? ` — repro: ${c.repro}` : ""}`).join("\n")}` : ""}` : "";
      const notes = r.notes?.length ? `\n\nNotes for a person:\n${r.notes.map((n, i) => `${i + 1}. ${n.criterion ? `(${n.criterion}) ` : ""}${n.text}`).join("\n")}` : "";
      // BS5: the base merge norn verified at `norn done`
      const bm = r.base_merge;
      const merged = bm ? `\n\nBase merged: ${bm.sha}${bm.merge ? ` by merge commit ${bm.merge}` : ""}, head ${bm.head}` : "";
      return `${r.handoff}${findings}${evidence}${criteria}${notes}${merged}`;
    }
    case "check":
      return `${r.command} → ${r.reason === "timeout" ? "timeout" : `exit ${r.exit_code}`}${r.log ? ` (log ${r.log})` : ""}\n${r.output_tail.split("\n").slice(-40).join("\n")}`.trimEnd();
    case "classify":
      return r.detail ?? `${r.outcome} by ${r.rule} → ${r.route}`;
    case "approve":
    case "reject":
      return r.comment?.trim() || null;
    case "answer":
      return r.answer;
    case "ask": {
      // L1 (A7): the full pane screen of an implicit ask is shown here, not in inbox titles
      const parts = [r.question];
      if (r.command) parts.push(`pending command: ${r.command}`);
      if (r.options?.length) parts.push(`options: ${r.options.map((o, i) => `${i + 1}. ${o}`).join(" · ")}`);
      if (r.screen) parts.push(`screen:\n${r.screen}`);
      return parts.join("\n");
    }
    case "stuck":
      return r.reason;
    case "unstick":
      return r.comment ?? (r.to ? `to ${r.to}` : null);
    case "mode":
      return `${r.previous} → ${r.mode}`;
    case "workflow":
      return `${r.name} at ${r.to}`;
    case "started":
      return `${r.how}${r.agent ? ` ${r.agent}` : ""}${r.retry ? " (retry)" : ""}`;
    case "take":
      return r.previous_holder ? `taken from ${r.previous_holder}${r.forced ? " (forced)" : r.expired ? " (expired claim)" : ""}` : "taken (claim was free)";
    case "update":
      return `update from ${r.from} to ${r.to} (${r.reason})`;
  }
}

function receiptTrigger(nr: { file?: string; receipt: Receipt }): Trigger {
  const r = nr.receipt;
  const outcome = outcomeOf(r);
  return {
    source: "receipt",
    kind: r.kind,
    step: r.step,
    attempt: r.attempt,
    ...(outcome ? { outcome } : {}),
    by: r.who ?? r.by,
    at: r.at,
    ...(nr.file ? { file: nr.file } : {}),
    reason: reasonOf(r),
  };
}

/** Receipts a decision consumed or wrote: applied unapplied ones, and the ones decide numbered (classify, check). */
function receiptsOf(d: TickUnitRecord, uf: UnitFacts | undefined): Array<{ file?: string; receipt: Receipt }> {
  const a = d.action as { kind: string; applied?: number[]; receipts?: Array<{ n: number; receipt: Receipt }> };
  const out: Array<{ file?: string; receipt: Receipt }> = [];
  if (a.applied) for (const r of uf?.unapplied ?? []) if (a.applied.includes(r.n)) out.push(r as NumberedReceipt);
  for (const r of a.receipts ?? []) if (r.receipt.kind !== "started") out.push({ receipt: r.receipt });
  return out;
}

function triggerOf(d: TickUnitRecord, uf: UnitFacts | undefined): Trigger {
  const rs = receiptsOf(d, uf);
  const main = rs.findLast((r) => r.receipt.kind !== "started" && r.receipt.kind !== "mode") ?? rs.at(-1);
  if (main) return receiptTrigger(main);
  const a = d.action as { kind: string; reason?: string; issue?: { url?: string; title?: string; number?: number }; item?: { title?: string } };
  if (a.kind === "intake_story" && a.issue) return { source: "fact", kind: "remote_issue", reason: `issue #${a.issue.number} ${a.issue.title ?? ""} (${a.issue.url ?? ""}) is open, assigned and labelled` };
  return { source: "fact", kind: d.rule, reason: a.reason ?? a.item?.title ?? null };
}

function unitIn(reader: TickReader, tick: TickTrace, story: string, key: string): { sf?: StoryFacts; uf?: UnitFacts } {
  const read = reader.inputs(tick);
  const sf = read.ok ? read.inputs.facts.stories.find((s) => s.key === story) : undefined;
  return { sf, uf: sf?.units.find((u) => u.unit.key === key) };
}

function matches(d: TickUnitRecord, uf: UnitFacts | undefined, f: Filter): boolean {
  if (f.rule && !d.rule.startsWith(f.rule)) return false;
  if (f.receipt && !receiptsOf(d, uf).some((r) => r.receipt.receipt_id === f.receipt)) return false;
  if (!f.rule && (d.action.kind === "noop" || d.rule === "claim.renew") && (f.step || f.attempt !== undefined || f.transition)) return false;
  const rs = receiptsOf(d, uf).map((r) => r.receipt);
  const st = uf?.state;
  if (f.step && !(rs.some((r) => r.step === f.step) || (!rs.length && st?.step === f.step))) return false;
  if (f.attempt !== undefined && !(rs.some((r) => r.attempt === f.attempt && (!f.step || r.step === f.step)) || (!rs.length && st?.attempt === f.attempt))) return false;
  if (f.transition) {
    const t = f.transition;
    const adv = (d.action as { advance?: { from: string; outcome: string } | null }).advance;
    if (!(rs.some((r) => r.step === t.step && outcomeOf(r) === t.outcome) || (adv?.from === t.step && adv.outcome === t.outcome))) return false;
  }
  return true;
}

function parseFilter(args: Parameters<typeof opt.str>[0]): Filter {
  const f: Filter = {};
  const step = opt.str(args, "step");
  if (step) f.step = step;
  const attempt = opt.str(args, "attempt");
  if (attempt !== undefined) {
    if (!/^[1-9]\d*$/.test(attempt)) throw usageError(`--attempt must be a positive number, not '${attempt}'`, "norn run view <unit> --why --step implement --attempt 2");
    f.attempt = Number(attempt);
  }
  const tr = opt.str(args, "transition");
  if (tr !== undefined) {
    const i = tr.lastIndexOf(".");
    if (i <= 0 || i === tr.length - 1) throw usageError(`--transition must be <step>.<outcome>, not '${tr}'`, "norn run view <unit> --why --transition qa.fail");
    f.transition = { step: tr.slice(0, i), outcome: tr.slice(i + 1) };
  }
  const rule = opt.str(args, "rule");
  if (rule) f.rule = rule;
  const receipt = opt.str(args, "receipt");
  if (receipt !== undefined) {
    if (!new RegExp(ULID_PATTERN).test(receipt)) throw usageError(`--receipt must be a receipt id (ULID), not '${receipt}'`, cmd.status());
    f.receipt = receipt;
  }
  return f;
}

/** R5.4: explain a tick that died during act from its `tick.start` decisions (no results, no replay). */
function crashedExplanation(tick: TickStartTrace, key: string) {
  const d = unitDecision(tick.decisions, key, decisionUnit);
  if (!d) throw refuse(`tick ${tick.tick_id} decided nothing for ${key}`, cmd.runList(key), "no_decision");
  const record: TickUnitRecord = { unit: d.unit, rule: d.rule, action: d.action, result: { ok: false } };
  const a = d.action as { kind: string; reason?: string; receipts?: Array<{ n: number; receipt: Receipt }> };
  return {
    unit: key,
    tick_id: tick.tick_id,
    at: tick.at,
    rule: d.rule,
    action: a.kind,
    ...(a.reason ? { reason: a.reason } : {}),
    crashed: true,
    explanation: "tick crashed during act: it decided this but never recorded a result (no tick.end); receipts it numbered may exist without the state that applies them",
    trigger: triggerOf(record, undefined),
    result: null,
    // the receipts this decision numbered — the ones that cite this tick
    receipts: (a.receipts ?? []).map((r) => ({ n: r.n, kind: r.receipt.kind, receipt_id: r.receipt.receipt_id, ...(r.receipt.run_id ? { run_id: r.receipt.run_id } : {}) })),
    decision: d.action,
    replay: null,
  };
}

/** NT2: the unit of the decision that applied a receipt, for `--receipt` without a unit. */
function unitOfReceipt(root: string, reader: TickReader, receiptId: string): string | null {
  const { events } = readTrace(root, { types: ["tick"] });
  for (const ev of (events as TickTrace[]).toReversed())
    for (const d of ev.decisions) {
      const key = decisionUnit(d);
      if (key === "*") continue;
      if (receiptsOf(d, unitIn(reader, ev, storyOf(key), key).uf).some((r) => r.receipt.receipt_id === receiptId)) return key;
    }
  return null;
}

/** O5: `run view --why` / `--receipt`, what `why` was. */
async function why(ctx: Context, args: ParsedArgs) {
  const filter = parseFilter(args);
  if (!args.positionals[0] && !filter.receipt) throw usageError("run view --why: expected a unit", cmd.runView(undefined, { why: true }));
  const reader = tickReader(ctx.root);
  const raw = args.positionals[0] ?? (filter.receipt ? unitOfReceipt(ctx.root, reader, filter.receipt) : null);
  if (!raw) throw refuse(`no tick in the trace applied receipt ${filter.receipt}`, cmd.status({ notes: true }), "no_tick");
  const { key, story } = parseUnitKey(raw);
  const tickId = opt.str(args, "tick");
  const filtered = Object.keys(filter).length > 0;

  // every (tick, decision) for the unit that passes the filter, oldest first
  let found: Array<{ tick: TickTrace; d: TickUnitRecord }>;
  if (tickId) {
    const tick = findTick(ctx.root, tickId);
    if (!tick) {
      const crashed = findCrashedTick(ctx.root, tickId);
      if (crashed) return crashedExplanation(crashed, key);
      // D10: older than the window and its day is gone → tidy pruned it (B20)
      if (isUlid(tickId)) {
        const window = effectiveRetain(ctx.config);
        const at = ulidTime(tickId);
        if (at < ctx.clock.now() - window.ms && !hasTraceDay(ctx.root, new Date(at).toISOString()))
          throw refuse(`tick ${tickId} is older than the trace retained (${window.retain})`, cmd.runList(key), "tick_pruned");
      }
      throw refuse(`no tick ${tickId} in the trace`, cmd.runList(key), "no_tick");
    }
    const d = unitDecision(tick.decisions, key, decisionUnit);
    if (!d) throw refuse(`tick ${tick.tick_id} decided nothing for ${key}`, cmd.runList(key), "no_decision");
    found = [{ tick, d }];
  } else {
    const { events } = readTrace(ctx.root, { unit: key, types: ["tick"] });
    found = [];
    for (const ev of events as TickTrace[]) {
      // R1.1: by default the unit's own action, not the claim renewal riding along; a filter may pick either
      const d = filtered
        ? ev.decisions.filter((x) => decisionUnit(x) === key).find((x) => matches(x, unitIn(reader, ev, story, key).uf, filter))
        : unitDecision(ev.decisions, key, decisionUnit);
      if (d) found.push({ tick: ev, d });
    }
    // R5.4: a newer tick that died during act is the one to explain
    const crashed = filtered ? undefined : crashedTicksFor(ctx.root, key).at(-1);
    if (crashed && (!found.length || crashed.at >= (found.at(-1) as { tick: TickTrace }).tick.at)) return crashedExplanation(crashed, key);
    if (!found.length)
      throw refuse(
        filtered ? `no tick in the trace matches ${JSON.stringify(filter)} for ${key}` : `no tick in the trace decided anything for ${key}`,
        filtered ? cmd.runList(key) : cmd.tick(),
        "no_tick",
      );
  }
  const { tick, d: recorded } = found.at(-1) as { tick: TickTrace; d: TickUnitRecord };
  const read = reader.inputs(tick);
  // D10 (B21, S2): a chunk the tick names is missing; nothing is replayed from a partial snapshot
  if (!read.ok && read.reason === "corrupt") throw corruptError(`trace entry of tick ${tick.tick_id} is corrupt: ${read.error.errors[0]?.message}`, cmd.runList(key), [read.error], "trace_corrupt");
  if (!read.ok) throw refuse(`tick ${tick.tick_id} has no replay block (recorded by an older norn)`, cmd.runList(key), "no_replay");
  const { inputs } = read;

  let replayed: Decision[];
  try {
    replayed = decide(inputs.facts, inputs.workflows, inputs.config);
  } catch (e) {
    throw refuse(`replay of tick ${tick.tick_id} failed: ${(e as Error).message}`, cmd.runList(key), "replay_failed");
  }
  const mine = replayed.find((d) => d.unit === key && d.rule === recorded.rule) ?? unitDecision(replayed, key);
  const same = !!mine && mine.rule === recorded.rule && canon(mine.action) === canon(recorded.action);
  const allMatch =
    replayed.length === tick.decisions.length &&
    replayed.every((d, i) => d.unit === (tick.decisions[i] ? decisionUnit(tick.decisions[i]) : undefined) && d.rule === tick.decisions[i]?.rule && canon(d.action) === canon(tick.decisions[i]?.action));

  const sf = inputs.facts.stories.find((s) => s.key === story);
  const uf = sf?.units.find((u) => u.unit.key === key);
  const st = uf?.state ?? null;
  const action = recorded.action as { kind?: string; reason?: string };
  const out = {
    unit: key,
    tick_id: tick.tick_id,
    at: tick.at,
    rule: recorded.rule,
    action: action.kind ?? null,
    ...(action.reason ? { reason: action.reason } : {}),
    trigger: triggerOf(recorded, uf),
    result: recorded.result,
    facts: {
      claim: sf?.claim.state ?? null,
      status: st?.status ?? (uf ? "not_started" : null),
      step: st?.step ?? null,
      attempt: st?.attempt ?? null,
      park: st?.park ?? null,
      counters: st?.counters ?? {},
      unapplied: uf?.unapplied.map((r) => `${String(r.n).padStart(4, "0")}-${r.receipt.kind}`) ?? [],
      errors: uf?.errors ?? [],
    },
    decision: recorded.action,
    replay: {
      matches: same,
      all_match: allMatch,
      rule: mine?.rule ?? null,
      ...(same ? {} : { action: mine?.action ?? null }),
      // O5: decide may have changed since; say whose decision the replay is compared with
      ...(tick.norn_version && tick.norn_version !== NORN_VERSION ? { label: `recorded by norn ${tick.norn_version}, replayed by norn ${NORN_VERSION}` } : {}),
    },
    ...(filtered && !tickId
      ? {
          matches: found.map(({ tick: t, d }) => {
            const tr = triggerOf(d, unitIn(reader, t, story, key).uf);
            return { tick_id: t.tick_id, at: t.at, rule: d.rule, action: d.action.kind, trigger: tr.source === "receipt" ? `${tr.kind}${tr.outcome && tr.outcome !== tr.kind ? ` ${tr.outcome}` : ""} at ${tr.step}#${tr.attempt}` : tr.kind };
          }),
        }
      : {}),
  };
  return same ? out : withExit(out, ExitCode.error);
}

/** Options only `--why` reads. */
const WHY_ONLY = ["tick", "step", "attempt", "transition", "rule"] as const;

export const runViewCommand = defineCommand({
  name: "run view",
  summary: "One run of a unit: step, attempt, outcome, durations, receipts; --why replays the decision (B44, O5)",
  usage: "norn run view [<run|unit>] [--why [--tick <tick_id>] [--step <step>] [--attempt <n>] [--transition <step>.<outcome>] [--rule <prefix>]] | norn run view [<unit>] --receipt <receipt_id>",
  markdown: true,
  optionHelp: {
    "--why": "replay decide on the recorded tick and show the rule that fired and what triggered it",
    "--tick <tick_id>": "with --why: that tick",
    "--step <step>": "with --why: decisions about that step",
    "--attempt <n>": "with --why: that attempt",
    "--transition <step>.<outcome>": "with --why: the decision that took that edge",
    "--rule <prefix>": "with --why: decisions by rules with that prefix",
    "--receipt <id>": "the decision that applied that receipt (a note's inbox item)",
  },
  options: { why: { type: "boolean" }, tick: { type: "string" }, step: { type: "string" }, attempt: { type: "string" }, transition: { type: "string" }, rule: { type: "string" }, receipt: { type: "string" } },
  positionals: { max: 1 },
  async run(ctx, args) {
    if (opt.bool(args, "why") || opt.str(args, "receipt") !== undefined) return why(ctx, args);
    const stray = WHY_ONLY.find((o) => args.values[o] !== undefined);
    if (stray) throw usageError(`--${stray} needs --why`, `norn run view <unit> --why --${stray} …`);
    const target = await targetKey(ctx, args.positionals[0], args.json === true, hasRun(ctx, "run view", cmd.runView));
    const runId = new RegExp(ULID_PATTERN).test(target);
    const key = runId ? target : parseUnitKey(target).key;
    const run = loadRunView({ repoRoot: ctx.root, home: ctx.home, env: ctx.env, now: ctx.clock.now(), target: key });
    if (!run) throw refuse(runId ? `no run ${key} in the trace` : `${key} is unknown or has no run yet`, cmd.status(), runId ? "unknown_run" : "unknown_unit");
    return rendered(run, formatRunView(run));
  },
});
