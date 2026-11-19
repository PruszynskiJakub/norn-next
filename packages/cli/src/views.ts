/**
 * The read model `status`, `story list` and `story view` print: the facts a tick would decide from,
 * gathered and never acted on, shaped for a person. What waits for a person (a gate, a question, a
 * parked or stuck unit) is named per unit, so `status` reads as a list of what needs doing.
 */
import { ASKED_PARK, ITEM_CLOSED_REASON, isChangeClosedReason, type KernelCapabilities, type KernelWorkflows, type StoryFacts, type UnitFacts, unsyncedReason } from "@norn/kernel";
import { gatherFacts, newTickId, type RuntimeEnv } from "@norn/runtime";
import { refuse } from "./output.ts";

export interface UnitView {
  id: string;
  /** null: nothing committed yet */
  step: string | null;
  /** the step's kind: agent, check, gate, or a plugin's */
  kind: string | null;
  attempt: number | null;
  workflow: string | null;
  ended?: string;
  ended_reason?: string;
  parked?: string;
  corrupt?: string;
  run: { id: string; executor: string; started_at: string; activity: string | null } | null;
  /** what a person is asked for, when anything */
  waiting: {
    for: "gate" | "answer" | "permission" | "person";
    /** the question, prompt or reason itself, never a rule id */
    text: string;
    /** the command that answers it, when one does */
    next?: string;
  } | null;
  /** receipts taken but not yet applied by a tick */
  pending_receipts: number;
}

export interface StoryView {
  key: string;
  title: string | null;
  url: string | null;
  open: boolean | null;
  claim: { holder: string; expires_at: string } | null;
  /** `merge_sha` once the change merged and the forge names the commit it landed as */
  change: { id: number; state: string; url: string | null; merge_sha?: string } | null;
  /**
   * This clone's run data of the story and the remote's diverged: no flush can publish it, and while
   * this machine holds the claim its ticks hold the story. Absent when they agree. `waiting`: only a
   * person resolves it; another holder's story is resolved by this machine's next tick.
   */
  unsynced?: { text: string; next: string; waiting: boolean };
  units: UnitView[];
}

export interface IntakeView {
  key: string;
  title: string;
  url: string | null;
}

export interface ProjectView {
  stories: StoryView[];
  /** open items the intake query matches that no tick has taken yet */
  intake: IntakeView[];
  problems: string[];
}

/** Why a park a rule derived from facts waits for `norn run rerun`, said for a person. */
const STUCK_PARKS: Readonly<Record<string, string>> = {
  "agent.no_executor": "its step's executor is not configured",
  "agent.died.manual": "its run ended without a report",
  "agent.silent.manual": "its run went quiet without a report",
  "agent.turn_ended.manual": "its run ended its turn without a report",
  "agent.limited.manual": "its run came back from a usage limit without a report",
  "agent.limited.unknown": "its run hit a usage limit with no reset time given",
  "agent.retry.no_headless": "its run needs a fresh session, and its executor cannot run headless",
  "agent.reported.rejected": "what its agent reported is not an outcome of its step",
  "check.finished.rejected": "its check's outcome is not one the step declares",
  "step.finished.rejected": "its step's outcome is not one the step declares",
};

