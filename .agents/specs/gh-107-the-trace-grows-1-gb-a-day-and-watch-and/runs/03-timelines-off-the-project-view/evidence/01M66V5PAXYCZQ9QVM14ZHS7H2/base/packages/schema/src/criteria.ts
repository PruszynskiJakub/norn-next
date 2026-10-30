import { type Static, Type } from "@sinclair/typebox";
import { NonEmpty, TaggedUnion, Ulid } from "./common.ts";

/** Criterion id as written in a slice/story Acceptance section, e.g. `AC1`, `B3`, `AC2.1`. */
export const CRITERION_ID_PATTERN = "^[A-Za-z0-9][A-Za-z0-9._-]*$";
export const CriterionId = Type.String({ pattern: CRITERION_ID_PATTERN, description: "Acceptance criterion id, e.g. AC1" });

/** Who can confirm a criterion (QV1): an automated test, an agent using the software, or a person. */
export const Verifier = Type.Union([Type.Literal("test"), Type.Literal("agent"), Type.Literal("person")]);
export type Verifier = Static<typeof Verifier>;

/**
 * QV1: one acceptance criterion as data, in slice (or story) frontmatter `criteria`, next to the
 * prose Acceptance section. `needs` names capabilities the check requires (free strings, e.g. `browser`).
 */
export const Criterion = Type.Object(
  {
    id: CriterionId,
    verifier: Verifier,
    needs: Type.Optional(Type.Array(NonEmpty, { uniqueItems: true })),
  },
  { additionalProperties: false },
);
export type Criterion = Static<typeof Criterion>;

/**
 * QV2/QV5 verdicts, worst first: `fail` > `unverified` > `person` > `pass`.
 * - `pass`: observed working; `evidence` required
 * - `fail`: observed not working; `repro` required (the finding in `--findings` carries it too)
 * - `person`: needs a person's judgement or access; `how` to check it required
 * - `unverified`: a machine could check it, this session could not; `reason` and `how` required
 */
export const VERDICTS = ["fail", "unverified", "person", "pass"] as const;
export const Verdict = Type.Union(VERDICTS.map((v) => Type.Literal(v)));
export type Verdict = (typeof VERDICTS)[number];

const verdictEntry = <V extends Verdict, R extends Record<string, ReturnType<typeof Type.String>>>(verdict: V, required: R, desc: string) =>
  Type.Object(
    {
      id: CriterionId,
      verdict: Type.Literal(verdict),
      evidence: Type.Optional(NonEmpty),
      repro: Type.Optional(NonEmpty),
      reason: Type.Optional(NonEmpty),
      how: Type.Optional(NonEmpty),
      ...required,
    },
    { additionalProperties: false, description: desc },
  );

export const CriterionVerdict = TaggedUnion("verdict", [
  verdictEntry("pass", { evidence: NonEmpty }, "observed working, with evidence"),
  verdictEntry("fail", { repro: NonEmpty }, "observed not working; minimal repro"),
  verdictEntry("person", { how: NonEmpty }, "needs a person's judgement or access; how to check it"),
  verdictEntry("unverified", { reason: NonEmpty, how: NonEmpty }, "a machine could check it, this session could not"),
]);
export type CriterionVerdict = Static<typeof CriterionVerdict>;

/** QV2: the file `norn done --criteria <file>` reads — one verdict per criterion. Stored in the `done` receipt. */
export const CriteriaReport = Type.Array(CriterionVerdict, {
  minItems: 1,
  $id: "https://norn.dev/schema/criteria-report.json",
  title: "norn criteria report",
});
export type CriteriaReport = Static<typeof CriteriaReport>;

/** NT1: a non-blocking note for a person, optionally about one criterion. */
export const Note = Type.Object(
  {
    text: NonEmpty,
    criterion: Type.Optional(CriterionId),
  },
  { additionalProperties: false },
);
export type Note = Static<typeof Note>;

/** NT2: inbox id of a note — `note:<receipt_id>:<n>`, `n` from 1 in the receipt's `notes` order. */
export const NOTE_ID_PATTERN = "^note:[0-9A-HJKMNP-TV-Z]{26}:[1-9][0-9]*$";
export const NoteId = Type.String({ pattern: NOTE_ID_PATTERN, description: "note:<receipt_id>:<n> (NT2)" });
export const noteId = (receiptId: Static<typeof Ulid>, n: number) => `note:${receiptId}:${n}`;
