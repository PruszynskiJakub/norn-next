/**
 * glab adapter — implements RemotePort (packages/core/src/ports.ts) for GitLab (M4) over the
 * `glab` CLI's JSON output, run in the repository directory. Story key for issue iid n is
 * `gl-<n>` (§5.1); "pull request" in the port means merge request here.
 */
import type { RemoteFactory, RemoteIssue, RemotePort, RemotePullRequest } from "@norn/core";
import { storyKey } from "@norn/schema";
import { NETWORK_TIMEOUT_MS } from "@norn/store";
import { bunExec, okOrThrow, parseJson, portError, type Exec } from "../exec.ts";

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

export function mapMr(m: GlMr): RemotePullRequest {
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
    draft: m.draft ?? m.work_in_progress ?? false,
    head: m.source_branch,
    base: m.target_branch,
    base_branch: m.target_branch,
  };
}

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
    async getIssue(number) {
      const r = await run(["issue", "view", String(number), ...repo, "--output", "json"]);
      if (r.code !== 0 && notFound(r.stderr)) return null;
      return mapIssue(parseJson<GlIssue>(okOrThrow(r, "glab issue view", "glab"), "glab issue view", "glab"));
    },
    async findPullRequest(branch) {
      const rows = await json<GlMr[]>(["mr", "list", ...repo, "--source-branch", branch, "--all", "--per-page", "100", "--output", "json"]);
      const latest = rows.reduce<GlMr | null>((a, m) => (a === null || m.iid > a.iid ? m : a), null);
      return latest ? mapMr(latest) : null;
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
  };
}

export const factory: RemoteFactory = (ctx) => createGlab({ cwd: ctx.repoRoot });
