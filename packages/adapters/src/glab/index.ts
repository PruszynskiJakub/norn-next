/**
 * glab adapter — implements RemotePort (packages/core/src/ports.ts) for GitLab (M4) over the
 * `glab` CLI's JSON output, run in the repository directory. Story key for issue iid n is
 * `gl-<n>` (§5.1); "pull request" in the port means merge request here.
 */
import type { PullRequestCi, RemoteFactory, RemoteIssue, RemoteLabel, RemotePort, RemotePullRequest } from "@norn/core";
import { storyKey } from "@norn/schema";
import { NETWORK_TIMEOUT_MS } from "@norn/store";
import { bunExec, encodePath, okOrThrow, parseJson, portError, type Exec } from "../exec.ts";

export interface GlabOptions {
  /** repository checkout to run `glab` in */
  cwd: string;
  exec?: Exec;
  /** `glab` binary (default `glab`) */
  bin?: string;
  /** `GROUP/PROJECT` override (`-R`) */
  repo?: string;
  env?: Record<string, string>;
}

/** Story key of GitLab issue iid n: `gl-<n>`. */
export const issueKey = (number: number): string => storyKey("glab", number);

interface GlIssue {
  iid: number;
  web_url: string;
  title: string;
  description?: string | null;
  state: string;
  assignees?: Array<{ username: string }>;
  labels?: string[];
  updated_at: string;
}

interface GlMr {
  iid: number;
  web_url: string;
  state: string;
  draft?: boolean;
  work_in_progress?: boolean;
  source_branch: string;
  target_branch: string;
  merged_at?: string | null;
  /** head commit of the source branch */
  sha?: string | null;
  merge_commit_sha?: string | null;
  squash_commit_sha?: string | null;
  merged_by?: { username?: string } | null;
  merge_user?: { username?: string } | null;
  /** the pipeline of the source branch's head (`mr view` only) */
  head_pipeline?: { status?: string } | null;
}

/**
 * gh-195 B18: a GitLab pipeline status as one CI state: `success`; `failed` or `canceled` → failure;
 * `skipped` or no pipeline → none; every other status (created, pending, running, manual, …) → pending.
 */
function ciOfPipeline(status: string | null | undefined): PullRequestCi {
  if (!status || status === "skipped") return "none";
  if (status === "success") return "success";
  if (status === "failed" || status === "canceled") return "failure";
  return "pending";
}

export function mapIssue(i: GlIssue): RemoteIssue {
  return {
    provider: "glab",
    number: i.iid,
    url: i.web_url,
    title: i.title,
    body: i.description ?? "",
    state: i.state === "opened" ? "open" : "closed",
    assignees: (i.assignees ?? []).map((a) => a.username),
    labels: i.labels ?? [],
    updated_at: i.updated_at,
  };
}

function mapMr(m: GlMr): RemotePullRequest {
  const merge = m.merge_commit_sha ?? m.squash_commit_sha ?? null;
  const by = m.merge_user?.username ?? m.merged_by?.username ?? null;
  return {
    number: m.iid,
    url: m.web_url,
    state: m.state === "merged" ? "merged" : m.state === "opened" ? "open" : "closed", // locked → closed
    is_draft: m.draft ?? m.work_in_progress ?? false,
    head_sha: m.sha ?? "",
    ...(merge ? { merge_commit_sha: merge } : {}),
    ...(by ? { merged_by: by } : {}),
    merged_at: m.merged_at ?? null,
    head: m.source_branch,
    base_branch: m.target_branch,
  };
}

/** gh-186: the merge request fields `findPullRequests` reads, GitLab GraphQL names. */
interface GlMrNode {
  iid: string;
  webUrl: string;
  state: string;
  draft?: boolean;
  sourceBranch: string;
  targetBranch: string;
  mergedAt?: string | null;
  diffHeadSha?: string | null;
  mergeCommitSha?: string | null;
  squashCommitSha?: string | null;
  mergeUser?: { username?: string } | null;
}

/** How many merge requests one GraphQL page holds (gh-186); a fuller answer falls back to one call per branch. */
const MRS_PER_QUERY = 100;

/** gh-186: every merge request of `branches`, any state, as GitLab GraphQL lists it. JSON strings are GraphQL strings. */
export function mrsQuery(fullPath: string, branches: readonly string[]): string {
  const node = "iid webUrl state draft sourceBranch targetBranch mergedAt diffHeadSha mergeCommitSha squashCommitSha mergeUser { username }";
  return `query { project(fullPath: ${JSON.stringify(fullPath)}) { mergeRequests(sourceBranches: ${JSON.stringify(branches)}, first: ${MRS_PER_QUERY}) { pageInfo { hasNextPage } nodes { ${node} } } } }`;
}

