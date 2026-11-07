import { type Static, Type } from "@sinclair/typebox";
import { GitSha, IsoTime, NonEmpty, PosInt, RemoteProvider, SliceKey, Slug, StoryKey } from "./common.ts";
import { Criterion } from "./criteria.ts";

/** Acceptance criteria as data; ids unique (checked by `norn done`). */
const Criteria = Type.Array(Criterion, { description: "Acceptance criteria as data; the prose Acceptance section stays the spec" });

const WorkflowName = Type.String({ pattern: "^[a-z][a-z0-9_-]*$", description: "Name of a workflow file" });

/** Coarse story lifecycle; fine-grained progress lives in runs/_story/state.json. */
export const StoryStatus = Type.Union([
  Type.Literal("new"),
  Type.Literal("active"),
  Type.Literal("done"),
  Type.Literal("dropped"),
]);
export type StoryStatus = Static<typeof StoryStatus>;

/** A story whose spec.md says it is over: `done` or `dropped`. */
export const isClosedStatus = (status: string | null | undefined): status is "done" | "dropped" => status === "done" || status === "dropped";

/** How the story PR landed, recorded at cleanup. */
export const StoryMerge = Type.Object(
  {
    pr: Type.Optional(PosInt),
    url: Type.Optional(NonEmpty),
    /** PR head when it merged (or the story branch head, merged by ancestry) */
    head_sha: Type.Optional(GitSha),
    merge_commit_sha: Type.Optional(GitSha),
    merged_by: Type.Optional(NonEmpty),
    merged_at: Type.Optional(IsoTime),
    /** the PR did not say merged; the branch head was found on the base */
    by_ancestry: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);
export type StoryMerge = Static<typeof StoryMerge>;

/**
 * Frontmatter of `.agents/specs/<id>-<slug>/spec.md`.
 * Mirrored fields (title, url, assignee, labels, body_hash) are written by the CLI;
 * the markdown body is the spec and is never overwritten.
 */
export const StoryFrontmatter = Type.Object(
  {
    id: StoryKey,
    slug: Slug,
    provider: RemoteProvider,
    number: PosInt,
    url: NonEmpty,
    title: NonEmpty,
    assignee: Type.Union([NonEmpty, Type.Null()]),
    labels: Type.Optional(Type.Array(Type.String())),
    workflow: WorkflowName,
    status: StoryStatus,
    intake_at: IsoTime,
    /** sha256 of the remote issue body at intake/last refine; drives the "issue body changed" inbox item. */
    body_hash: Type.Optional(Type.String({ pattern: "^[0-9a-f]{64}$" })),
    /** Remote body hash recorded when refine finished, if it differs from body_hash later. */
    refined_body_hash: Type.Optional(Type.String({ pattern: "^[0-9a-f]{64}$" })),
    /** The done record: how the story PR landed, written with `status: done` on the base branch. */
    merge: Type.Optional(StoryMerge),
    /** Story-level acceptance criteria, checked by story-level QA */
    criteria: Type.Optional(Criteria),
  },
  { $id: "https://norn.dev/schema/story.json", title: "norn story frontmatter", additionalProperties: true },
);
export type StoryFrontmatter = Static<typeof StoryFrontmatter>;

export const SliceStatus = Type.Union([
  Type.Literal("planned"),
  Type.Literal("active"),
  Type.Literal("integrated"),
  Type.Literal("dropped"),
]);
export type SliceStatus = Static<typeof SliceStatus>;

/**
 * Frontmatter of `slices/<nn>-<slug>.md`. `id` is the full slice key (`gh-123/03`)
 * so YAML never reads it as a number; `depends_on` lists slice keys of the same story.
 */
export const SliceFrontmatter = Type.Object(
  {
    id: SliceKey,
    title: NonEmpty,
    workflow: Type.Optional(WorkflowName),
    depends_on: Type.Array(SliceKey, { uniqueItems: true }),
    status: SliceStatus,
    labels: Type.Optional(Type.Array(Type.String())),
    /** The slice's acceptance criteria, written by the slice skill next to the Acceptance section */
    criteria: Type.Optional(Criteria),
  },
  { $id: "https://norn.dev/schema/slice.json", title: "norn slice frontmatter", additionalProperties: true },
);
export type SliceFrontmatter = Static<typeof SliceFrontmatter>;
