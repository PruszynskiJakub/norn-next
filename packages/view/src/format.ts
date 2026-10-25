/**
 * Compact terminal text for `norn status` / `norn inbox` human mode. Pure: a ProjectView
 * in, a string out (no colour, no clock). The CLI's default output stays JSON (P8).
 */
import { INBOX_GROUPS, INBOX_TITLES } from "@norn/core";
import { oneLine } from "./timeline.ts";
import type { ProjectView, SliceView, StepRow, StepWho, StoryView, TimelineEntry, TraceView, UnitView } from "./types.ts";

function counterText(u: UnitView): string {
  const used = u.counters.filter((c) => c.value > 0 || (c.max !== null && u.status !== "done"));
  return used.length ? ` [${used.map((c) => `${c.name} ${c.value}${c.max !== null ? `/${c.max}` : ""}`).join(", ")}]` : "";
}

function stateText(u: UnitView): string {
  if (u.status === "not_started") return "not started";
  const step = u.step && u.step !== "$done" ? ` ${u.step}#${u.attempt}` : "";
  const park = u.park ? ` (${u.park.kind}: ${u.park.reason})` : "";
  const age = u.age ? ` ${u.age}` : "";
  return `${u.status}${step}${park}${age}${counterText(u)}`;
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
  if (h.down) return `! no heartbeat on ${h.holder}${h.age ? ` for ${h.age}` : " yet"} — run \`norn watch\` (auto steps wait for it)`;
  return h.last_tick_at ? `heartbeat: last tick ${h.age} ago on ${h.holder}` : null;
}

/** `norn status` human mode: one block per story, slices indented, then runs and errors. */
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
  if (!view.stories.length) out.push("No stories. Run `norn sync` to pick up labelled issues.");
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
  out.push(`${view.inbox.pending} ${view.inbox.pending === 1 ? "item needs" : "items need"} you — norn inbox`);
  return `${out.join("\n").trimEnd()}\n`;
}

/**
 * `norn inbox` human mode: groups in O1 order, each item with reason, age and command; `details` adds
 * full texts (L1). With `home`, paths under it print as `~/…` (the JSON keeps them absolute).
 */
export function formatInbox(view: ProjectView, opts: { details?: boolean; home?: string } = {}): string {
  const home = opts.home?.replace(/\/+$/, "");
  const tilde = (t: string) => (home ? t.replaceAll(`${home}/`, "~/") : t);
  const out: string[] = [];
  for (const g of INBOX_GROUPS) {
    const items = view.inbox.groups[g];
    if (!items.length) continue;
    out.push(`${INBOX_TITLES[g]} (${items.length})`);
    for (const it of items) {
      const unit = it.slice ?? it.story;
      out.push(`  ${unit.padEnd(10)} ${it.step ? `${it.step}: ` : ""}${it.title} · ${it.age}`);
      if (it.detail) out.push(`      ${tilde(it.detail)}`);
      if (opts.details && it.full) out.push(...tilde(it.full).split("\n").map((l) => `      | ${l}`));
      out.push(`      $ ${it.command}`);
    }
    out.push("");
  }
  if (!out.length) return "Inbox empty — nothing needs you.\n";
  return `${out.join("\n").trimEnd()}\n`;
}

/** `norn trace <unit>` human mode: one line per timeline entry. */
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

/**
 * `norn trace <unit> --text`: a header with the totals, then one row per (step, attempt) —
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
    // QV8: unverified criteria per capability
    const c = v.criteria;
    const needs = Object.entries(c.unverified_needs).map(([k, n]) => `${k} ${n}`).join(", ");
    out.push(`criteria: ${c.reports} report(s) · ${c.verdicts.pass} pass · ${c.verdicts.fail} fail · ${c.verdicts.person} person · ${c.verdicts.unverified} unverified${needs ? ` (needs: ${needs})` : ""}${c.unchecked_coverage ? ` · ${c.unchecked_coverage} without frontmatter criteria` : ""}`);
  }
  if (v.hidden_events) out.push(`(${v.hidden_events} no-op/claim-renew tick events hidden — --all shows them)`);
  if (v.records?.source === "base_cache") {
    const ref = v.records.ref?.replace(/^refs\/remotes\//, "") ?? "the base branch";
    out.push(`records: no worktree — paths below are a cached copy of ${ref} (${v.records.root}), refreshed when ${ref} moves; \`git show ${ref}:<path>\` reads the live record`);
  }
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
  v.steps.forEach((r, i) => {
    out.push(line(cells[i] as string[]));
    if (r.reason) out.push(`${pad}${opts.full ? r.reason : oneLine(r.reason, REASON_MAX)}`);
    for (const p of [...r.paths.evidence, ...r.paths.logs]) out.push(`${pad}${p}`);
    if (opts.full) for (const p of [...r.paths.briefings, ...r.paths.receipts]) out.push(`${pad}${p}`);
    for (const e of r.events ?? []) out.push(`${pad}· ${clock(e.at, day)} ${e.source.padEnd(8)} ${opts.full ? e.summary : oneLine(e.summary, REASON_MAX)}`);
  });
  return `${out.join("\n")}\n`;
}

