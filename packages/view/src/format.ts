/**
 * Compact terminal text for `norn story list` / `norn status` human mode. Pure: a ProjectView
 * in, a string out (no colour, no clock). The CLI's default output stays JSON (P8).
 */
import { cmd, INBOX_ABOUT, INBOX_GROUPS, INBOX_TITLES, isVersionMismatchItem } from "@norn/core";
import type { RunDetail } from "./run-view.ts";
import { DELEGATED_MARK, oneLine } from "./timeline.ts";
import type { ElsewhereView, InboxEntry, ProjectView, RoundView, SliceView, StepRow, StepWho, StoryView, TimelineEntry, TraceView, UnitView } from "./types.ts";

function counterText(u: UnitView): string {
  const used = u.counters.filter((c) => c.value > 0 || (c.max !== null && u.status !== "done"));
  return used.length ? ` [${used.map((c) => `${c.name} ${c.value}${c.max !== null ? `/${c.max}` : ""}`).join(", ")}]` : "";
}

function stateText(u: UnitView): string {
  if (u.status === "not_started") return "not started";
  const step = u.step && u.step !== "$done" ? ` ${u.step}#${u.attempt}` : "";
  const park = u.park ? ` (${u.park.kind}: ${u.park.reason})` : "";
  const check = u.check_running ? " (check running)" : "";
  const age = u.age ? ` ${u.age}` : "";
  return `${u.status}${step}${park}${check}${age}${counterText(u)}`;
}

function claimText(s: StoryView): string {
  const c = s.claim;
  switch (c.state) {
    case "none":
      return "unclaimed";
    case "expired":
      return `unclaimed (expired ${c.holder})`;
    case "corrupt":
      return "claim corrupt";
    case "mine":
      return "mine";
    case "other":
      return `held by ${c.holder}`;
  }
}

function modeText(u: UnitView): string {
  return u.mode_downgraded ? `${u.mode}→${u.effective_mode}` : u.effective_mode;
}

/** R4.3: a failed act effect, shown under the unit. */
function failureText(u: UnitView, indent: string): string {
  return u.act_failure ? `\n${indent}! ${u.act_failure.reason}` : "";
}

function sliceLine(s: SliceView): string {
  const deps = s.depends_on.length ? ` after ${s.depends_on.map((d) => d.split("/").at(-1)).join(",")}` : "";
  const fm = s.integrated ? " integrated" : s.slice_status && s.slice_status !== "active" ? ` ${s.slice_status}` : "";
  const next = s.next && s.status !== "running" ? `\n      → ${s.next}` : "";
  return `  ${s.key.padEnd(10)} ${s.title} — ${stateText(s)}${fm}${deps}${next}${failureText(s, "      ")}`;
}

/** R5.5 (N3): this checkout's heartbeat, one line. */
function heartbeatText(view: ProjectView): string | null {
  const h = view.heartbeat;
  if (h.down) return `! no heartbeat on ${h.holder}${h.age ? ` for ${h.age}` : " yet"} — run \`${cmd.watch()}\` (auto steps wait for it)`;
  return h.last_tick_at ? `heartbeat: last tick ${h.age} ago on ${h.holder}${h.last_tick_ms === undefined ? "" : ` (took ${formatTickMs(h.last_tick_ms)})`}` : null;
}

