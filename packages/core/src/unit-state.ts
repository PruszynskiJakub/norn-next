/**
 * The transitions of `UnitState`, one per status, and the reading of older shapes.
 * Every helper spreads the state it is given and overrides keys that already exist, so
 * state.json keeps its key order (the effect transcripts embed it verbatim). None stamps
 * `updated_at` or `last_tick_id`: the caller owns when a state is committed. A step name is
 * a plain string to the types, so the helpers cannot refuse a `$done` cursor for a status that
 * never sits there; the golden cases and the property tests guard that.
 */
import {
  type CorruptState,
  type DoneState,
  type ParkedState,
  type ParkKind,
  type ReadyState,
  type RunInfo,
  type RunningState,
  type StuckState,
  type UnitState,
  type UnitStateRecord,
  validate,
} from "@norn/schema";

type ParkedPark = ParkedState["park"];
type StuckPark = StuckState["park"];
type WorkflowPark = NonNullable<DoneState["park"]>;

/** `ended` belongs to a closed round: done, or corrupt while it was being closed. */
function strip<T extends UnitStateRecord>(st: T): Omit<T, "ended"> {
  if (!("ended" in st)) return st;
  const { ended: _, ...rest } = st;
  return rest;
}

export const toReady = (st: UnitStateRecord): ReadyState => ({ ...strip(st), status: "ready", park: null, run: null });

export const toRunning = (st: UnitStateRecord, run: RunInfo): RunningState => ({ ...strip(st), status: "running", park: null, run });

/** Parks for a person; the run an ask interrupted is kept. */
export const toParked = (st: UnitStateRecord, park: ParkedPark): ParkedState => ({ ...strip(st), status: "parked", park });

/** Stops for `norn run rerun`; the run is kept so its session can still be stopped. */
export const toStuck = (st: UnitStateRecord, park: StuckPark): StuckState => ({ ...strip(st), status: "stuck", park });

export const toDone = (st: UnitStateRecord): DoneState => ({ ...st, step: "$done", status: "done", park: null, run: null });

/**
 * A round receipt rejected because its workflow file changed, on a finished round: a done
 * unit holds the park and stays done; one parked at `$done` for its PR is re-parked on it.
 */
export function roundRejected(st: DoneState | StuckState, park: WorkflowPark): DoneState | StuckState {
  return st.status === "done" ? { ...st, park } : toStuck(st, park);
}

export const toCorrupt = (st: UnitStateRecord, reason: string, since: string): CorruptState => ({
  ...st,
  status: "corrupt",
  park: { kind: "corrupt", reason, since },
});

const PARKED: readonly ParkKind[] = ["ask", "gate", "attended"];
const STUCK: readonly ParkKind[] = ["stuck", "exhausted", "remote", "workflow"];

/**
 * The `UnitState` a state.json read as `UnitStateRecord` stands for. Older norns and older
 * branches (and other machines' record refs) still carry shapes the union rejects, and reading
 * them as corrupt would stop a story, so every record maps to the nearest legal state: a
 * contradiction that cannot be resolved without guessing becomes stuck, for a person to rerun.
 * Total and deterministic; a record that is already legal comes back as the same reference.
 */
export function normalizeUnitState(r: UnitStateRecord): UnitState {
  if (validate("state", r).ok) return r as UnitState;
  const since = r.park?.since ?? r.updated_at;
  const stuck = (reason: string) => toStuck(r, { kind: "stuck", reason, since });
  // A park of a kind the status does not admit keeps its words under the plain stuck kind
  const asStuck = (p: NonNullable<UnitStateRecord["park"]>): StuckPark =>
    STUCK.includes(p.kind) ? (p as StuckPark) : { ...p, kind: "stuck" };
  switch (r.status) {
    case "done": {
      const done = toDone(r);
      return r.park?.kind === "workflow" ? { ...done, park: r.park as WorkflowPark } : done;
    }
    case "ready":
      return r.step === "$done" ? toDone(r) : toReady(r);
    case "running":
      if (r.step === "$done") return toDone(r);
      return r.run ? toRunning(r, r.run) : stuck("running without a run record");
    case "parked":
      if (r.step === "$done") return toDone(r);
      if (!r.park) return stuck("parked without a reason");
      return PARKED.includes(r.park.kind) ? toParked(r, r.park as ParkedPark) : toStuck(r, asStuck(r.park));
    case "stuck":
      return r.park ? toStuck(r, asStuck(r.park)) : stuck("stuck");
    case "corrupt":
      return r.park?.kind === "corrupt" ? (r as CorruptState) : toCorrupt(r, r.park?.reason ?? "corrupt", since);
  }
}
