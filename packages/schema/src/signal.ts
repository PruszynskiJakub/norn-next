/**
 * A signal: what a plugin saw outside norn, in one envelope decide routes on by its `kind`, the way
 * it routes an outcome. A signal here is a condition: it holds now and is read again every tick,
 * never acknowledged, so a tick run twice decides alike. `data` is carried into the receipt and the
 * agent's inputs, never routed on.
 */
import { type Static, Type } from "@sinclair/typebox";
import { IsoTime, NonEmpty } from "./common.ts";

/** Every kind a signal can have; an await step listing any other is refused when its workflow loads. */
export const SIGNAL_KINDS = ["ci.pending", "ci.passed", "ci.failed", "ci.none", "change.merged", "change.closed"] as const;
export type SignalKind = (typeof SIGNAL_KINDS)[number];

/** The kinds about the checks on a change's head: a forge reports them only where its `checks` capability says so. */
export const CI_SIGNAL_KINDS: readonly SignalKind[] = ["ci.pending", "ci.passed", "ci.failed", "ci.none"];

export const SignalKindSchema = Type.Union(SIGNAL_KINDS.map((k) => Type.Literal(k)));

export const SignalSource = Type.Literal("forge");
export type SignalSource = Static<typeof SignalSource>;

/** One check that failed on a change's head, and where, so an agent finds the failure without asking the forge. */
export const FailedCheck = Type.Object(
  {
    name: NonEmpty,
    url: Type.Optional(NonEmpty),
    /** the check was cancelled rather than failed; a cancelled check never reads as a pass */
    cancelled: Type.Optional(Type.Boolean()),
    annotations: Type.Array(
      Type.Object({ path: NonEmpty, line: Type.Optional(Type.Integer({ minimum: 1 })), message: Type.String() }, { additionalProperties: false }),
    ),
  },
  { additionalProperties: false, title: "FailedCheck" },
);
export type FailedCheck = Static<typeof FailedCheck>;

/** What a `ci.failed` signal carries: the failed checks, as far as the forge could tell them. */
export const CiFailedData = Type.Object({ failed: Type.Array(FailedCheck) }, { additionalProperties: false, title: "CiFailedData" });
export type CiFailedData = Static<typeof CiFailedData>;

export const Signal = Type.Object(
  {
    source: SignalSource,
    kind: SignalKindSchema,
    /** what the signal is about: the story's change, as `change/<id>` */
    subject: NonEmpty,
    /** when the host saw it */
    at: IsoTime,
    data: Type.Optional(Type.Unknown()),
  },
  { additionalProperties: false, title: "Signal" },
);
export type Signal = Static<typeof Signal>;

export function isSignalKind(kind: string): kind is SignalKind {
  return (SIGNAL_KINDS as readonly string[]).includes(kind);
}