/** gh-78: a tick's duration: `320ms`, `9.4s`, then as `formatDuration` (`1m15s`). */
export function formatTickMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)}s`;
  return formatDuration(ms);
}

/** `norn story list` human mode: one block per story, slices indented, then runs and errors. */
/** BS1/BS3: `base main: 17 behind · conflicts a.ts, b.ts · last update merge 1a2b3c4d5e6f (…)`; null when nothing is known. */
function baseSyncText(s: StoryView): string | null {
  const b = s.base_sync;
  if (!b) return null;
  const parts: string[] = [];
  if (b.behind !== null) parts.push(b.behind === 0 ? "up to date" : `${b.behind} behind`);
  if (b.conflicts.length) parts.push(`conflicts ${b.conflicts.join(", ")}`);
  if (b.last_update) parts.push(`last update merge ${b.last_update.sha.slice(0, 12)} (${b.last_update.step}, ${b.last_update.at})`);
  return parts.length ? `base ${b.branch}: ${parts.join(" · ")}` : null;
}

export function formatStatus(view: ProjectView): string {
  const out: string[] = [];
  if (!view.stories.length) out.push(`No stories. Run \`${cmd.sync()}\` to pick up labelled issues.`);
  for (const s of view.stories) {
    out.push(`${s.key} ${s.title}`);
    out.push(`  ${s.workflow} · ${modeText(s)} · ${claimText(s)} · ${stateText(s)}`);
    if (s.next && s.status !== "running") out.push(`  → ${s.next}`);
    if (s.act_failure) out.push(`  ! ${s.act_failure.reason}`);
    const bs = baseSyncText(s);
    if (bs) out.push(`  ${bs}`);
    for (const sl of s.slices) out.push(sliceLine(sl));
    for (const e of [...s.errors, ...s.slices.flatMap((x) => x.errors)]) out.push(`  ! ${e.file}: ${e.errors[0]?.message ?? "invalid"}`);
    out.push("");
  }
  if (view.runs.length) {
    out.push("Runs");
    for (const r of view.runs) {
      const live = r.alive === null ? "" : r.alive ? " alive" : " dead";
      // R4.4: the last classification, so a frozen agent never reads as plain `alive`
      const cls = r.classified ? ` — ${r.classified.outcome} since ${r.classified.at}` : "";
      const machine = r.machine && r.machine !== view.holder ? ` on ${r.machine}` : "";
      out.push(`  ${r.unit.padEnd(10)} ${r.step}#${r.attempt} ${r.how}${r.agent ? ` ${r.agent}` : ""}${machine}${live} since ${r.started_at}${cls}`);
    }
    out.push("");
  }
  if (view.recently_done.length) {
    out.push("Recently done");
    for (const d of view.recently_done) out.push(`  ${d.unit.padEnd(10)} ${d.title} (${d.age} ago)`);
    out.push("");
  }
  for (const e of view.errors) out.push(`! ${e.file}: ${e.errors[0]?.message ?? "invalid"}`);
  const hb = heartbeatText(view);
  if (hb) out.push(hb);
  out.push(`${view.inbox.pending} ${view.inbox.pending === 1 ? "item needs" : "items need"} you — ${cmd.status()}`);
  return `${out.join("\n").trimEnd()}\n`;
}

/** NT5: the Notes header's clearing hint — each story's once, e.g. `cleared by gh-1 human-qa approval`. */
function notesHint(items: readonly InboxEntry[]): string {
  return [...new Set(items.flatMap((i) => (i.cleared_by ? [i.cleared_by] : [])))].join("; ");
}

/** A group header's text after its title and count: what the group holds, then the notes' clearing hint. */
function groupAbout(g: keyof typeof INBOX_ABOUT, items: readonly InboxEntry[]): string {
  return [INBOX_ABOUT[g], notesHint(items)].filter(Boolean).join(" · ");
}

/** HC4: the inbox items in display order (O1 group order) — item `n` of the cockpit is `[n - 1]`. */
export function inboxItemsInOrder(view: ProjectView): InboxEntry[] {
  const all = INBOX_GROUPS.flatMap((g) => view.inbox.groups[g]);
  // gh-61 D7: a version mismatch shows on top of the inbox, above every group
  return [...all.filter(isVersionMismatchItem), ...all.filter((it) => !isVersionMismatchItem(it))];
}

