/**
 * Compact terminal text for `norn status` / `norn inbox` human mode. Pure: a ProjectView
 * in, a string out (no colour, no clock). The CLI's default output stays JSON (P8).
 */
import { INBOX_GROUPS, INBOX_TITLES } from "@norn/core";
import type { ProjectView, SliceView, StoryView, TimelineEntry, UnitView } from "./types.ts";

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

function sliceLine(s: SliceView): string {
  const deps = s.depends_on.length ? ` after ${s.depends_on.map((d) => d.split("/").at(-1)).join(",")}` : "";
  const fm = s.integrated ? " integrated" : s.slice_status && s.slice_status !== "active" ? ` ${s.slice_status}` : "";
  const next = s.next && s.status !== "running" ? `\n      → ${s.next}` : "";
  return `  ${s.key.padEnd(10)} ${s.title} — ${stateText(s)}${fm}${deps}${next}`;
}

/** `norn status` human mode: one block per story, slices indented, then runs and errors. */
export function formatStatus(view: ProjectView): string {
  const out: string[] = [];
  if (!view.stories.length) out.push("No stories. Run `norn sync` to pick up labelled issues.");
  for (const s of view.stories) {
    out.push(`${s.key} ${s.title}`);
    out.push(`  ${s.workflow} · ${modeText(s)} · ${claimText(s)} · ${stateText(s)}`);
    if (s.next && s.status !== "running") out.push(`  → ${s.next}`);
    for (const sl of s.slices) out.push(sliceLine(sl));
    for (const e of [...s.errors, ...s.slices.flatMap((x) => x.errors)]) out.push(`  ! ${e.file}: ${e.errors[0]?.message ?? "invalid"}`);
    out.push("");
  }
  if (view.runs.length) {
    out.push("Runs");
    for (const r of view.runs) {
      const live = r.alive === null ? "" : r.alive ? " alive" : " dead";
      out.push(`  ${r.unit.padEnd(10)} ${r.step}#${r.attempt} ${r.how}${r.agent ? ` ${r.agent}` : ""}${live} since ${r.started_at}`);
    }
    out.push("");
  }
  if (view.recently_done.length) {
    out.push("Recently done");
    for (const d of view.recently_done) out.push(`  ${d.unit.padEnd(10)} ${d.title} (${d.age} ago)`);
    out.push("");
  }
  for (const e of view.errors) out.push(`! ${e.file}: ${e.errors[0]?.message ?? "invalid"}`);
  out.push(`${view.inbox.pending} ${view.inbox.pending === 1 ? "item needs" : "items need"} you — norn inbox`);
  return `${out.join("\n").trimEnd()}\n`;
}

/** `norn inbox` human mode: groups in O1 order, each item with reason, age and command. */
export function formatInbox(view: ProjectView): string {
  const out: string[] = [];
  for (const g of INBOX_GROUPS) {
    const items = view.inbox.groups[g];
    if (!items.length) continue;
    out.push(`${INBOX_TITLES[g]} (${items.length})`);
    for (const it of items) {
      const unit = it.slice ?? it.story;
      out.push(`  ${unit.padEnd(10)} ${it.step ? `${it.step}: ` : ""}${it.title} · ${it.age}`);
      if (it.detail) out.push(`      ${it.detail}`);
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
