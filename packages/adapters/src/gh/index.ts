/**
 * gh adapter — implements RemotePort (packages/core/src/ports.ts) over the GitHub `gh` CLI's
 * JSON output, run in the repository directory. Story key for issue n is `gh-<n>` (§5.1).
 */
import type { RemoteFactory, RemoteIssue, RemotePort, RemotePullRequest } from "@norn/core";
import { storyKey } from "@norn/schema";
import { NETWORK_TIMEOUT_MS } from "@norn/store";
import { bunExec, okOrThrow, parseJson, portError, type Exec } from "../git/exec.ts";

export interface GhOptions {
  /** repository checkout to run `gh` in */
  cwd: string;
  exec?: Exec;
  /** `gh` binary (default `gh`) */
  bin?: string;
  /** `OWNER/REPO` override (`-R`) */
  repo?: string;
  env?: Record<string, string>;
}

/** Story key of GitHub issue n: `gh-<n>`. */
export const issueKey = (number: number): string => storyKey("gh", number);

export const ISSUE_FIELDS = "number,url,title,body,state,assignees,labels,updatedAt";
export const PR_FIELDS = "number,url,state,isDraft,headRefName,headRefOid,baseRefName,mergedAt,mergeCommit,mergedBy";

interface GhIssue {
  number: number;
  url: string;
  title: string;
  body?: string | null;
  state: string;
  assignees?: Array<{ login: string }>;
  labels?: Array<{ name: string }>;
  updatedAt: string;
}

interface GhPr {
  number: number;
  url: string;
  state: string;
  isDraft?: boolean;
  headRefName: string;
  headRefOid?: string;
  baseRefName: string;
  mergedAt?: string | null;
  mergeCommit?: { oid?: string } | null;
  mergedBy?: { login?: string } | null;
}

export function mapIssue(i: GhIssue): RemoteIssue {
  return {
    provider: "gh",
    number: i.number,
    url: i.url,
    title: i.title,
    body: i.body ?? "",
    state: i.state.toUpperCase() === "OPEN" ? "open" : "closed",
    assignees: (i.assignees ?? []).map((a) => a.login),
    labels: (i.labels ?? []).map((l) => l.name),
    updated_at: i.updatedAt,
  };
}

export function mapPr(p: GhPr): RemotePullRequest {
  const s = p.state.toUpperCase();
  return {
    number: p.number,
    url: p.url,
    state: s === "MERGED" ? "merged" : s === "OPEN" ? "open" : "closed",
    is_draft: p.isDraft ?? false,
    head_sha: p.headRefOid ?? "",
    ...(p.mergeCommit?.oid ? { merge_commit_sha: p.mergeCommit.oid } : {}),
    ...(p.mergedBy?.login ? { merged_by: p.mergedBy.login } : {}),
    merged_at: p.mergedAt ?? null,
    draft: p.isDraft ?? false,
    head: p.headRefName,
    base: p.baseRefName,
    base_branch: p.baseRefName,
  };
}

export function createGh(opts: GhOptions): RemotePort {
  const exec = opts.exec ?? bunExec;
  const bin = opts.bin ?? "gh";
  const env = { GH_PROMPT_DISABLED: "1", NO_COLOR: "1", ...(opts.env ?? {}) };
  const repo = opts.repo ? ["-R", opts.repo] : [];
  // H11: every gh call reaches the remote, so every one is bounded
  const run = (args: string[]) => exec([bin, ...args], { cwd: opts.cwd, env, timeoutMs: NETWORK_TIMEOUT_MS });
  const json = async <T>(args: string[]): Promise<T> => parseJson<T>(okOrThrow(await run(args), `gh ${args[0]} ${args[1]}`, "gh"), `gh ${args[0]}`, "gh");

  return {
    provider: "gh",
    async whoami() {
      const out = okOrThrow(await run(["api", "user", "--jq", ".login"]), "gh api user", "gh").trim();
      if (!out) throw portError("gh_auth", "gh api user returned no login");
      return out;
    },
    async listAssignedIssues({ label }) {
      // GR1
      const rows = await json<GhIssue[]>(["issue", "list", ...repo, "--assignee", "@me", "--label", label, "--state", "open", "--limit", "500", "--json", ISSUE_FIELDS]);
      return rows.map(mapIssue);
    },
    async getIssue(number) {
      const r = await run(["issue", "view", String(number), ...repo, "--json", ISSUE_FIELDS]);
      if (r.code !== 0 && /could not resolve to an issue|not found|no issue/i.test(r.stderr)) return null;
      return mapIssue(parseJson<GhIssue>(okOrThrow(r, "gh issue view", "gh"), "gh issue view", "gh"));
    },
    async findPullRequest(branch) {
      // gh lists newest first
      const rows = await json<GhPr[]>(["pr", "list", ...repo, "--head", branch, "--state", "all", "--limit", "1", "--json", PR_FIELDS]);
      return rows[0] ? mapPr(rows[0]) : null;
    },
    async openDraftPullRequest({ head, base, title, body }) {
      const out = okOrThrow(
        await run(["pr", "create", ...repo, "--draft", "--head", head, "--base", base, "--title", title, "--body", body]),
        "gh pr create",
        "gh",
      );
      const url = out.trim().split("\n").pop() ?? "";
      const pr = await json<GhPr>(["pr", "view", url, ...repo, "--json", PR_FIELDS]);
      return mapPr(pr);
    },
    async editPullRequestBody(number, body) {
      // GR9
      okOrThrow(await run(["pr", "edit", String(number), ...repo, "--body", body]), "gh pr edit", "gh");
    },
  };
}

export const factory: RemoteFactory = (ctx) => createGh({ cwd: ctx.repoRoot });
