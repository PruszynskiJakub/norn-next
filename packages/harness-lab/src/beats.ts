/**
 * The beat script: what the stand-in agent does at each visit of a step. A beat is looked up by the
 * workflow, step and attempt its brief names, so a story plays the same every time.
 */
import { type Static, Type } from "@sinclair/typebox";

const Text = Type.String({ minLength: 1 });

export const LabReport = Type.Union([
  Type.Object({ verb: Type.Literal("done"), outcome: Text }, { additionalProperties: false }),
  Type.Object({ verb: Type.Literal("ask"), question: Text }, { additionalProperties: false }),
  Type.Object({ verb: Type.Literal("stuck"), reason: Text }, { additionalProperties: false }),
  /** the agent dies without a report, as a crashed session does: no stop, no end, only its exit code */
  Type.Object({ verb: Type.Literal("exit"), code: Type.Integer({ minimum: 0, maximum: 255 }) }, { additionalProperties: false }),
]);
export type LabReport = Static<typeof LabReport>;

export const LabWork = Type.Object(
  {
    /** files to write, by path relative to the worktree */
    files: Type.Optional(Type.Record(Text, Type.String())),
    /** commit everything the work left, with this message */
    commit: Type.Optional(Text),
    report: LabReport,
  },
  { additionalProperties: false },
);
export type LabWork = Static<typeof LabWork>;

export const LabBeat = Type.Object(
  {
    workflow: Text,
    step: Text,
    /** the visit it plays at; absent, every visit that has no beat of its own */
    attempt: Type.Optional(Type.Integer({ minimum: 1 })),
    work: LabWork,
    /** what a resumed session does instead, such as after the person answered its question */
    resumed: Type.Optional(LabWork),
  },
  { additionalProperties: false },
);
export type LabBeat = Static<typeof LabBeat>;

export const LabBeats = Type.Array(LabBeat, { title: "LabBeats", description: "The stand-in agent's beat script" });
export type LabBeats = Static<typeof LabBeats>;

/** Where a run stands, as its brief names it. */
export interface LabVisit {
  workflow: string;
  step: string;
  attempt: number;
}

/** The beat of the visit itself, else the step's beat for every visit. */
export function beatFor(beats: readonly LabBeat[], at: LabVisit): LabBeat | undefined {
  const ofStep = beats.filter((b) => b.workflow === at.workflow && b.step === at.step);
  return ofStep.find((b) => b.attempt === at.attempt) ?? ofStep.find((b) => b.attempt === undefined);
}