/** What the unit waits on a person for, said as the question or prompt itself, and the command that answers it. */
function waitingOf(u: UnitFacts, kind: string | null, prompt: string | undefined, dialogKeys: boolean): UnitView["waiting"] {
  const s = u.state;
  if (!s || s.ended === "done") return null;
  const id = u.id;
  const rerun = `norn run rerun ${id}`;
  const decide = `norn story approve ${id}, or norn story reject ${id} --reason "<what to change>"`;
  const newWork = 'norn story create "<title>" for the new work';
  if (s.ended) {
    const next = s.ended_reason === ITEM_CLOSED_REASON ? `reopen the item, then ${rerun}; or ${newWork}` : rerun;
    return { for: "person", text: `ended ${s.ended}${s.ended_reason ? `: ${s.ended_reason}` : ""}`, ...(s.ended === "stuck" && { next }) };
  }
  const reason = s.parked?.reason;
  const permission = u.session?.permission;
  // a park a rule derived from facts is named by its rule; the view says what that rule waits for
  switch (reason) {
    case undefined:
      break;
    case "agent.ready.manual":
      return { for: "person", text: "manual mode: its agent waits for a person to start it", next: `norn run start ${id}` };
    case "agent.ready.attended":
      return { for: "person", text: "an attended step: its agent starts where a person works beside it", next: `norn run start ${id}` };
    case "agent.ready.no_headless":
      return { for: "person", text: "auto mode, but its executor cannot run headless: a person starts it in a pane", next: `norn run start ${id}` };
    case "agent.asking.park":
      return { for: "answer", text: u.session?.ask?.question ?? "its agent asks a question", next: `norn story answer ${id} "<answer>"` };
    // the answer goes into the run's session, or with a fresh one's brief when the session is gone; a rerun would drop the question
    case ASKED_PARK:
      return { for: "answer", text: s.parked?.text ?? u.session?.ask?.question ?? "its agent asks a question", next: `norn story answer ${id} "<answer>"` };
    case "agent.permission.park":
      return {
        for: "permission",
        text: permission ? (permission.call ? `${permission.call.tool}: ${permission.prompt}` : permission.prompt) : "its agent waits for a permission in its pane",
        next: `norn story answer ${id} <option> (1 allows it, no refuses it)`,
      };
    case "agent.no_events.park":
      return {
        for: "permission",
        // the pane read this tick names the dialog itself; without it the view can only say what it most likely is
        text: u.run_dialog
          ? `its agent waits on a dialog in its pane: ${u.run_dialog}`
          : "its agent runs in its pane but has sent no event, so its hooks never loaded: the pane most likely shows a trust prompt; trust the folder there",
        next: `${dialogKeys ? `norn story answer ${id} yes, or ` : ""}${rerun} if the pane shows something else`,
      };
    case "gate.park":
      return { for: "gate", text: prompt ?? s.step, next: decide };
    default:
      // a rerun alone would see the closed change park the unit again on the next tick
      if (isChangeClosedReason(reason)) return { for: "person", text: reason, next: `reopen the change on the forge, then ${rerun}; or ${newWork}` };
      // an agent's ask and a person's stop park a live run under their own text; the answer goes into
      // that session, where a rerun would throw the question and the session away
      if (!STUCK_PARKS[reason] && kind === "agent" && s.run) return { for: "answer", text: reason, next: `norn story answer ${id} "<answer>"` };
      // a park no rule derives (slice files that failed validation) holds until a person moves the unit on
      return { for: "person", text: STUCK_PARKS[reason] ?? reason, next: rerun };
  }
  if (u.session?.ask) return { for: "answer", text: u.session.ask.question, next: `norn story answer ${id} "<answer>"` };
  if (permission) return { for: "permission", text: permission.call ? `${permission.call.tool}: ${permission.prompt}` : permission.prompt, next: `norn story answer ${id} <option>` };
  if (kind === "gate") return { for: "gate", text: prompt ?? s.step, next: decide };
  return null;
}

/** `executors`: what each executor can do; without them no dialog is offered to story answer */
export function unitView(u: UnitFacts, workflows: KernelWorkflows, executors: KernelCapabilities["executors"] = {}): UnitView {
  const s = u.state;
  const step = s ? workflows.byHash[s.workflow.hash]?.graph.steps[s.step] : undefined;
  const kind = step?.kind ?? null;
  return {
    id: u.id,
    step: s?.step ?? null,
    kind,
    attempt: s?.attempt ?? null,
    workflow: s?.workflow.name ?? null,
    ...(s?.ended ? { ended: s.ended } : {}),
    ...(s?.ended_reason ? { ended_reason: s.ended_reason } : {}),
    ...(s?.parked ? { parked: s.parked.reason } : {}),
    ...(u.corrupt ? { corrupt: u.corrupt } : {}),
    run: s?.run ? { id: s.run.id, executor: s.run.executor, started_at: s.run.started_at, activity: u.session?.activity ?? null } : null,
    waiting: u.corrupt ? { for: "person", text: `corrupt: ${u.corrupt}` } : waitingOf(u, kind, step?.gate?.prompt, s?.run ? executors[s.run.executor]?.dialogKeys === true : false),
    pending_receipts: u.receipts.length,
  };
}

