/**
 * PROTOTYPE (throwaway): variant 0+ — today's cockpit (renderCockpit, forked) with each fix of its weaknesses
 * behind a number key, all off at first, so each one is judged against today on its own:
 *   1 STORIES: no repeats of NEEDS YOU, closed stories folded into one row (z opens), the rest sorted by stage
 *   2 NEEDS YOU rows say what the story is (its title), not the step's instruction
 *   3 stage as `workflow · step n/m` with a status mark; a closed story reads as done (story_status)
 *   4 the list gets 60% of the width, the preview 40%
 *   5 section counts; ] [ jump between sections, n to the next row of the same kind
 *   6 less clutter: no "/ to filter" line, the mark without the word, no "no slices · no PR"
 *   0 all on / all off
 */
import { basename } from "node:path";
import { formatAge } from "/Users/jakubpruszynski/Projects/norn/packages/core/src/index.ts";
import { handleKey, initialState, type TuiState } from "/Users/jakubpruszynski/Projects/norn/packages/cli/src/runtime/cockpit-tui.ts";
import { type CockpitModel, type CockpitRow, fit, GROUP_MARK, GROUP_STYLE, GROUP_WORD, type Key, type Look, paint, phaseOf, type Phase, previewLines, type Style, type Variant, visible, WORKFLOW_STEPS, wrap } from "../shared.ts";

export interface S { tui: TuiState; fixes: Set<number>; showDone: boolean; /** the tabs variant: fixes fixed, digits are its own */ locked?: boolean }
const FIXES: Record<number, string> = { 1: "dedupe+fold done", 2: "story titles", 3: "stage n/m", 4: "wide list", 5: "sections+jumps", 6: "less clutter" };
const DONE_ID = "story:__done";
const on = (s: S, n: number) => s.fixes.has(n);

// ---------------------------------------------------------------- the model each fix sees

const isDone = (r: CockpitRow) => phaseOf(r) === "done";
/** Order of stories in flight: closest to done first. */
const PHASE_RANK: Record<Phase, number> = { ship: 0, build: 1, shape: 2, intake: 3, backlog: 4, done: 5 };

function section(s: S, r: CockpitRow): string {
  if (r.kind === "item") return "NEEDS YOU";
  if (!on(s, 1)) return "STORIES";
  if (r.id === DONE_ID || isDone(r)) return "DONE";
  return phaseOf(r) === "backlog" ? "BACKLOG" : "IN FLIGHT";
}

/** The rows in the order they are drawn (handleKey moves over the same order). */
function shaped(model: CockpitModel, s: S): CockpitModel {
  if (!on(s, 1)) return model;
  const items = model.rows.filter((r) => r.kind === "item");
  const waiting = new Set(items.map((r) => r.story));
  const stories = model.rows.filter((r) => r.kind === "story" && !waiting.has(r.story));
  const live = stories.filter((r) => !isDone(r)).sort((a, b) => PHASE_RANK[phaseOf(a)] - PHASE_RANK[phaseOf(b)] || Number(a.story.slice(3)) - Number(b.story.slice(3)));
  const done = stories.filter(isDone);
  const fold: CockpitRow = { ...(done[0] ?? stories[0])!, id: DONE_ID, story: "", unit: "✓", title: `${done.length} closed stories`, step: null, actions: [] };
  return { ...model, rows: [...items, ...live, ...(done.length ? (s.showDone ? done : [fold]) : [])] };
}

// ---------------------------------------------------------------- text of a row

function unitMark(status: string): [string, Style[]] {
  if (status === "done") return ["✓", ["green"]];
  if (status === "running") return ["◐", ["cyan"]];
  if (status === "parked") return ["●", ["yellow"]];
  if (status === "stuck" || status === "corrupt") return ["✖", ["red"]];
  if (status === "ready") return ["○", ["blue"]];
  return ["·", ["dim"]];
}