const restMr = (n: GlMrNode): GlMr => ({
  iid: Number(n.iid),
  web_url: n.webUrl,
  state: n.state,
  ...(n.draft === undefined ? {} : { draft: n.draft }),
  source_branch: n.sourceBranch,
  target_branch: n.targetBranch,
  merged_at: n.mergedAt ?? null,
  sha: n.diffHeadSha ?? null,
  merge_commit_sha: n.mergeCommitSha ?? null,
  squash_commit_sha: n.squashCommitSha ?? null,
  merge_user: n.mergeUser ?? null,
});

/** The MR with the highest iid, as `findPullRequest` picks it. */
const latestMr = (rows: readonly GlMr[]): GlMr | null => rows.reduce<GlMr | null>((a, m) => (a === null || m.iid > a.iid ? m : a), null);

export function createGlab(opts: GlabOptions): RemotePort {
  const exec = opts.exec ?? bunExec;
  const bin = opts.bin ?? "glab";
  const env = { NO_PROMPT: "1", NO_COLOR: "1", GLAB_NO_PROMPT: "1", ...(opts.env ?? {}) };
  const repo = opts.repo ? ["-R", opts.repo] : [];
  // H11: every glab call reaches the remote, so every one is bounded
  const run = (args: string[], stdin?: string) => exec([bin, ...args], { cwd: opts.cwd, env, timeoutMs: NETWORK_TIMEOUT_MS, ...(stdin === undefined ? {} : { stdin }) });
  const json = async <T>(args: string[]): Promise<T> =>
    parseJson<T>(okOrThrow(await run(args), `glab ${args[0]} ${args[1]}`, "glab"), `glab ${args[0]}`, "glab");
  const notFound = (stderr: string) => /404|not found/i.test(stderr);
  const findPullRequest = async (branch: string): Promise<RemotePullRequest | null> => {
    const latest = latestMr(await json<GlMr[]>(["mr", "list", ...repo, "--source-branch", branch, "--all", "--per-page", "100", "--output", "json"]));
    return latest ? mapMr(latest) : null;
  };

  return {
    provider: "glab",
    async whoami() {
      const u = await json<{ username?: string }>(["api", "user"]);
      if (!u.username) throw portError("glab_auth", "glab api user returned no username");
      return u.username;
    },
    async listAssignedIssues({ label }) {
      // GR1; glab lists open issues by default
      const rows = await json<GlIssue[]>(["issue", "list", ...repo, "--assignee=@me", "--label", label, "--per-page", "100", "--output", "json"]);
      return rows.map(mapIssue);
    },
    async listLabelledIssues({ label }) {
      // CP2: the backlog — any assignee or none; glab lists open issues by default
      const rows = await json<GlIssue[]>(["issue", "list", ...repo, "--label", label, "--per-page", "100", "--output", "json"]);
      return rows.map(mapIssue);
    },
    async assignIssue(number, assignee) {
      // GR1: `+` adds to the assignees instead of replacing them
      okOrThrow(await run(["issue", "update", String(number), ...repo, "--assignee", `+${assignee}`]), "glab issue update", "glab");
    },
    async getIssue(number) {
      const r = await run(["issue", "view", String(number), ...repo, "--output", "json"]);
      if (r.code !== 0 && notFound(r.stderr)) return null;
      return mapIssue(parseJson<GlIssue>(okOrThrow(r, "glab issue view", "glab"), "glab issue view", "glab"));
    },
    findPullRequest,
    async findPullRequests(branches) {
      // gh-186: one GraphQL query for every branch instead of one `glab mr list` per branch
      const out = new Map<string, RemotePullRequest | null>();
      const unique = [...new Set(branches)];
      if (!unique.length) return out;
      const fullPath = opts.repo ?? (await json<{ path_with_namespace?: string }>(["repo", "view", "--output", "json"])).path_with_namespace;
      if (!fullPath) throw portError("glab_bad_output", "glab repo view: no path_with_namespace");
      const r = await json<{ data?: { project?: { mergeRequests?: { pageInfo?: { hasNextPage?: boolean }; nodes?: GlMrNode[] } } | null } }>(["api", "graphql", "-f", `query=${mrsQuery(fullPath, unique)}`]);
      const mrs = r.data?.project?.mergeRequests;
      if (!mrs) throw portError("glab_bad_output", "glab api graphql: no project merge requests in the answer");
      if (mrs.pageInfo?.hasNextPage) {
        // more than one page: ask branch by branch rather than miss a newer MR
        for (const b of unique) out.set(b, await findPullRequest(b));
        return out;
      }
      const rows = (mrs.nodes ?? []).map(restMr);
      for (const b of unique) {
        const latest = latestMr(rows.filter((m) => m.source_branch === b));
        out.set(b, latest ? mapMr(latest) : null);
      }
      return out;
    },
    async pullRequestCi(number) {
      return ciOfPipeline((await json<GlMr>(["mr", "view", String(number), ...repo, "--output", "json"])).head_pipeline?.status);
    },
    async openDraftPullRequest({ head, base, title, body }) {
      const out = okOrThrow(
        await run(["mr", "create", ...repo, "--draft", "--source-branch", head, "--target-branch", base, "--title", title, "--description-file", "-", "--yes"], body),
        "glab mr create",
        "glab",
      );
      const m = /merge_requests\/(\d+)/.exec(out);
      if (!m) throw portError("glab_bad_output", `glab mr create: no merge request URL in output: ${out.slice(0, 200)}`);
      return mapMr(await json<GlMr>(["mr", "view", m[1] as string, ...repo, "--output", "json"]));
    },
    async editPullRequestBody(number, body) {
      // GR9
      okOrThrow(await run(["mr", "update", String(number), ...repo, "--description-file", "-", "--yes"], body), "glab mr update", "glab");
    },
    async createIssue({ title, body, labels, assignee }) {
      // B18
      const out = okOrThrow(
        await run(["issue", "create", ...repo, "--title", title, "--description-file", "-", ...labels.flatMap((l) => ["--label", l]), "--assignee", assignee, "--yes"], body),
        "glab issue create",
        "glab",
      );
      const m = /\/issues\/(\d+)/.exec(out);
      if (!m) throw portError("glab_bad_output", `glab issue create: no issue URL in output: ${out.slice(0, 200)}`);
      return mapIssue(await json<GlIssue>(["issue", "view", m[1] as string, ...repo, "--output", "json"]));
    },
    async newIssueUrl({ labels }) {
      // B23: GitLab's new-issue page takes no label names, so the labels go in as a /label quick action
      const { web_url } = await json<{ web_url: string }>(["repo", "view", ...(opts.repo ? [opts.repo] : []), "--output", "json"]);
      const action = `/label ${labels.map((l) => `~"${l}"`).join(" ")}`;
      return `${web_url}/-/issues/new?${new URLSearchParams({ "issue[description]": action })}`;
    },
    async rawFileUrl({ commit, path }) {
      // gh-195 D5 (B28): GitLab serves a commit's file raw under `/-/raw/`
      const { web_url } = await json<{ web_url: string }>(["repo", "view", ...(opts.repo ? [opts.repo] : []), "--output", "json"]);
      return `${web_url}/-/raw/${commit}/${encodePath(path)}`;
    },
    async replaceIssueLabel(number, { remove, add }) {
      // B19: GitLab ignores a label to remove that the issue does not carry
      okOrThrow(await run(["issue", "update", String(number), ...repo, "--unlabel", remove, "--label", add]), "glab issue update", "glab");
    },
    async listLabels() {
      // GR10: GitLab's colours carry `#`; one page of 100 (a label beyond it shows up as `_exists` on create)
      const rows = await json<Array<{ name: string; color?: string; description?: string | null }>>(["label", "list", ...repo, "--per-page", "100", "--output", "json"]);
      return rows.map((l): RemoteLabel => ({ name: l.name, color: (l.color ?? "").replace(/^#/, "").toUpperCase(), description: l.description ?? "" }));
    },
    async createLabel({ name, color, description }) {
      // GR10
      const r = await run(["label", "create", ...repo, "--name", name, "--color", `#${color}`, "--description", description]);
      if (r.code !== 0 && /already exists|\b409 Conflict\b|HTTP 409\b|has already been taken/i.test(`${r.stderr}${r.stdout}`)) throw portError("glab_exists", `glab label create: label ${name} already exists`);
      okOrThrow(r, "glab label create", "glab");
    },
  };
}

export const factory: RemoteFactory = (ctx) => createGlab({ cwd: ctx.repoRoot });
