/**
 * The shapes `gh --json` and `gh api graphql` answer with, as far as the plugin reads them, and their
 * mapping onto the contract. Extra fields are allowed (gh adds them over time); a missing or
 * mistyped one fails validation rather than becoming a wrong fact.
 */
import { type ChangeRequest, formatStoryKey, type TrackerItem } from "@norn/plugin-api";
import { IsoTime, NonEmpty, PosInt } from "@norn/schema";
import { type Static, type TSchema, Type } from "@sinclair/typebox";
import { stripMarkers } from "./marker.ts";

export const ISSUE_FIELDS = "number,url,title,body,state,assignees,labels,updatedAt";
export const PR_FIELDS = "number,url,title,state,isDraft,headRefName,headRefOid,baseRefName,mergedAt,mergeCommit";

const Nullable = <T extends TSchema>(t: T) => Type.Optional(Type.Union([t, Type.Null()]));

export const GhIssue = Type.Object({
  number: PosInt,
  url: Type.String(),
  title: Type.String(),
  body: Nullable(Type.String()),
  state: Type.String(),
  assignees: Type.Array(Type.Object({ login: NonEmpty })),
  labels: Type.Array(Type.Object({ name: NonEmpty })),
  updatedAt: IsoTime,
});
export type GhIssue = Static<typeof GhIssue>;
export const GhIssues = Type.Array(GhIssue);

/** An issue of the intake query: `gh --json`'s fields, with assignees and labels as connections. */
const GhIssueNode = Type.Object({
  number: PosInt,
  url: Type.String(),
  title: Type.String(),
  body: Nullable(Type.String()),
  state: Type.String(),
  assignees: Type.Object({ nodes: Type.Array(Type.Object({ login: NonEmpty })) }),
  labels: Type.Object({ nodes: Type.Array(Type.Object({ name: NonEmpty })) }),
  updatedAt: IsoTime,
});
type GhIssueNode = Static<typeof GhIssueNode>;

/** One page of a repository's issue connection, as `gh api graphql` answers the intake query. */
export const GhIssuePage = Type.Object({
  data: Type.Object({
    repository: Type.Union([
      Type.Object({ issues: Type.Object({ pageInfo: Type.Object({ hasNextPage: Type.Boolean(), endCursor: Nullable(Type.String()) }), nodes: Type.Array(GhIssueNode) }) }),
      Type.Null(),
    ]),
  }),
});

/** An issue node of the intake query in the shape `gh --json` gives, so both map through `toItem`. */
export function fromNode(n: GhIssueNode): GhIssue {
  return { ...n, assignees: n.assignees.nodes, labels: n.labels.nodes };
}

/**
 * The repository's open issues with one label, newest first, a page at a time. The issue connection
 * is read, never search: search's index lags a fresh issue, so a story created a moment ago would be
 * missing from the next tick's intake while a later listing shows it.
 */
export const INTAKE_QUERY = [
  "query($owner: String!, $name: String!, $label: String!, $assignee: String, $after: String) {",
  "  repository(owner: $owner, name: $name) {",
  "    issues(first: 100, after: $after, states: OPEN, labels: [$label], filterBy: {assignee: $assignee}, orderBy: {field: CREATED_AT, direction: DESC}) {",
  "      pageInfo { hasNextPage endCursor }",
  "      nodes { number url title body state updatedAt assignees(first: 100) { nodes { login } } labels(first: 100) { nodes { name } } }",
  "    }",
  "  }",
  "}",
].join("\n");

export const GhIssueLabels = Type.Object({ labels: Type.Array(Type.Object({ name: NonEmpty })) });
export const GhIssueComments = Type.Object({ comments: Type.Array(Type.Object({ body: Nullable(Type.String()), url: Type.Optional(Type.String()) })) });

export const GhLabels = Type.Array(Type.Object({ name: NonEmpty }));

export const GhPr = Type.Object({
  number: PosInt,
  url: Type.String(),
  title: Type.String(),
  state: Type.String(),
  isDraft: Type.Boolean(),
  headRefName: NonEmpty,
  headRefOid: Type.String(),
  baseRefName: NonEmpty,
  mergedAt: Nullable(IsoTime),
  mergeCommit: Type.Optional(Type.Union([Type.Object({ oid: Type.String() }), Type.Null()])),
  body: Nullable(Type.String()),
});
export type GhPr = Static<typeof GhPr>;
export const GhPrs = Type.Array(GhPr);

export const GhChecks = Type.Array(Type.Object({ bucket: Type.String() }));
/** `gh pr checks --json bucket,name,link`: check runs and commit statuses alike */
export const GhNamedChecks = Type.Array(Type.Object({ bucket: Type.String(), name: Type.String(), link: Type.Optional(Type.String()) }));
export const GhHead = Type.Object({ headRefOid: Type.String() });
/** `commits/<sha>/check-runs`: what the annotations of a check run are asked by */
export const GhCheckRuns = Type.Object({ check_runs: Type.Array(Type.Object({ id: Type.Integer(), name: Type.String(), conclusion: Type.Union([Type.String(), Type.Null()]) })) });
export const GhAnnotations = Type.Array(
  Type.Object({ path: Type.String(), start_line: Type.Union([Type.Integer(), Type.Null()]), annotation_level: Type.Union([Type.String(), Type.Null()]), message: Type.Union([Type.String(), Type.Null()]) }),
);

export const GhPrsByBranch = Type.Object({
  data: Type.Object({
    repository: Type.Union([Type.Record(Type.String(), Type.Union([Type.Object({ nodes: GhPrs }), Type.Null()])), Type.Null()]),
  }),
});

export function toItem(i: GhIssue, keyPrefix: string): TrackerItem {
  return {
    id: i.number,
    key: formatStoryKey(keyPrefix, i.number),
    title: i.title,
    body: stripMarkers(i.body ?? ""),
    open: i.state.toUpperCase() === "OPEN",
    assignees: i.assignees.map((a) => a.login),
    labels: i.labels.map((l) => l.name),
    url: i.url,
    updated_at: i.updatedAt,
  };
}

export function toChange(p: GhPr): ChangeRequest {
  const s = p.state.toUpperCase();
  const merged = s === "MERGED";
  return {
    id: p.number,
    url: p.url,
    state: merged ? "merged" : s === "OPEN" ? "open" : "closed",
    draft: p.isDraft,
    head_branch: p.headRefName,
    base_branch: p.baseRefName,
    head_sha: p.headRefOid,
    // the merge facts mean something only once merged; a closed change never carries them
    ...(merged && p.mergeCommit?.oid ? { merge_sha: p.mergeCommit.oid } : {}),
    ...(merged && p.mergedAt ? { merged_at: p.mergedAt } : {}),
    title: p.title,
  };
}
