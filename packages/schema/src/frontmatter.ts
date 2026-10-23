import { type Static, Type } from "@sinclair/typebox";
import { IsoTime, NonEmpty, PosInt, RemoteProvider, SliceKey, Slug, StoryKey } from "./common.ts";

const WorkflowName = Type.String({ pattern: "^[a-z][a-z0-9_-]*$", description: "Name of a workflow file" });

/** Coarse story lifecycle; fine-grained progress lives in runs/_story/state.json. */
export const StoryStatus = Type.Union([
  Type.Literal("new"),
  Type.Literal("active"),
  Type.Literal("done"),
  Type.Literal("dropped"),
]);
export type StoryStatus = Static<typeof StoryStatus>;

/**
 * Frontmatter of `.agents/specs/<id>-<slug>/story.md` (GR2, GR8).
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
  },
  { $id: "https://norn.dev/schema/slice.json", title: "norn slice frontmatter", additionalProperties: true },
);
export type SliceFrontmatter = Static<typeof SliceFrontmatter>;
