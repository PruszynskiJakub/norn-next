/**
 * The lab's dashboard, pure: what its page shows, built from what was read of the lab, and the
 * request handler that serves the page, its state and the person's buttons. Reading the lab and
 * running a button's command are the caller's (`read.ts`, `act.ts`), so this module never touches a
 * file or a process, and every route is a function of what it is handed.
 */
import type { LoadedWorkflow } from "@norn/kernel";
import { parseJson } from "@norn/plugin-api";
import { shellQuote } from "@norn/runtime";
import { Type } from "@sinclair/typebox";
import { ruleCaption } from "../captions.ts";
import { ExitCode, toFailure } from "../output.ts";
import { STANDING } from "../tick-report.ts";
import type { StoryView } from "../views.ts";
import { partOf, workflowMermaid } from "../workflows-page.ts";
import { BREAK_NAMES, type BreakName, BREAKS, isBreak } from "./break-it.ts";
import type { LabView } from "./lab.ts";

/** One receipt as the store keeps it: its place in the unit's record and what it says. */
export interface LabReceipt {
  seq: number;
  at: string;
  data: unknown;
}

/** One action a tick's trace carries, as the dashboard reads it. */
export interface LabTraceOutcome {
  decision: { rule: string; kind: string; unit?: string | null };
  ok: boolean;
  error?: string;
}

export interface LabTrace {
  tick_id: string;
  at: string;
  outcomes: LabTraceOutcome[];
}

/** Everything read of the lab for one look at it. */
export interface LabSources {
  view: LabView;
  /** the workflow the lab's story plays, as the runtime loads it */
  workflow: { name: string; loaded: LoadedWorkflow };
  /** the lab's story as `norn status` shows it, once it exists */
  story: StoryView | null;
  /** the record of the story's own unit: its receipts and its committed state */
  record: { receipts: LabReceipt[]; state: { version: number; data: unknown } | null } | null;
  /** the tick traces, any order */
  traces: LabTrace[];
  /** the story's documents: spec, handoffs, pull request body */
  docs: { path: string; text: string }[];
  /** the newest agent run of the story's unit, with what its session wrote */
  session: { run: string; executor: string; log: string } | null;
}

export interface LabDecision {
  tick: string;
  at: string;
  /** the unit or story it is about, `-` for neither */
  unit: string;
  rule: string;
  kind: string;
  caption: string;
  ok: boolean;
}

export interface LabReceiptLine {
  /** null for the state commit, which has no place among the receipts */
  seq: number | null;
  at: string | null;
  kind: string;
  /** the step, outcome or run it names, said in a few words */
  what: string;
  /** the effect this receipt is written before, when it records one */
  before: string | null;
}

export interface LabNeed {
  unit: string;
  for: string;
  text: string;
  next: string | null;
}

export interface LabActionView {
  name: LabActionName;
  label: string;
  /** the command it runs, as a person types it; `<reason>` and `<answer>` stand for what they type */
  command: string;
  /** what the person types before pressing it */
  input: "reason" | "answer" | null;
  /** `person`: a command a person runs; `break`: a switch that breaks the lab on purpose */
  group: "person" | "break";
}

export interface LabState {
  lab: LabView;
  graph: { workflow: string; mermaid: string; live: string | null; steps: string[] };
  decisions: LabDecision[];
  receipts: { unit: string | null; entries: LabReceiptLine[] };
  needs_you: LabNeed[];
  docs: { path: string; text: string }[];
  session: { run: string; executor: string; log: string } | null;
  actions: LabActionView[];
}

/** How many decisions the panel keeps, newest last. */
export const DECISIONS_SHOWN = 40;

/** The effect each receipt is the record of, written first so a crash between the two is seen. */
const BEFORE: Readonly<Record<string, string>> = {
  "run.started": "the run is launched",
  "run.checking": "the run's processes are stopped and its changes compared",
  "run.resumed": "the session is resumed",
  "answer.sent": "the answer is typed into the session",
  "nudge.sent": "the nudge is typed into the session",
  "stop.sent": "the run is stopped",
  "branch.update": "the branch is updated",
  "run.requested": "the run is started",
};