/** An inbox item's line text: its step first, once — many titles already start with the step (F4). */
export function stepTitle(step: string | null | undefined, title: string): string {
  if (!step) return title;
  const named = title.startsWith(step) && (title.length === step.length || /^[: #]/.test(title.slice(step.length)));
  return named ? title : `${step}: ${title}`;
}

/** gh-196 D5 (B22): a count per story of what a supervisor decided on the person's behalf; never an inbox item. */
export const delegatedCounts = (view: ProjectView): Record<string, number> =>
  Object.fromEntries(view.stories.filter((s) => s.delegated.length).map((s) => [s.key, s.delegated.length]));

/** The status line under the inbox for {@link delegatedCounts}; empty when no story has one. */
export function formatDelegatedCounts(counts: Record<string, number>): string {
  const entries = Object.entries(counts);
  if (!entries.length) return "";
  return `\nDelegated by a supervisor: ${entries.map(([k, n]) => `${k} ${n} delegated`).join(" · ")} — review with \`${cmd.storyView("<story>")}\`\n`;
}

/**
 * `norn status` human mode: groups in O1 order, each item with reason, age and command; `details` adds
 * full texts (L1). With `home`, paths under it print as `~/…` (the JSON keeps them absolute).
 * `numbered` prefixes `[n]` for the cockpit (HC4). Notes show as their header line only, with the
 * command that lists them, unless `notes` (NT6).
 */
export function formatInbox(view: ProjectView, opts: { details?: boolean; home?: string; numbered?: boolean; notes?: boolean } = {}): string {
  const home = opts.home?.replace(/\/+$/, "");
  const tilde = (t: string) => (home ? t.replaceAll(`${home}/`, "~/") : t);
  const out: string[] = [];
  let n = 0;
  // gh-61 D7 (B8): a binary that does not fit the repo's norn version comes first, above every group
  for (const it of view.inbox.groups.unblock.filter(isVersionMismatchItem)) {
    const num = opts.numbered ? `${`[${++n}]`.padEnd(5)}` : "";
    out.push(`! ${num}${it.title}`, `      $ ${it.command}`, "");
  }
  for (const g of INBOX_GROUPS) {
    const items = view.inbox.groups[g].filter((it) => !isVersionMismatchItem(it));
    if (!items.length) continue;
    out.push(`${INBOX_TITLES[g]} (${items.length}) · ${groupAbout(g, items)}`);
    if (g === "notes" && !opts.notes) {
      out.push(`      $ ${cmd.status({ notes: true })}`, "");
      continue;
    }
    for (const it of items) {
      const unit = it.slice ?? it.story;
      const num = opts.numbered ? `${`[${++n}]`.padEnd(5)}` : "";
      // gh-71 B28: the round and its workflow next to the step, as `story view` and the handoff header show them
      const round = it.round ? `round ${it.round.n} · ${it.round.workflow} · ` : "";
      out.push(`  ${num}${unit.padEnd(10)} ${round}${stepTitle(it.step, it.title)} · ${it.age}`);
      if (it.detail) out.push(`      ${tilde(it.detail)}`);
      if (opts.details && it.full) out.push(...tilde(it.full).split("\n").map((l) => `      | ${l}`));
      out.push(`      $ ${it.command}`);
    }
    out.push("");
  }
  // gh-195 D6 (B17, B18): stories another machine holds, from local refs only
  if (view.elsewhere?.length) {
    out.push(`Held elsewhere (${view.elsewhere.length}) · on another machine`);
    for (const e of view.elsewhere) out.push(`  ${e.key.padEnd(10)} ${e.title} · ${elsewhereStanding(e)}`, `      $ ${cmd.storyView(e.key)}`);
    out.push("");
  }
  if (!out.length && !view.stories.length) {
    // a fresh repo: point at the first story instead of a dead end
    return `Inbox empty — no stories yet.\nLabel an issue \`norn\` and assign it to yourself, then run \`${cmd.sync()}\`.\n`;
  }
  if (!out.length) return "Inbox empty — nothing needs you.\n";
  return `${out.join("\n").trimEnd()}\n`;
}

/** `2026-11-02 14:10` (UTC) from an ISO time. */
const minute = (iso: string) => iso.slice(0, 16).replace("T", " ");

/** `review_loop 0/3` */
const counterLine = (c: { name: string; value: number; max: number | null }) => `${c.name} ${c.value}${c.max !== null ? `/${c.max}` : ""}`;

/** The story unit's standing from its record (B17), else its last boundary (B18, B19). */
function elsewhereStanding(e: ElsewhereView): string {
  const u = e.record?.units.find((x) => x.slice === null);
  if (u) {
    const counters = u.counters.length ? ` [${u.counters.map(counterLine).join(", ")}]` : "";
    const asOf = e.record && !e.record.current ? ` — record as of ${minute(e.record.at)}` : "";
    return `held by ${e.holder} · Step: ${u.step} (attempt ${u.attempt})${counters}${asOf}`;
  }
  const ci = e.ci ? ` · CI: ${e.ci}` : "";
  return `held by ${e.holder} · ${e.last_boundary ? `last boundary: ${e.last_boundary}` : "no boundary pushed yet"}${e.pr ? ` · PR #${e.pr.number}${ci}` : ""}`;
}

/**
 * `norn story view` of a story another machine holds (gh-195 D6, B10, B13, B17–B19): the claim, the
 * branch, the PR and its CI, then the step, attempt and counters from the record ref when it is here,
 * or the last boundary step when it is not, and where the run state is.
 */
export function formatElsewhere(e: ElsewhereView): string {
  const out = [`# ${e.key} — ${e.title}`, ""];
  out.push(`- Held by: ${e.holder} (heartbeat ${minute(e.renewed_at)}, ${e.expired ? "expired" : "expires"} ${minute(e.expires_at)})`);
  out.push(`- Branch: ${e.branch ?? "not fetched here"}${e.head ? ` at ${e.head.sha.slice(0, 7)} "${e.head.subject}" (${minute(e.head.at)})` : ""}`);
  if (e.policy === "local" || !e.record) out.push(`- ${e.last_boundary ? `last boundary: ${e.last_boundary}` : "no boundary pushed yet"}`);
  out.push(`- PR: ${e.pr ? `#${e.pr.number} ${e.pr.is_draft && e.pr.state === "open" ? "draft, open" : e.pr.state} — ${e.pr.url} (seen ${minute(e.pr.seen_at)})` : "none seen yet"}`);
  if (e.pr) out.push(`- CI: ${e.ci ?? "not seen yet"}`);
  const r = e.record;
  if (r) {
    out.push("", r.current ? `Record: ${r.sha.slice(0, 7)} (${minute(r.at)})` : `Record as of ${minute(r.at)}:`);
    for (const u of r.units) out.push(`- ${u.key}: Step: ${u.step} (attempt ${u.attempt}), ${u.status}${u.counters.length ? ` · counters: ${u.counters.map(counterLine).join(", ")}` : ""}`);
    for (const err of r.errors) out.push(`- failed validation (S2): ${err.file}: ${err.errors.map((x) => `${x.path || "/"} ${x.message}`).join("; ")}`);
  }
  const lines: string[] = [];
  if (r && !r.current) lines.push(`record as of ${minute(r.at)} — ${e.key} now keeps its record on ${e.holder}'s machine`);
  if (!r || !r.current) lines.push(`run state is on ${e.holder}'s machine — ask them to run ${cmd.storyHandoff(e.key)}, or take it over after the claim expires (${minute(e.expires_at)})`);
  if (lines.length) out.push("", ...lines);
  return `${out.join("\n")}\n`;
}

/** `norn run list <unit>` human mode: one line per timeline entry. */
export function formatTimeline(entries: readonly TimelineEntry[]): string {
  if (!entries.length) return "No events.\n";
  return `${entries.map((e) => `${e.at}  ${e.source.padEnd(7)} ${e.summary}`).join("\n")}\n`;
}

/** Compact duration: `17s`, `2m27s`, `1h02m`, `1d01h`. */
export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m${String(s % 60).padStart(2, "0")}s`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h${String(m % 60).padStart(2, "0")}m`;
  return `${Math.floor(h / 24)}d${String(h % 24).padStart(2, "0")}h`;
}

const REASON_MAX = 160;

/** Time of day (UTC); the date too when it differs from `day` (YYYY-MM-DD). */
function clock(iso: string | null, day: string | null): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const t = d.toISOString();
  return t.slice(0, 10) === day ? t.slice(11, 19) : `${t.slice(5, 10)} ${t.slice(11, 19)}`;
}

function whoText(w: StepWho): string {
  if (w.by === "norn") return `tick ${w.tick_id ?? "?"}`;
  if (w.by === "agent") return w.run_id ? `${w.name} run ${w.run_id}` : w.name;
  return w.name;
}

function outcomeText(r: StepRow): string {
  if (r.open) return "(in step)";
  const c = r.counter ? ` (${r.counter.name} ${r.counter.value}/${r.counter.max})` : "";
  return `${r.outcome ?? "-"}${c}`;
}

/** gh-196 D5 (B21, B34): the mark of a supervisor's decision, with its reason; nothing for the person's own. */
export const delegatedText = (reason: string | undefined): string => (reason === undefined ? "" : ` — ${DELEGATED_MARK}: ${reason}`);

/** gh-71 B29, B32: ` · finished`, ` · ended by the person at <step>`, or nothing while the round is under way. */
function roundEndText(r: RoundView): string {
  if (!r.ended) return "";
  return r.ended.by === "person" ? ` · ended by the person at ${r.ended.at}` : " · finished";
}

/**
 * `norn run list <unit> --text`: a header with the totals, then one row per (step, attempt) —
 * entered, left, duration, outcome, who — with the reason beneath (cut to one line unless
 * `full`) and absolute evidence / log paths. Slice rows of a story are indented.
 */
export function formatStepTimeline(v: TraceView, opts: { full?: boolean } = {}): string {
  const day = (v.intake_at ?? v.steps[0]?.entered_at ?? null)?.slice(0, 10) ?? null;
  const out: string[] = [];
  out.push(`${v.unit} · ${v.title} · ${v.status}${v.status !== "done" && v.step ? ` at ${v.step}` : ""}`);
  const span: string[] = [];
  if (v.intake_at) span.push(`intake ${v.intake_at.slice(0, 10)} ${clock(v.intake_at, day)}Z`);
  span.push(v.done_at ? `$done ${clock(v.done_at, day)}Z` : "not done");
  if (v.totals.wall_clock_ms !== null) span.push(`wall-clock ${formatDuration(v.totals.wall_clock_ms)}${v.done_at ? "" : " so far"}`);
  if (v.merged_at) span.push(`merged ${clock(v.merged_at, day)}Z (+${formatDuration(v.totals.merge_wait_ms ?? 0)})`);
  out.push(span.join(" · "));
  const types = Object.entries(v.totals.by_type).map(([k, ms]) => `${k} ${formatDuration(ms)}`);
  out.push(`time in ${v.units.length > 1 ? "story " : ""}steps: ${types.join(" · ") || "-"} · human wait ${formatDuration(v.totals.human_wait_ms)}`);
  if (v.criteria) {
    // QV8: criteria reports counted per verdict
    const c = v.criteria;
    out.push(`criteria: ${c.reports} report(s) · ${c.verdicts.pass} pass · ${c.verdicts.fail} fail · ${c.verdicts.person} person · ${c.verdicts.unverified} unverified${c.unchecked_coverage ? ` · ${c.unchecked_coverage} without frontmatter criteria` : ""}`);
  }
  if (v.hidden_events) out.push(`(${v.hidden_events} no-op/claim-renew tick events hidden — --all shows them)`);
  // gh-195 D7 (B29): a finished story's record, read from its archive ref
  if (v.records?.source === "archive") out.push(`records: from ${v.records.ref} at ${v.records.commit?.slice(0, 12)} — paths below are its copy in ${v.records.root}`);
  out.push("");
  if (!v.steps.length) {
    out.push("No steps yet.");
    return `${out.join("\n")}\n`;
  }

  const story = v.units.length > 1;
  const cells = v.steps.map((r) => [
    `${story && r.slice ? "  " : ""}${r.unit}`,
    `${r.step}#${r.attempt}`,
    clock(r.entered_at, day),
    r.open ? "…" : clock(r.left_at, day),
    r.duration_ms === null ? "-" : `${formatDuration(r.duration_ms)}${r.open ? "+" : ""}`,
    outcomeText(r),
    r.who.map(whoText).join(", ") || "-",
  ]);
  const head = ["UNIT", "STEP", "ENTERED", "LEFT", "DUR", "OUTCOME", "WHO"];
  const width = head.map((h, i) => Math.max(h.length, ...cells.map((c) => (c[i] as string).length)));
  const line = (c: string[]) => c.map((x, i) => (i === c.length - 1 ? x : x.padEnd(width[i] as number))).join("  ").trimEnd();
  const pad = " ".repeat((width[0] as number) + 2);
  out.push(line(head));
  const row = (i: number) => {
    const r = v.steps[i] as StepRow;
    out.push(line(cells[i] as string[]));
    if (r.reason) out.push(`${pad}${opts.full ? r.reason : oneLine(r.reason, REASON_MAX)}`);
    for (const p of [...r.paths.evidence, ...r.paths.logs]) out.push(`${pad}${p}`);
    if (opts.full) for (const p of [...r.paths.briefings, ...r.paths.receipts]) out.push(`${pad}${p}`);
    for (const e of r.events ?? []) out.push(`${pad}· ${clock(e.at, day)} ${e.source.padEnd(8)} ${opts.full ? e.summary : oneLine(e.summary, REASON_MAX)}`);
  };
  if (!v.rounds?.length) v.steps.forEach((_, i) => row(i));
  // gh-71 B29, B32 (D10): a story's rows under a heading per round, with how the round ended
  for (const rd of v.rounds ?? []) {
    const rows = v.steps.flatMap((r, i) => ((r.round ?? 1) === rd.n ? [i] : []));
    if (!rows.length) continue;
    out.push(`round ${rd.n} · ${rd.workflow}${roundEndText(rd)}${delegatedText(rd.delegated_reason)}`);
    rows.forEach(row);
  }
  return `${out.join("\n")}\n`;
}

/**
 * `norn run view <run|unit>` (B44): one run — step and attempt, the run id, outcome, when it
 * entered and left with its duration, who, the time a person was waited on, the reason in full
 * and the receipt, evidence and log paths.
 */
export function formatRunView(r: RunDetail): string {
  const out = [`${r.unit} · ${r.step}#${r.attempt} (${r.type}${r.attended ? ", attended" : ""})`, ""];
  const field = (k: string, v: string) => out.push(`${k.padEnd(9)}${v}`);
  if (r.delegated_round) field("round", `${r.delegated_round.n} · ${r.delegated_round.workflow}${delegatedText(r.delegated_round.delegated_reason)}`);
  field("run", r.run_id ?? "-");
  field("outcome", r.open ? "(in step)" : `${outcomeText(r)}${r.to ? ` → ${r.to}` : ""}`);
  field("entered", r.entered_at ?? "-");
  field("left", r.open ? "…" : (r.left_at ?? "-"));
  field("duration", r.duration_ms === null ? "-" : `${formatDuration(r.duration_ms)}${r.open ? " so far" : ""}`);
  field("who", r.who.map(whoText).join(", ") || "-");
  if (r.wait_ms) field("waited", formatDuration(r.wait_ms));
  if (r.reason) out.push("", "Reason", ...r.reason.split("\n").map((l) => `  ${l}`.trimEnd()));
  const paths: Array<[string, string[]]> = [["Receipts", r.paths.receipts], ["Evidence", r.paths.evidence], ["Logs", r.paths.logs], ["Briefings", r.paths.briefings]];
  for (const [title, ps] of paths) if (ps.length) out.push("", title, ...ps.map((p) => `  ${p}`));
  return `${out.join("\n")}\n`;
}