/** What a diverged store means for the story on this machine, and the command that carries it on from the remote's record. */
function unsyncedOf(s: StoryFacts, holder: string | undefined): StoryView["unsynced"] {
  if (s.unsynced !== true) return undefined;
  if (s.claim !== null && s.claim.holder === holder) return { text: unsyncedReason(s.key), next: `norn story take ${s.key} --force`, waiting: true };
  // only the holder's writes are published, so another holder's story is carried on from the remote's record by a plain tick
  if (s.claim !== null)
    return {
      text: `this clone holds run data of ${s.key} the remote never had, from before ${s.claim.holder} took the claim; the next tick here drops it for the remote's record, keeping it under a ref`,
      next: "norn tick",
      waiting: false,
    };
  return { text: `this clone holds run data of ${s.key} the remote never had; it is dropped for the remote's record (kept under a ref) when this machine takes the story`, next: `norn story take ${s.key}`, waiting: true };
}

/** `holder`: who this machine claims as, so a diverged store is said for the holder or for another machine */
export function storyView(s: StoryFacts, workflows: KernelWorkflows, executors: KernelCapabilities["executors"] = {}, holder?: string): StoryView {
  const unsynced = unsyncedOf(s, holder);
  return {
    key: s.key,
    title: s.item?.title ?? null,
    url: s.item?.url ?? null,
    open: s.item ? s.item.open : null,
    claim: s.claim ? { holder: s.claim.holder, expires_at: s.claim.expires_at } : null,
    change: s.change ? { id: s.change.id, state: s.change.state, url: s.change.url ?? null, ...(s.change.merge_sha !== undefined && { merge_sha: s.change.merge_sha }) } : null,
    ...(unsynced && { unsynced }),
    units: s.units.map((u) => unitView(u, workflows, executors)),
  };
}

/** The facts of a tick that never acts: the same reads, so what is shown is what the next tick decides from. */
export async function loadProjectView(env: RuntimeEnv): Promise<ProjectView> {
  // outside the tick lock: a view that wrote what it read would race the tick's own writes
  const gathered = await gatherFacts(env, newTickId(env.ctx.now()), { readOnly: true });
  if (!gathered.ok) throw refuse(`the store could not be read: ${gathered.failure.message}`, "norn doctor", "facts_unavailable");
  const { facts, workflows, problems } = gathered.value;
  return {
    stories: facts.stories.map((s) => storyView(s, workflows, facts.capabilities.executors, facts.holder)),
    // an item a tick took is a story from then on, whatever the tracker's query still matches
    intake: facts.intake.filter((i) => !facts.stories.some((s) => s.key === i.key)).map((i) => ({ key: i.key, title: i.title, url: i.url ?? null })),
    problems,
  };
}

export function unitLine(u: UnitView): string {
  if (u.corrupt !== undefined) return `${u.id}: corrupt — ${u.corrupt}`;
  if (!u.step) return `${u.id}: not started`;
  const where = `${u.id}: ${u.step}${u.kind ? ` (${u.kind})` : ""}${u.attempt && u.attempt > 1 ? ` attempt ${u.attempt}` : ""}`;
  if (u.ended === "done") return `${where}, done`;
  const run = u.run ? `, run by ${u.run.executor}${u.run.activity ? ` (${u.run.activity})` : ""}` : "";
  const waiting = u.waiting ? ` — waits for ${u.waiting.for}: ${u.waiting.text}${u.waiting.next ? ` → ${u.waiting.next}` : ""}` : "";
  return `${where}${run}${waiting}`;
}

export function storyHead(s: StoryView): string {
  const change = s.change ? `, change #${s.change.id} ${s.change.state}` : "";
  const claim = s.claim ? `, claimed by ${s.claim.holder}` : "";
  const unsynced = s.unsynced ? ` — run data unsynced: ${s.unsynced.text} → ${s.unsynced.next}` : "";
  return `${s.key}${s.title ? ` ${s.title}` : ""}${claim}${change}${unsynced}`;
}