function receiptLine(r: LabReceipt): LabReceiptLine {
  const d = (r.data ?? {}) as Record<string, unknown>;
  const kind = typeof d.kind === "string" ? d.kind : "unknown";
  const step = typeof d.step === "string" ? [`step ${d.step}${typeof d.attempt === "number" ? ` #${d.attempt}` : ""}`] : [];
  // a run is recorded started before its launch, then again once the launch names its session:
  // the second is the same start, written after the effect, so it is the record of nothing to come
  if (kind === "run.started" && typeof d.session === "string") return { seq: r.seq, at: r.at, kind, what: [...step, `the same run, its session named ${d.session}`].join(", "), before: null };
  const said = ["outcome", "verb", "run_kind", "executor", "reason"].flatMap((k) => (typeof d[k] === "string" ? [`${k} ${d[k]}`] : []));
  return { seq: r.seq, at: r.at, kind, what: [...step, ...said].join(", "), before: BEFORE[kind] ?? null };
}

/** The receipts in the order written, then the state committed after them all, the record's commit point. */
function receiptLines(record: LabSources["record"]): LabReceiptLine[] {
  if (record === null) return [];
  const lines = [...record.receipts].sort((a, b) => a.seq - b.seq).map(receiptLine);
  const state = record.state;
  if (state !== null) {
    const d = (state.data ?? {}) as { step?: unknown; applied_through?: unknown };
    const said = [`version ${state.version}`, ...(typeof d.step === "string" ? [`step ${d.step}`] : []), ...(typeof d.applied_through === "number" ? [`receipts 1–${d.applied_through} applied`] : [])];
    lines.push({ seq: null, at: null, kind: "state.committed", what: said.join(", "), before: null });
  }
  return lines;
}

function decisions(traces: readonly LabTrace[]): LabDecision[] {
  const sorted = [...traces].sort((a, b) => (a.tick_id < b.tick_id ? -1 : a.tick_id > b.tick_id ? 1 : 0));
  const out = sorted.flatMap((t) =>
    t.outcomes
      // a tick of only waiting asks again for what it asked before: the panel shows what moved
      .filter((o) => !(o.ok && STANDING.has(o.decision.kind)))
      .map((o) => ({
        tick: t.tick_id,
        at: t.at,
        unit: o.decision.unit ?? "-",
        rule: o.decision.rule,
        kind: o.decision.kind,
        caption: ruleCaption(o.decision.rule) ?? o.decision.rule,
        ok: o.ok,
      })),
  );
  return out.slice(-DECISIONS_SHOWN);
}

/** What waits for the person, unit by unit, as `norn status` lists it under Needs you. */
function needs(story: StoryView | null): LabNeed[] {
  if (story === null) return [];
  const out: LabNeed[] = [];
  if (story.unsynced?.waiting) out.push({ unit: story.key, for: "person", text: `run data unsynced: ${story.unsynced.text}`, next: story.unsynced.next });
  for (const u of story.units) if (u.waiting !== null) out.push({ unit: u.id, for: u.waiting.for, text: u.waiting.text, next: u.waiting.next ?? null });
  return out;
}

/** The workflow's main graph, only the shared part holding the live step opened, and that step lit. */
function graph(w: LabSources["workflow"], live: string | null): LabState["graph"] {
  const known = live !== null && w.loaded.graph.steps[live] !== undefined ? live : null;
  const mermaid = workflowMermaid(w.loaded, { expand: known === null ? null : partOf(w.loaded, known), live: known });
  return { workflow: w.name, mermaid, live, steps: Object.keys(w.loaded.graph.steps) };
}

export const LAB_PERSON_ACTIONS = ["approve", "reject", "answer", "rerun", "merge", "round", "reset"] as const;
export const LAB_ACTION_NAMES = [...LAB_PERSON_ACTIONS, ...BREAK_NAMES] as const;
export type LabActionName = (typeof LAB_ACTION_NAMES)[number];
type PersonActionName = (typeof LAB_PERSON_ACTIONS)[number];

/**
 * What a button runs: a norn command (run on the lab's own build), a shell line, the lab's own reset,
 * or a break-it switch, whose shell line is planned from the lab as it is when pressed.
 */
export type LabCommand = { kind: "norn"; args: string[] } | { kind: "shell"; line: string } | { kind: "reset" } | { kind: "break"; name: BreakName; key: string };

const PLACEHOLDER = { reason: "<reason>", answer: "<answer>" } as const;

interface ActionSpec {
  label: string;
  input: "reason" | "answer" | null;
  command(c: { key: string; workflow: string; merge: string }, typed: string): LabCommand;
}

/** The person's buttons: each runs the real command a person types, and nothing else. */
const PERSON_ACTIONS: Readonly<Record<PersonActionName, ActionSpec>> = {
  approve: { label: "Approve the gate", input: null, command: ({ key }) => ({ kind: "norn", args: ["story", "approve", key] }) },
  reject: { label: "Reject the gate", input: "reason", command: ({ key }, reason) => ({ kind: "norn", args: ["story", "reject", key, "--reason", reason] }) },
  answer: { label: "Answer the question", input: "answer", command: ({ key }, answer) => ({ kind: "norn", args: ["story", "answer", key, answer] }) },
  rerun: { label: "Rerun the unit", input: null, command: ({ key }) => ({ kind: "norn", args: ["run", "rerun", key] }) },
  merge: { label: "Merge with git", input: null, command: ({ merge }) => ({ kind: "shell", line: merge }) },
  round: { label: "Start a new round", input: null, command: ({ key, workflow }) => ({ kind: "norn", args: ["story", "round", key, "--workflow", workflow] }) },
  reset: { label: "Reset the lab", input: null, command: () => ({ kind: "reset" }) },
};

const breakSpec = (name: BreakName): ActionSpec => ({ label: BREAKS[name].label, input: null, command: ({ key }) => ({ kind: "break", name, key }) });

const ACTIONS: Readonly<Record<LabActionName, ActionSpec>> = {
  ...PERSON_ACTIONS,
  ...(Object.fromEntries(BREAK_NAMES.map((n) => [n, breakSpec(n)])) as Record<BreakName, ActionSpec>),
};

export const LAB_RESET_COMMAND = "norn lab --clean";

/** The command as a person reads it. */
export function commandText(c: LabCommand): string {
  if (c.kind === "norn") return `norn ${shellQuote(c.args)}`;
  if (c.kind === "shell") return c.line;
  if (c.kind === "break") return BREAKS[c.name].preview;
  return LAB_RESET_COMMAND;
}

export interface LabActionContext {
  key: string;
  workflow: string;
  /** the git merge a person runs to land the story's branch */
  merge: string;
}

/**
 * The command `name` runs for what the person typed; null when it needs the lab's story and there is
 * none yet (`c` null), or needs input they left empty. Reset needs neither.
 */
export function buttonCommand(name: LabActionName, c: LabActionContext | null, typed: string | undefined): LabCommand | null {
  const spec = ACTIONS[name];
  if (name === "reset") return { kind: "reset" };
  const text = typed?.trim() ?? "";
  if (c === null || (spec.input !== null && text === "")) return null;
  return spec.command(c, text);
}

function actionViews(c: LabActionContext | null): LabActionView[] {
  return LAB_ACTION_NAMES.map((name) => {
    const spec = ACTIONS[name];
    const command = c === null ? (name === "reset" ? LAB_RESET_COMMAND : "(the lab has no story yet)") : commandText(spec.command(c, spec.input === null ? "" : PLACEHOLDER[spec.input]));
    return { name, label: spec.label, command, input: spec.input, group: isBreak(name) ? "break" : "person" };
  });
}

/** What the page shows, from what was read of the lab. */
export function dashboardState(s: LabSources, merge: (key: string) => string): LabState {
  const unit = s.story?.units.find((u) => u.id === s.story?.key) ?? s.story?.units[0] ?? null;
  const key = s.view.story;
  return {
    lab: s.view,
    graph: graph(s.workflow, unit?.ended === undefined ? (unit?.step ?? null) : null),
    decisions: decisions(s.traces),
    receipts: { unit: key, entries: receiptLines(s.record) },
    needs_you: needs(s.story),
    docs: s.docs,
    session: s.session,
    actions: actionViews(key === null ? null : { key, workflow: s.workflow.name, merge: merge(key) }),
  };
}

/** What a pressed button answers: the command it ran and how it went, and for a break-it switch the way out of what it did. */
export interface LabActAnswer {
  action: LabActionName;
  command: string;
  exit: number;
  output: string;
  way_out: string | null;
}

export interface LabHandlerDeps {
  /** the page itself */
  page: string;
  state(): Promise<LabState>;
  /** runs the button's command; only a known name with the input it needs reaches it */
  act(name: LabActionName, typed: string | undefined): Promise<LabActAnswer>;
}

const json = (value: unknown, status = 200): Response => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
const refusal = (status: number, error: string, do_instead: string | null, code: string): Response => json({ error, do_instead, code }, status);
const isAction = (name: string): name is LabActionName => (LAB_ACTION_NAMES as readonly string[]).includes(name);

/** A button's body: what the person typed, when it needs that. */
const ActBody = Type.Object({ text: Type.Optional(Type.String()) });

async function typedOf(req: Request): Promise<string | undefined> {
  const text = await req.text();
  if (text.trim() === "") return undefined;
  const body = parseJson(ActBody, text, "the button's body");
  return body.ok ? body.value.text : undefined;
}

/** The names this machine's loopback answers to; a DNS-rebound page sends its own name as Host. */
const LOOPBACK_NAMES: ReadonlySet<string> = new Set(["127.0.0.1", "localhost", "[::1]"]);

/** The request's Host as the browser sent it; a request built in process has only its URL. */
const hostOf = (req: Request): string => req.headers.get("host") ?? new URL(req.url).host;

function isLoopbackHost(host: string): boolean {
  const name = host.startsWith("[") ? host.slice(0, host.indexOf("]") + 1) : (host.split(":")[0] ?? "");
  return LOOPBACK_NAMES.has(name.toLowerCase());
}

/**
 * Why a button press came from another page, or null when it came from the dashboard's own. A browser
 * sends Origin (and Sec-Fetch-Site) on every POST, so a foreign one is caught there; a request with
 * neither is a shell's, the person's own.
 */
function foreignPress(req: Request, host: string): string | null {
  const origin = req.headers.get("origin");
  if (origin !== null && origin !== `http://${host}`) return `a button pressed from ${origin}, not from the dashboard at http://${host}`;
  const site = req.headers.get("sec-fetch-site");
  if (site !== null && site !== "same-origin" && site !== "none") return `a button pressed from a ${site} page, not from the dashboard`;
  return null;
}

/** A JSON body is one a cross-origin page cannot send without a preflight, which is never granted. */
const isJsonBody = (req: Request): boolean => (req.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase() === "application/json";

/**
 * The dashboard's routes: `GET /` the page, `GET /api/state` what it shows, `POST /api/act/<name>`
 * a button, its body `{"text": ...}` when it needs what the person typed. Anything else is refused,
 * and so is any request another page sends: the loopback binding keeps other machines out, not a
 * page in the person's own browser.
 */
export function labHandler(deps: LabHandlerDeps): (req: Request) => Promise<Response> {
  return async (req) => {
    const path = new URL(req.url).pathname;
    const host = hostOf(req);
    if (!isLoopbackHost(host)) return refusal(403, `the lab's dashboard answers only at 127.0.0.1, not at ${host}`, "open the URL norn lab printed", "foreign_host");
    try {
      if (path === "/" || path === "/index.html") {
        if (req.method !== "GET") return refusal(405, `${req.method} ${path} is not served`, `GET ${path}`, "method_not_allowed");
        return new Response(deps.page, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
      }
      if (path === "/api/state") {
        if (req.method !== "GET") return refusal(405, `${req.method} ${path} is not served`, "GET /api/state", "method_not_allowed");
        return json(await deps.state());
      }
      const act = /^\/api\/act\/([^/]+)$/.exec(path);
      if (act !== null) {
        const name = act[1] as string;
        if (!isAction(name)) return refusal(404, `the lab has no button ${JSON.stringify(name)}`, `POST /api/act/<${LAB_ACTION_NAMES.join("|")}>`, "unknown_action");
        if (req.method !== "POST") return refusal(405, `${req.method} ${path} is not served`, `POST ${path}`, "method_not_allowed");
        const foreign = foreignPress(req, host);
        if (foreign !== null) return refusal(403, foreign, "press the button on the dashboard norn lab printed", "foreign_origin");
        if (!isJsonBody(req)) return refusal(415, `a button's body is JSON, sent with content-type application/json`, `POST ${path} with content-type application/json`, "not_json");
        const typed = await typedOf(req);
        const input = ACTIONS[name].input;
        if (input !== null && (typed?.trim() ?? "") === "") return refusal(400, `${name} needs the ${input} you type`, `POST ${path} with {"text": "<${input}>"}`, "input_missing");
        return json(await deps.act(name, typed));
      }
      return refusal(404, `${path} is not part of the lab's dashboard`, "GET /", "not_found");
    } catch (e) {
      const f = toFailure(e);
      return json(f.body, f.exit === ExitCode.refused ? 409 : 500);
    }
  };
}
