/**
 * gh adapter — implements RemotePort (packages/core/src/ports.ts) over the GitHub `gh` CLI's
 * JSON output, run in the repository directory. Story key for issue n is `gh-<n>` (§5.1).
 */
import type { PullRequestCi, RemoteFactory, RemoteIssue, RemoteLabel, RemotePort, RemotePullRequest } from "@norn/core";
import { storyKey } from "@norn/schema";
import { NETWORK_TIMEOUT_MS } from "@norn/store";
import { bunExec, encodePath, okOrThrow, parseJson, portError, type Exec } from "../exec.ts";

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

const ISSUE_FIELDS = "number,url,title,body,state,assignees,labels,updatedAt";
const PR_FIELDS = "number,url,state,isDraft,headRefName,headRefOid,baseRefName,mergedAt,mergeCommit,mergedBy";

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

function mapPr(p: GhPr): RemotePullRequest {
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
    head: p.headRefName,
    base_branch: p.baseRefName,
  };
}

/**
 * gh-195 B18: `gh pr checks --json bucket` buckets (pass, fail, pending, skipping, cancel) folded into
 * one state: a failed or cancelled check wins, then a pending one; no check at all is `none`.
 */
function ciOf(buckets: readonly string[]): PullRequestCi {
  if (!buckets.length) return "none";
  if (buckets.some((b) => b === "fail" || b === "cancel")) return "failure";
  if (buckets.some((b) => b === "pending")) return "pending";
  return "success";
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
    async listLabelledIssues({ label }) {
      // CP2: the backlog — any assignee or none
      const rows = await json<GhIssue[]>(["issue", "list", ...repo, "--label", label, "--state", "open", "--limit", "500", "--json", ISSUE_FIELDS]);
      return rows.map(mapIssue);
    },
    async assignIssue(number, assignee) {
      // GR1
      okOrThrow(await run(["issue", "edit", String(number), ...repo, "--add-assignee", assignee]), "gh issue edit", "gh");
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
    async pullRequestCi(number) {
      // gh exits 8 while checks are pending and 1 when one failed, printing the JSON either way;
      // with no check at all it exits 1 saying so
      const r = await run(["pr", "checks", String(number), ...repo, "--json", "bucket"]);
      if (r.code !== 0 && /no checks reported/i.test(r.stderr)) return "none";
      const out = r.code === 1 || r.code === 8 ? (r.stdout.trim() ? r.stdout : okOrThrow(r, "gh pr checks", "gh")) : okOrThrow(r, "gh pr checks", "gh");
      return ciOf(parseJson<Array<{ bucket: string }>>(out, "gh pr checks", "gh").map((c) => c.bucket));
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
    async createIssue({ title, body, labels, assignee }) {
      // B18
      const out = okOrThrow(
        await run(["issue", "create", ...repo, "--title", title, "--body", body, ...labels.flatMap((l) => ["--label", l]), "--assignee", assignee]),
        "gh issue create",
        "gh",
      );
      const m = /\/issues\/(\d+)/.exec(out);
      if (!m) throw portError("gh_bad_output", `gh issue create: no issue URL in output: ${out.slice(0, 200)}`);
      return mapIssue(await json<GhIssue>(["issue", "view", m[1] as string, ...repo, "--json", ISSUE_FIELDS]));
    },
    async newIssueUrl({ labels }) {
      // B23
      const { url } = await json<{ url: string }>(["repo", "view", ...(opts.repo ? [opts.repo] : []), "--json", "url"]);
      return `${url}/issues/new?labels=${encodeURIComponent(labels.join(","))}`;
    },
    async rawFileUrl({ commit, path }) {
      // gh-195 D5 (B28): `blob/…?raw=true` redirects to the raw file, which GitHub renders inline
      const { url } = await json<{ url: string }>(["repo", "view", ...(opts.repo ? [opts.repo] : []), "--json", "url"]);
      return `${url}/blob/${commit}/${encodePath(path)}?raw=true`;
    },
    async replaceIssueLabel(number, { remove, add }) {
      // B19: gh refuses `--remove-label` for a label the repository lacks, so remove only one the issue carries
      const { labels } = await json<Pick<GhIssue, "labels">>(["issue", "view", String(number), ...repo, "--json", "labels"]);
      const removing = (labels ?? []).some((l) => l.name === remove) ? ["--remove-label", remove] : [];
      okOrThrow(await run(["issue", "edit", String(number), ...repo, ...removing, "--add-label", add]), "gh issue edit", "gh");
    },
    async listLabels() {
      // GR10: gh lists 30 by default
      const rows = await json<Array<{ name: string; color?: string; description?: string | null }>>(["label", "list", ...repo, "--limit", "1000", "--json", "name,color,description"]);
      return rows.map((l): RemoteLabel => ({ name: l.name, color: (l.color ?? "").replace(/^#/, "").toUpperCase(), description: l.description ?? "" }));
    },
    async createLabel({ name, color, description }) {
      // GR10: never `--force`, which would restyle an existing label
      const r = await run(["label", "create", name, ...repo, "--color", color, "--description", description]);
      if (r.code !== 0 && /already exists/i.test(r.stderr)) throw portError("gh_exists", `gh label create: label ${name} already exists`);
      okOrThrow(r, "gh label create", "gh");
    },
  };
}

export const factory: RemoteFactory = (ctx) => createGh({ cwd: ctx.repoRoot });
