/**
 * Scripted `gh` and `glab` CLIs for the RemotePort contract: an in-memory remote answering exactly
 * the commands the adapters run, in each CLI's JSON shapes (as the recorded fixtures in
 * test/gh and test/glab show them). Filters follow the flags the adapter passed, so a dropped
 * `--assignee`/`--label`/`--state`/`--draft` shows up as a contract failure. An unknown command throws.
 */
import type { Exec, ExecResult } from "../../src/exec.ts";
import type { PullRequestCi, RemoteLabel } from "@norn/core";
import type { SeedIssue } from "./remote.ts";

interface Pr {
  number: number;
  head: string;
  base: string;
  title: string;
  draft: boolean;
  /** The CI state the provider reports for the PR's head */
  ci?: PullRequestCi;
}

const ok = (v: unknown): ExecResult => ({ code: 0, stdout: typeof v === "string" ? v : JSON.stringify(v), stderr: "" });
const AT = "2026-10-20T09:15:00Z";
const SHA = "c".repeat(40);

function flag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  if (i >= 0) return argv[i + 1];
  const eq = argv.find((a) => a.startsWith(`${name}=`));
  return eq?.slice(name.length + 1);
}

/** Every value of a repeatable flag, comma lists split (`--label a --label b,c`). */
function flags(argv: string[], name: string): string[] {
  return argv.flatMap((a, i) => (argv[i - 1] === name ? a.split(",") : a.startsWith(`${name}=`) ? a.slice(name.length + 1).split(",") : []));
}

/** The next issue number after the seeded ones. */
const nextNumber = (issues: SeedIssue[]) => Math.max(0, ...issues.map((i) => i.number)) + 1;

export interface ScriptedRemote {
  exec: Exec;
  seed(issues: SeedIssue[]): void;
  /** from now on every label edit (label listings and creations included) exits non-zero, as an unreachable provider would */
  failLabelEdits(): void;
  seedLabels(labels: RemoteLabel[]): void;
  /** The CI state of PR `number` from now on */
  setCi(number: number, ci: PullRequestCi): void;
}

const unreachable = (bin: string): ExecResult => ({ code: 1, stdout: "", stderr: `${bin}: error connecting to the API: Could not resolve host` });