/** `step n/m` of the story's workflow, or the bare step when the workflow is unknown. */
function stepOf(wf: string, step: string | null): string {
  if (!step) return "";
  const steps = WORKFLOW_STEPS[wf];
  const i = steps ? steps.indexOf(step) : -1;
  return i < 0 ? step : `${step} ${i + 1}/${steps!.length}`;
}

/** The status word a closed story should show (fix 3): today it reads the unit only. */
const statusOf = (r: CockpitRow, s: S) => (on(s, 3) && isDone(r) ? "done" : r.preview.report.unit.status);

function storySummary(r: CockpitRow, s: S): string {
  const rep = r.preview.report;
  const done = rep.slices.filter((x) => x.status === "done").length;
  const slices = rep.slices.length ? `${done}/${rep.slices.length} slices` : on(s, 6) ? "" : "no slices";
  const pr = rep.pr ? `PR #${rep.pr.number}${rep.pr.is_draft && rep.pr.state === "open" ? " draft" : rep.pr.state === "open" ? "" : ` ${rep.pr.state}`}` : on(s, 6) ? "" : "no PR";
  const status = statusOf(r, s);
  let where: string;
  if (on(s, 3)) {
    const [m, ms] = unitMark(status);
    const at = status === "done" ? "done" : status === "not_started" ? "not started" : `${status} at ${stepOf(rep.unit.workflow, rep.unit.step)}`;
    where = `${paint(m, ms)} ${paint(rep.unit.workflow, ["dim"])} · ${at}`;
  } else where = status === "done" ? "done" : status === "not_started" ? "not started" : `${status} ${rep.unit.step ?? ""}`.trim();
  return [where, slices, pr].filter(Boolean).join(" · ");
}

