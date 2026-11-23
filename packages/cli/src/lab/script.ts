/**
 * The lab's script, read from the pack's `SDLC_LAB`: the story it plays, the check, and its eight
 * beats. The beat a lab is at is read from the story's state alone, so a lab stopped anywhere resumes
 * at the beat its story shows, and no file of the lab's own keeps it.
 */
import { LabBeats } from "@norn/harness-lab";
import { SDLC_LAB } from "@norn/pack-sdlc";
import { check } from "@norn/schema";
import { type Static, type TSchema, Type } from "@sinclair/typebox";
import { parse } from "yaml";

const Text = Type.String({ minLength: 1 });
const Names = Type.Array(Text, { minItems: 1 });

/** A person's command at a beat, and when it is theirs: what the unit waits on, its step, a counter it has not spent. */
const YouAct = Type.Object(
  { for: Type.Optional(Text), steps: Type.Optional(Names), unspent: Type.Optional(Text), run: Text },
  { additionalProperties: false },
);

export const LabBeatScript = Type.Object(
  {
    n: Type.Integer({ minimum: 1 }),
    title: Text,
    /** what norn did, said for a newcomer */
    caption: Text,
    /** where to look: a file, a command or a status field */
    look: Text,
    /** the story's state that places it in this beat: its step, a counter it spent, or its end */
    when: Type.Object({ steps: Type.Optional(Names), counters: Type.Optional(Names), ended: Type.Optional(Type.Boolean()) }, { additionalProperties: false }),
    /** the person's own commands at this beat; the first whose match the unit meets is theirs to run */
    you: Type.Optional(Type.Array(YouAct, { minItems: 1 })),
  },
  { additionalProperties: false },
);
export type LabBeatScript = Static<typeof LabBeatScript>;

export const LabScript = Type.Object(
  {
    workflow: Text,
    /** the toy app's test, the lab's `checks.test` */
    check: Text,
    story: Type.Object({ title: Text, body: Text }, { additionalProperties: false }),
    act: Text,
    beats: Type.Array(LabBeatScript, { minItems: 1 }),
  },
  { additionalProperties: false },
);
export type LabScript = Static<typeof LabScript>;

function parsed<S extends TSchema>(schema: S, text: string, what: string): Static<S> {
  const r = check(schema, parse(text) as unknown);
  // the pack's own files: one that does not validate is a broken build, never a person's mistake
  if (!r.ok) throw new Error(`${what} does not validate: ${r.errors.map((e) => `${e.path || "/"} ${e.message}`).join("; ")}`);
  return r.value;
}

export const labScript = (): LabScript => parsed(LabScript, SDLC_LAB.script, "the lab's beat script");
export const labAgentBeats = (): LabBeats => parsed(LabBeats, SDLC_LAB.agent, "the lab agent's beats");

/** The part of a unit in `norn status --json` the lab reads. */
export const LabUnit = Type.Object({
  id: Text,
  step: Type.Union([Text, Type.Null()]),
  ended: Type.Optional(Text),
  waiting: Type.Union([Type.Object({ for: Text, text: Type.String(), next: Type.Optional(Text) }), Type.Null()]),
  counters: Type.Record(Text, Type.Object({ value: Type.Integer(), max: Type.Integer() })),
  /** receipts not yet applied: a person's decision the next tick takes in */
  pending_receipts: Type.Optional(Type.Integer({ minimum: 0 })),
});
export type LabUnit = Static<typeof LabUnit>;

/** The highest beat whose `when` the unit's state meets; the first beat before a unit exists. */
const spent = (unit: LabUnit, c: string): boolean => (unit.counters[c]?.value ?? 0) > 0;

export function beatOf(script: LabScript, unit: LabUnit | null): LabBeatScript {
  const first = script.beats[0] as LabBeatScript;
  if (unit === null) return first;
  const meets = ({ when }: LabBeatScript): boolean =>
    (when.ended === true && unit.ended !== undefined) || (unit.step !== null && (when.steps ?? []).includes(unit.step)) || (when.counters ?? []).some((c) => spent(unit, c));
  return [...script.beats].sort((a, b) => b.n - a.n).find(meets) ?? first;
}

/** The script's text for one story: `{key}` is its key. */
export const forStory = (text: string, key: string): string => text.replaceAll("{key}", key);

/** The person's own command at the unit's beat, as the script says it; null when nothing there is theirs, or once it ended. */
export function personCommand(beat: LabBeatScript, unit: LabUnit, key: string): string | null {
  if (unit.ended !== undefined) return null;
  const holds = (y: NonNullable<LabBeatScript["you"]>[number]): boolean =>
    (y.for === undefined || unit.waiting?.for === y.for) && (y.steps === undefined || (unit.step !== null && y.steps.includes(unit.step))) && (y.unspent === undefined || !spent(unit, y.unspent));
  const you = beat.you?.find(holds);
  return you === undefined ? null : forStory(you.run, key);
}

/**
 * The command that moves the story on: what it waits on the person for, else the person's own
 * command at the beat, else the script's act (a tick); null once it ended.
 */
export function nextCommand(script: LabScript, beat: LabBeatScript, key: string | null, unit: LabUnit | null): string | null {
  if (unit?.ended !== undefined) return null;
  if (unit?.waiting?.next !== undefined) return unit.waiting.next;
  return (key !== null && unit !== null ? personCommand(beat, unit, key) : null) ?? script.act;
}

/** The git merge a person runs to land the story's branch: the last beat's own command, for one story. */
export function labMerge(script: LabScript, key: string): string {
  const run = script.beats.at(-1)?.you?.at(-1)?.run;
  // the pack's own script: a last beat with no command of the person's is a broken build, never a person's mistake
  if (run === undefined) throw new Error("the lab's last beat names no merge");
  return forStory(run, key);
}