export function scriptedGh(login = "octocat"): ScriptedRemote {
  let issues: SeedIssue[] = [];
  let labels: RemoteLabel[] = [];
  let labelEditsFail = false;
  const prs: Pr[] = [];
  const issueJson = (i: SeedIssue) => ({
    number: i.number,
    url: `https://github.com/acme/app/issues/${i.number}`,
    title: i.title,
    body: i.body,
    state: i.state === "open" ? "OPEN" : "CLOSED",
    assignees: i.assignees.map((a) => ({ id: `U_${a}`, login: a, name: a })),
    labels: i.labels.map((l) => ({ id: `L_${l}`, name: l, description: "", color: "ededed" })),
    updatedAt: AT,
  });
  const prJson = (p: Pr) => ({ number: p.number, url: `https://github.com/acme/app/pull/${p.number}`, state: "OPEN", isDraft: p.draft, headRefName: p.head, headRefOid: SHA, baseRefName: p.base, mergedAt: null, mergeCommit: null, mergedBy: null });
  const exec: Exec = async (argv) => {
    const [bin, a, b] = argv;
    if (bin !== "gh") throw new Error(`scripted gh: not a gh call: ${argv.join(" ")}`);
    if (a === "api" && b === "user") return ok(`${login}\n`);
    if (a === "issue" && b === "list") {
      const assignee = flag(argv, "--assignee") === "@me" ? login : flag(argv, "--assignee");
      const label = flag(argv, "--label");
      const state = flag(argv, "--state") ?? "open";
      return ok(issues.filter((i) => (state === "all" || i.state === state) && (!assignee || i.assignees.includes(assignee)) && (!label || i.labels.includes(label))).map(issueJson));
    }
    if (a === "issue" && b === "create") {
      const i: SeedIssue = { number: nextNumber(issues), title: flag(argv, "--title")!, body: flag(argv, "--body") ?? "", state: "open", assignees: flags(argv, "--assignee"), labels: flags(argv, "--label") };
      issues = [...issues, i];
      return ok(`\nCreating issue in acme/app\n\nhttps://github.com/acme/app/issues/${i.number}\n`);
    }
    if (a === "repo" && b === "view") return ok({ url: "https://github.com/acme/app" });
    if (a === "issue" && b === "view") {
      const i = issues.find((x) => x.number === Number(argv[3]));
      return i ? ok(issueJson(i)) : { code: 1, stdout: "", stderr: `GraphQL: Could not resolve to an issue or pull request with the number of ${argv[3]}.` };
    }
    if (a === "issue" && b === "edit") {
      if (labelEditsFail) return unreachable("gh");
      const i = issues.find((x) => x.number === Number(argv[3]));
      if (!i) return { code: 1, stdout: "", stderr: `GraphQL: Could not resolve to an issue or pull request with the number of ${argv[3]}.` };
      // like gh, a label to remove must exist in the repository (here: on some issue)
      const remove = flags(argv, "--remove-label");
      const unknown = remove.find((l) => !issues.some((x) => x.labels.includes(l)));
      if (unknown) return { code: 1, stdout: "", stderr: `failed to update https://github.com/acme/app/issues/${i.number}: '${unknown}' not found` };
      const add = flags(argv, "--add-label");
      const assign = flags(argv, "--add-assignee").map((a) => (a === "@me" ? login : a));
      issues = issues.map((x) =>
        x === i ? { ...x, labels: [...x.labels.filter((l) => !remove.includes(l)), ...add.filter((l) => !x.labels.includes(l))], assignees: [...x.assignees, ...assign.filter((a) => !x.assignees.includes(a))] } : x,
      );
      return ok(`https://github.com/acme/app/issues/${i.number}\n`);
    }
    if (a === "label" && b === "list") {
      if (labelEditsFail) return unreachable("gh");
      // gh reports colours in lower case
      return ok(labels.slice(0, Number(flag(argv, "--limit") ?? 30)).map((l) => ({ name: l.name, color: l.color.toLowerCase(), description: l.description })));
    }
    if (a === "label" && b === "create") {
      if (labelEditsFail) return unreachable("gh");
      const name = argv[3]!;
      if (labels.some((l) => l.name.toLowerCase() === name.toLowerCase())) return { code: 1, stdout: "", stderr: `label with name "${name}" already exists; use \`--force\` to update its color and description` };
      labels = [...labels, { name, color: flag(argv, "--color") ?? "ededed", description: flag(argv, "--description") ?? "" }];
      return ok(`✓ Label "${name}" created in acme/app\n`);
    }
    if (a === "pr" && b === "list") {
      const head = flag(argv, "--head");
      const rows = prs.filter((p) => p.head === head).sort((x, y) => y.number - x.number); // newest first
      return ok(rows.slice(0, Number(flag(argv, "--limit") ?? 30)).map(prJson));
    }
    if (a === "api" && b === "graphql") {
      // The aliased `pullRequests(headRefName:)` query findPullRequests sends
      if (flag(argv, "-F") === undefined) throw new Error("scripted gh: graphql without owner/name");
      const query = flag(argv, "-f")?.replace(/^query=/, "") ?? "";
      const repository: Record<string, { nodes: unknown[] }> = {};
      for (const m of query.matchAll(/(b\d+): pullRequests\(headRefName: ("(?:[^"\\]|\\.)*")/g)) {
        const newest = prs.filter((p) => p.head === JSON.parse(m[2]!)).sort((x, y) => y.number - x.number)[0];
        repository[m[1]!] = { nodes: newest ? [prJson(newest)] : [] };
      }
      return ok({ data: { repository } });
    }
    if (a === "pr" && b === "create") {
      const p: Pr = { number: 40 + prs.length, head: flag(argv, "--head")!, base: flag(argv, "--base")!, title: flag(argv, "--title")!, draft: argv.includes("--draft") };
      prs.push(p);
      return ok(`Creating ${p.draft ? "draft " : ""}pull request for ${p.head} into ${p.base}\n\nhttps://github.com/acme/app/pull/${p.number}\n`);
    }
    if (a === "pr" && b === "view") {
      const p = prs.find((x) => argv[3] === `https://github.com/acme/app/pull/${x.number}`);
      return p ? ok(prJson(p)) : { code: 1, stdout: "", stderr: "no pull requests found" };
    }
    if (a === "pr" && b === "checks" && flag(argv, "--json") === "bucket") {
      // gh: exit 8 while a check is pending, 1 when one failed, JSON printed either way; no check at all exits 1
      const p = prs.find((x) => x.number === Number(argv[3]));
      if (!p) return { code: 1, stdout: "", stderr: `no pull requests found for branch "${argv[3]}"` };
      const ci = p.ci ?? "none";
      if (ci === "none") return { code: 1, stdout: "", stderr: `no checks reported on the '${p.head}' branch` };
      const buckets = { success: ["pass", "skipping"], pending: ["pass", "pending"], failure: ["pass", "fail"] }[ci];
      return { code: ci === "pending" ? 8 : ci === "failure" ? 1 : 0, stdout: JSON.stringify(buckets.map((bucket) => ({ bucket }))), stderr: "" };
    }
    throw new Error(`scripted gh: unexpected call: ${argv.join(" ")}`);
  };
  const setCi = (n: number, ci: PullRequestCi) => void prs.forEach((p) => p.number === n && (p.ci = ci));
  return { exec, seed: (s) => void (issues = s), failLabelEdits: () => void (labelEditsFail = true), seedLabels: (l) => void (labels = l), setCi };
}

export function scriptedGlab(login = "tanuki"): ScriptedRemote {
  let issues: SeedIssue[] = [];
  let labels: RemoteLabel[] = [];
  let labelEditsFail = false;
  const mrs: Pr[] = [];
  const issueJson = (i: SeedIssue) => ({
    iid: i.number,
    web_url: `https://gitlab.com/acme/app/-/issues/${i.number}`,
    title: i.title,
    description: i.body,
    state: i.state === "open" ? "opened" : "closed",
    assignees: i.assignees.map((a) => ({ username: a })),
    labels: i.labels,
    updated_at: AT,
  });
  const mrJson = (m: Pr) => ({ iid: m.number, web_url: `https://gitlab.com/acme/app/-/merge_requests/${m.number}`, state: "opened", draft: m.draft, source_branch: m.head, target_branch: m.base, merged_at: null, sha: SHA, merge_commit_sha: null, squash_commit_sha: null, merged_by: null, merge_user: null });
  const exec: Exec = async (argv, opts) => {
    const [bin, a, b] = argv;
    if (bin !== "glab") throw new Error(`scripted glab: not a glab call: ${argv.join(" ")}`);
    if (a === "api" && b === "user") return ok({ id: 1, username: login });
    if (a === "issue" && b === "list") {
      const assignee = flag(argv, "--assignee") === "@me" ? login : flag(argv, "--assignee");
      const label = flag(argv, "--label");
      const all = argv.includes("--all");
      return ok(issues.filter((i) => (all || i.state === "open") && (!assignee || i.assignees.includes(assignee)) && (!label || i.labels.includes(label))).map(issueJson));
    }
    if (a === "issue" && b === "create") {
      const body = flag(argv, "--description-file") === "-" ? (opts?.stdin ?? "") : (flag(argv, "--description") ?? "");
      const i: SeedIssue = { number: nextNumber(issues), title: flag(argv, "--title")!, body, state: "open", assignees: flags(argv, "--assignee"), labels: flags(argv, "--label") };
      issues = [...issues, i];
      return ok(`- Creating issue in acme/app\n#${i.number} ${i.title} (now)\n https://gitlab.com/acme/app/-/issues/${i.number}\n`);
    }
    if (a === "repo" && b === "view") return ok({ id: 1, web_url: "https://gitlab.com/acme/app", path_with_namespace: "acme/app" });
    if (a === "api" && b === "graphql") {
      // `mergeRequests(sourceBranches:)` of the project, GitLab GraphQL names
      const query = flag(argv, "-f")?.replace(/^query=/, "") ?? "";
      if (!/project\(fullPath: "acme\/app"\)/.test(query)) throw new Error(`scripted glab: unexpected graphql: ${query}`);
      const branches = JSON.parse(/sourceBranches: (\[[^\]]*\])/.exec(query)![1]!) as string[];
      const nodes = mrs.filter((m) => branches.includes(m.head)).map((m) => ({ iid: String(m.number), webUrl: `https://gitlab.com/acme/app/-/merge_requests/${m.number}`, state: "opened", draft: m.draft, sourceBranch: m.head, targetBranch: m.base, mergedAt: null, diffHeadSha: SHA, mergeCommitSha: null, squashCommitSha: null, mergeUser: null }));
      return ok({ data: { project: { mergeRequests: { pageInfo: { hasNextPage: false }, nodes } } } });
    }
    if (a === "issue" && b === "view") {
      const i = issues.find((x) => x.number === Number(argv[3]));
      return i ? ok(issueJson(i)) : { code: 1, stdout: "", stderr: "ERROR: 404 Not Found" };
    }
    if (a === "issue" && b === "update") {
      if (labelEditsFail) return unreachable("glab");
      const i = issues.find((x) => x.number === Number(argv[3]));
      if (!i) return { code: 1, stdout: "", stderr: "ERROR: 404 Not Found" };
      // GitLab ignores a label to remove that is not on the issue
      const remove = flags(argv, "--unlabel");
      const add = flags(argv, "--label");
      // `--assignee +a` adds, a bare `--assignee a` replaces (as glab does)
      const assignee = flags(argv, "--assignee");
      const assignees = (x: SeedIssue) =>
        !assignee.length ? x.assignees : assignee.every((a) => a.startsWith("+")) ? [...x.assignees, ...assignee.map((a) => a.slice(1)).filter((a) => !x.assignees.includes(a))] : assignee;
      issues = issues.map((x) => (x === i ? { ...x, labels: [...x.labels.filter((l) => !remove.includes(l)), ...add.filter((l) => !x.labels.includes(l))], assignees: assignees(x) } : x));
      return ok(`- Updating issue #${i.number}\n#${i.number} ${i.title} (now)\n https://gitlab.com/acme/app/-/issues/${i.number}\n`);
    }
    if (a === "label" && b === "list") {
      if (labelEditsFail) return unreachable("glab");
      // GitLab's label objects: colour with `#`
      return ok(labels.slice(0, Number(flag(argv, "--per-page") ?? 20)).map((l, i) => ({ id: i + 1, name: l.name, color: `#${l.color}`, description: l.description || null, text_color: "#FFFFFF" })));
    }
    if (a === "label" && b === "create") {
      if (labelEditsFail) return unreachable("glab");
      const name = flag(argv, "--name")!;
      if (labels.some((l) => l.name === name)) return { code: 1, stdout: "", stderr: "ERROR: 409 Conflict: {message: Label already exists}" };
      labels = [...labels, { name, color: (flag(argv, "--color") ?? "#428BCA").replace(/^#/, ""), description: flag(argv, "--description") ?? "" }];
      return ok(`Created label: ${name}\nWith color: ${flag(argv, "--color")}\n`);
    }
    if (a === "mr" && b === "list") {
      const head = flag(argv, "--source-branch");
      return ok(mrs.filter((m) => m.head === head).map(mrJson)); // glab's order is not the adapter's to trust
    }
    if (a === "mr" && b === "create") {
      const m: Pr = { number: 7 + mrs.length, head: flag(argv, "--source-branch")!, base: flag(argv, "--target-branch")!, title: flag(argv, "--title")!, draft: argv.includes("--draft") };
      mrs.push(m);
      return ok(`Creating ${m.draft ? "draft " : ""}merge request for ${m.head} into ${m.base} in acme/app\n\n!${m.number} ${m.title} (${m.head})\n https://gitlab.com/acme/app/-/merge_requests/${m.number}\n`);
    }
    if (a === "mr" && b === "view") {
      const m = mrs.find((x) => x.number === Number(argv[3]));
      // GitLab's MR object carries the head pipeline (null when none ran)
      const status = { none: null, success: "success", pending: "running", failure: "failed" }[m?.ci ?? "none"];
      return m ? ok({ ...mrJson(m), head_pipeline: status ? { id: 900 + m.number, status } : null }) : { code: 1, stdout: "", stderr: "ERROR: 404 Not Found" };
    }
    throw new Error(`scripted glab: unexpected call: ${argv.join(" ")}`);
  };
  const setCi = (n: number, ci: PullRequestCi) => void mrs.forEach((m) => m.number === n && (m.ci = ci));
  return { exec, seed: (s) => void (issues = s), failLabelEdits: () => void (labelEditsFail = true), seedLabels: (l) => void (labels = l), setCi };
}