/** Cut a styled string to n visible columns (styles end at the cut). */
function cut(t: string, n: number): string {
  if (visible(t) <= n) return t;
  let out = "", seen = 0;
  for (const part of t.split(/(\x1b\[[0-9;]*m)/)) {
    if (part.startsWith("\x1b[")) { out += part; continue; }
    const room = n - 1 - seen;
    if (part.length <= room) { out += part; seen += part.length; continue; }
    out += `${part.slice(0, Math.max(0, room))}…`;
    return `${out}\x1b[0m`;
  }
  return out;
}

// ---------------------------------------------------------------- preview

function preview(row: CockpitRow, model: CockpitModel, s: S, look: Look, width: number): string[] {
  if (row.id === DONE_ID) {
    const done = model.rows.filter((r) => r.kind === "story" && isDone(r));
    return [paint(`${done.length} closed stories`, ["bold"]), paint("enter or z lists them in the list", ["dim"]), "", ...done.map((r) => `${paint("✓", ["green"])} ${paint(r.unit.padEnd(7), ["dim"])}${fit(r.title, width - 9)}`)];
  }
  const p = (t: string, st: readonly Style[] = []) => paint(t, st as Style[]);
  const lines = previewLines(row, look.now, width, p);
  if (on(s, 3)) {
    const rep = row.preview.report;
    const status = statusOf(row, s);
    const [m, ms] = unitMark(status);
    const steps = WORKFLOW_STEPS[rep.unit.workflow];
    const i = steps && rep.unit.step ? steps.indexOf(rep.unit.step) : -1;
    const at = status === "done" ? "done" : status === "not_started" ? "not started" : `${status} at ${rep.unit.step}`;
    lines[1] = `${paint(m, ms)} ${fit(`${at} · ${rep.mode} · ${rep.claim}`, width - 2)}`;
    // the workflow's steps, the current one marked: where it is and what comes next
    if (steps) {
      const parts = steps.map((st, j) => (j < i || status === "done" ? paint(st, ["dim"]) : j === i ? paint(`[${st}]`, ["bold", ...ms]) : st));
      const track: string[] = [paint(rep.unit.workflow, ["bold"])];
      for (const p of parts) {
        const sep = paint(" › ", ["dim"]);
        if (visible(track.at(-1)! + sep + p) > width) track.push(`  ${p}`);
        else track[track.length - 1] += (track.at(-1) === paint(rep.unit.workflow, ["bold"]) ? " " : sep) + p;
      }
      lines.splice(2, 0, ...track.map((l) => cut(l, width)));
    }
  }
  return lines;
}

// ---------------------------------------------------------------- frame

export function frame(model0: CockpitModel, s: S, o: Look & { toast: string | null }): string {
  const model = shaped(model0, s);
  const t = s.tui;
  const width = Math.max(40, o.width), height = Math.max(12, o.height);
  const headH = on(s, 6) ? 2 : 3;
  const bodyH = height - headH - 3;
  const wide = width >= 100;
  const listW = wide ? Math.max(on(s, 4) ? 64 : 48, Math.floor(width * (on(s, 4) ? 0.6 : 0.4))) : width;
  const prevW = wide ? width - listW - 3 : width;
  const listH = wide ? bodyH : Math.max(3, Math.floor(bodyH / 2));
  const prevH = wide ? bodyH : bodyH - listH - 1;
  const rule = paint("─".repeat(width), ["dim"]);

  const words = t.filter.toLowerCase().split(/\s+/).filter(Boolean);
  const rows = model.rows.filter((r) => words.every((w) => `${r.group ? GROUP_WORD[r.group] : "story"} ${r.unit} ${r.step ?? ""} ${r.title} ${r.preview.report.title} ${r.preview.report.unit.workflow}`.toLowerCase().includes(w)));
  const sel = rows.find((r) => r.id === t.selected) ?? rows[0] ?? null;

  // header
  const hb = model.header.heartbeat;
  const pending = model.header.pending;
  const toggles = Object.keys(FIXES).map((n) => (s.fixes.has(+n) ? paint(n, ["bold", "green"]) : paint(n, ["dim"]))).join("");
  const left = `${paint("norn status", ["bold"])} ${paint("·", ["dim"])} ${basename(model.header.repo)}  ${pending ? paint(`${pending} need${pending === 1 ? "s" : ""} you`, ["bold", "yellow"]) : paint("nothing needs you", ["green"])}`;
  const right = `${s.locked ? "" : `${paint("fixes", ["dim"])} ${toggles}  `}${paint(hb.age ? `tick ${hb.age} ago` : "no tick yet", ["dim"])}  ${paint(o.clock, ["dim"])}`;
  const out = [`${left}${" ".repeat(Math.max(2, width - visible(left) - visible(right)))}${right}`];
  const filterLine = t.filtering ? `${paint("/", ["bold", "cyan"])} ${t.filter}${paint("▏", ["dim"])}` : t.filter ? `${paint("filter:", ["dim"])} ${t.filter} ${paint("(esc clears)", ["dim"])}` : paint("/ to filter", ["dim"]);
  if (!on(s, 6)) out.push(filterLine);
  else if (t.filtering || t.filter) out[0] = cut(`${filterLine}   ${out[0]}`, width); // the filter takes the header while it is in use
  out.push(rule);

  // list
  const items = rows.filter((r) => r.kind === "item");
  const storyRows = rows.filter((r) => r.kind === "story");
  const w = (f: (r: CockpitRow) => string, max: number) => Math.min(max, Math.max(0, ...items.map((r) => f(r).length)));
  const wordW = on(s, 6) ? 0 : w((r) => GROUP_WORD[r.group as string] ?? "", 9);
  const unitW = Math.min(10, Math.max(0, ...rows.map((r) => r.unit.length)));
  const itemStep = (r: CockpitRow) => (on(s, 3) ? stepOf(r.preview.report.unit.workflow, r.step) : (r.step ?? ""));
  const stepW = w(itemStep, on(s, 3) ? 18 : 12);
  const summaryW = Math.min(on(s, 4) ? 56 : on(s, 3) ? 40 : 36, Math.max(0, ...storyRows.map((r) => visible(storySummary(r, s)))));
  const titleW = Math.max(16, Math.min(on(s, 4) ? 80 : 28, listW - 2 - unitW - 2 - summaryW - 2));
  const line = (r: CockpitRow, room: number): string => {
    if (r.kind === "story") {
      if (r.id === DONE_ID) return paint(`${r.unit.padEnd(unitW)}  ${r.title} · enter or z shows them`, ["dim"]);
      const head = `${fit(r.unit, unitW).padEnd(unitW)}  ${fit(r.title, titleW).padEnd(titleW)}  `;
      return `${head}${cut(storySummary(r, s), room - head.length)}`;
    }
    const g = r.group as string;
    const word = on(s, 6) ? "" : `${(GROUP_WORD[g] ?? g).padEnd(wordW)}  `;
    const head = `${GROUP_MARK[g] ?? "·"} ${word}${fit(r.unit, unitW).padEnd(unitW)}  ${fit(itemStep(r), stepW).padEnd(stepW)}  `;
    const age = r.age ?? "";
    const text = on(s, 2) ? r.preview.report.title : r.title;
    const tt = fit(text, Math.max(0, room - head.length - age.length - 2));
    return `${head}${tt}${" ".repeat(Math.max(2, room - head.length - tt.length - age.length))}${age}`;
  };
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(section(s, r), (counts.get(section(s, r)) ?? 0) + (r.id === DONE_ID ? Number(r.title.split(" ")[0]) : 1));
  const list: Array<{ text: string; row?: CockpitRow }> = [];
  let sec: string | null = null;
  for (const r of rows) {
    const here = section(s, r);
    if (here !== sec) list.push({ text: on(s, 5) ? `${paint(here, ["bold", "dim"])} ${paint(String(counts.get(here)), ["dim"])} ${paint("─".repeat(Math.max(0, listW - here.length - 6)), ["dim"])}` : paint(here, ["dim"]) });
    sec = here;
    list.push({ text: "", row: r });
  }
  if (!rows.length) list.push({ text: paint(t.filter ? "  no row matches the filter" : "  no stories yet", ["dim"]) });
  const selAt = Math.max(0, list.findIndex((l) => l.row && l.row.id === sel?.id));
  const start = Math.max(0, Math.min(selAt - Math.floor(listH / 2), list.length - listH));
  const listLines = list.slice(start, start + listH).map((l) => {
    if (!l.row) return cut(l.text, listW);
    const text = line(l.row, listW - 2);
    if (l.row.id === sel?.id) return paint(`▸ ${text.replace(/\x1b\[[0-9;]*m/g, "")}`.padEnd(listW).slice(0, listW), ["inverse"]);
    return `  ${l.row.kind === "item" ? paint(text, GROUP_STYLE[l.row.group as string] ?? []) : text}`;
  });
  if (on(s, 5) && start + listH < list.length) listLines[listLines.length - 1] = paint(`  ↓ ${list.length - start - listH} more · ] next section`, ["dim"]);

  // preview
  const all = t.shown ? t.shown.split("\n").flatMap((l) => wrap(l, prevW)) : sel ? preview(sel, model, s, o, prevW) : [];
  const scroll = Math.max(0, Math.min(t.scroll, all.length - prevH));
  const prev = all.slice(scroll, scroll + prevH);
  if (wide) {
    for (let i = 0; i < bodyH; i++) {
      const l = listLines[i] ?? "";
      out.push(`${l}${" ".repeat(Math.max(0, listW - visible(l)))} ${paint("│", ["dim"])} ${cut(prev[i] ?? "", prevW)}`);
    }
  } else {
    for (let i = 0; i < listH; i++) out.push(listLines[i] ?? "");
    out.push(rule);
    for (let i = 0; i < prevH; i++) out.push(cut(prev[i] ?? "", width));
  }

  // footer
  out.push(rule);
  const msg = o.toast ?? t.message?.text ?? "";
  if (t.prompt) out.push(`${paint("Text:", ["bold", "yellow"])} ${t.prompt.text}${paint("▏", ["dim"])}`);
  else out.push(paint(fit(msg, width), ["green"]));
  const k = (key: string, label: string) => `${paint(key, ["bold"])} ${paint(label, ["dim"])}`;
  const keys = [...(sel?.actions.map((a) => k(a.key, a.label)) ?? []), ...(on(s, 5) ? [k("] [", "section"), k("n", "next like this")] : []), ...(on(s, 1) && !s.locked ? [k("z", s.showDone ? "fold done" : "show done")] : []), s.locked ? k("1 2 3", "tabs") : k("1-6", "fixes"), k("/", "filter"), k("q", "quit")];
  out.push(cut(keys.join(paint(" · ", ["dim"])), width));
  return out.slice(0, height).concat(Array(Math.max(0, height - out.length)).fill("")).join("\n");
}

// ---------------------------------------------------------------- keys

export function handle(s: S, key: Key, model0: CockpitModel, look: Look): { state: S; effect?: any } {
  const model = shaped(model0, s);
  const t = s.tui;
  const typing = t.filtering || t.prompt;
  const ch = key.kind === "char" ? key.char : null;
  const words = t.filter.toLowerCase().split(/\s+/).filter(Boolean);
  const rows = model.rows.filter((r) => words.every((w) => `${r.group ? GROUP_WORD[r.group] : "story"} ${r.unit} ${r.step ?? ""} ${r.title} ${r.preview.report.title} ${r.preview.report.unit.workflow}`.toLowerCase().includes(w)));
  const sel = rows.find((r) => r.id === t.selected) ?? rows[0];
  const go = (r: CockpitRow | undefined) => ({ state: { ...s, tui: { ...t, selected: r?.id ?? t.selected, scroll: 0, shown: null, message: null } } });
  if (!typing && !s.locked && ch && /^[0-6]$/.test(ch)) {
    const n = Number(ch);
    const fixes = new Set(s.fixes);
    if (n === 0) { if (fixes.size === 6) fixes.clear(); else for (let i = 1; i <= 6; i++) fixes.add(i); }
    else if (fixes.has(n)) fixes.delete(n);
    else fixes.add(n);
    const what = n === 0 ? (fixes.size ? "all fixes on" : "all fixes off") : `fix ${n} ${fixes.has(n) ? "on" : "off"}: ${FIXES[n]}`;
    return { state: { ...s, fixes, tui: { ...t, message: { text: what, tone: "info" } } } };
  }
  if (!typing && on(s, 1) && !s.locked && (ch === "z" || (key.kind === "enter" && sel?.id === DONE_ID))) {
    const showDone = !s.showDone;
    const next = { ...s, showDone };
    const first = shaped(model0, next).rows.find((r) => isDone(r) || r.id === DONE_ID);
    return { state: { ...next, tui: { ...t, selected: showDone ? (first?.id ?? t.selected) : DONE_ID, message: null } } };
  }
  if (!typing && on(s, 5) && sel && (ch === "]" || ch === "[")) {
    const i = rows.indexOf(sel);
    const here = section(s, sel);
    if (ch === "]") return go(rows.slice(i + 1).find((r) => section(s, r) !== here));
    // [ : the start of this section, or of the one before when already there
    const before = rows.slice(0, i).reverse();
    const startOf = (sec: string) => rows.find((r) => section(s, r) === sec);
    const prevSec = before.find((r) => section(s, r) !== here);
    return go(rows[i - 1] && section(s, rows[i - 1]!) === here ? startOf(here) : prevSec ? startOf(section(s, prevSec)) : sel);
  }
  if (!typing && on(s, 5) && sel && ch === "n") {
    const like = (r: CockpitRow) => (sel.kind === "item" ? r.group === sel.group : section(s, r) === section(s, sel));
    const i = rows.indexOf(sel);
    return go([...rows.slice(i + 1), ...rows.slice(0, i)].find(like));
  }
  const { state, effect } = handleKey(t, key, model, look);
  return { state: { ...s, tui: state }, ...(effect && effect.kind !== "refresh" ? { effect } : {}) };
}

export const variant: Variant<S> = {
  key: "0+",
  name: "today + fixes",
  init: () => ({ tui: initialState(), fixes: new Set(), showDone: false }),
  handle,
  frame,
};

