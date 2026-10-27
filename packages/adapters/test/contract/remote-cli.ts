/**
 * Scripted `gh` and `glab` CLIs for the RemotePort contract: an in-memory remote answering exactly
 * the commands the adapters run, in each CLI's JSON shapes (as the recorded fixtures in
 * test/gh and test/glab show them). Filters follow the flags the adapter passed, so a dropped
 * `--assignee`/`--label`/`--state`/`--draft` shows up as a contract failure. An unknown command throws.
 */
import type { Exec, ExecResult } from "../../src/exec.ts";
import type { SeedIssue } from "./remote.ts";

interface Pr {
  number: number;
  head: string;
  base: string;
  title: string;
  draft: boolean;
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

export interface ScriptedRemote {
  exec: Exec;
  seed(issues: SeedIssue[]): void;
}

export function scriptedGh(login = "octocat"): ScriptedRemote {
  let issues: SeedIssue[] = [];
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
    if (a === "issue" && b === "view") {
      const i = issues.find((x) => x.number === Number(argv[3]));
      return i ? ok(issueJson(i)) : { code: 1, stdout: "", stderr: `GraphQL: Could not resolve to an issue or pull request with the number of ${argv[3]}.` };
    }
    if (a === "pr" && b === "list") {
      const head = flag(argv, "--head");
      const rows = prs.filter((p) => p.head === head).sort((x, y) => y.number - x.number); // newest first
      return ok(rows.slice(0, Number(flag(argv, "--limit") ?? 30)).map(prJson));
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
    throw new Error(`scripted gh: unexpected call: ${argv.join(" ")}`);
  };
  return { exec, seed: (s) => void (issues = s) };
}

export function scriptedGlab(login = "tanuki"): ScriptedRemote {
  let issues: SeedIssue[] = [];
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
  const exec: Exec = async (argv) => {
    const [bin, a, b] = argv;
    if (bin !== "glab") throw new Error(`scripted glab: not a glab call: ${argv.join(" ")}`);
    if (a === "api" && b === "user") return ok({ id: 1, username: login });
    if (a === "issue" && b === "list") {
      const assignee = flag(argv, "--assignee") === "@me" ? login : flag(argv, "--assignee");
      const label = flag(argv, "--label");
      const all = argv.includes("--all");
      return ok(issues.filter((i) => (all || i.state === "open") && (!assignee || i.assignees.includes(assignee)) && (!label || i.labels.includes(label))).map(issueJson));
    }
    if (a === "issue" && b === "view") {
      const i = issues.find((x) => x.number === Number(argv[3]));
      return i ? ok(issueJson(i)) : { code: 1, stdout: "", stderr: "ERROR: 404 Not Found" };
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
      return m ? ok(mrJson(m)) : { code: 1, stdout: "", stderr: "ERROR: 404 Not Found" };
    }
    throw new Error(`scripted glab: unexpected call: ${argv.join(" ")}`);
  };
  return { exec, seed: (s) => void (issues = s) };
}
