/**
 * A `gh` for the CLI's end-to-end tests, run as a process on PATH as norn and the workflows' check
 * scripts run the real one. It keeps one repository in the JSON file `$FAKE_GH_STATE` (issues,
 * labels, pull requests with their mergeability, checks and CI run) and appends every argv to
 * `$FAKE_GH_LOG`, so a test reads which calls were made and in what order.
 *
 * It answers only the commands norn and the shipped check scripts run, in gh's shapes and exit
 * codes, and only the `--json` fields asked for; anything else exits 2 naming the call, so a new
 * call shows up as a failing test rather than a guess. A `-q` expression is answered from a small
 * table of the ones the scripts use, for the same reason.
 *
 * `fail` in the state makes a call fail as GitHub does: `{"<sub> <cmd>": {code, stderr}}`, matched
 * on the first two words (`auth status`, `label create`, `issue create`), or `*` for every call.
 */
import { spawnSync } from "node:child_process";
import { appendFileSync, readFileSync, renameSync, writeFileSync } from "node:fs";

export interface GhIssue {
  number: number;
  title: string;
  body: string;
  open: boolean;
  assignees: string[];
  labels: string[];
  author: string;
  comments: { body: string; url: string }[];
}

export type Mergeable = "MERGEABLE" | "CONFLICTING" | "UNKNOWN";

export interface GhPr {
  number: number;
  head: string;
  base: string;
  title: string;
  body: string;
  draft: boolean;
  state: "OPEN" | "CLOSED" | "MERGED";
  mergeSha?: string;
  mergedAt?: string;
  /** what `--json mergeable` answers; a list is answered one entry per call, the last one kept */
  mergeable: Mergeable | Mergeable[];
  /** the PR's checks as `statusCheckRollup` and `gh pr checks` show them */
  checks: "none" | "success" | "failure" | "pending";
  /** the ci.yml run of the PR's head, as `gh run list` finds it; null: none started */
  run: "success" | "failure" | null;
}

export interface GhState {
  repo: string;
  login: string;
  /** the bare repository the checkout pushes to: a PR's head is that branch's commit there */
  remote: string;
  issues: GhIssue[];
  labels: { name: string; color: string; description: string }[];
  prs: GhPr[];
  fail: Record<string, { code: number; stderr: string }>;
  /** what a PR opened from now on starts with, over a mergeable PR with no checks and no run */
  newPr?: Partial<Pick<GhPr, "mergeable" | "checks" | "run">>;
}

const AT = "2026-10-20T09:15:00Z";
const ZERO = "0".repeat(40);

interface Answer {
  code?: number;
  stdout?: string;
  stderr?: string;
}

const statePath = process.env.FAKE_GH_STATE as string;
const logPath = process.env.FAKE_GH_LOG as string;
const argv = process.argv.slice(2);
appendFileSync(logPath, `${JSON.stringify(argv)}\n`);

const state = JSON.parse(readFileSync(statePath, "utf8")) as GhState;
let dirty = false;
const web = `https://github.com/${state.repo}`;

const flag = (name: string): string | undefined => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
/** Every value of a repeatable flag, comma lists split, as gh reads `--label a --label b,c`. */
const flags = (name: string): string[] => argv.flatMap((a, i) => (argv[i - 1] === name ? a.split(",") : []));
const values = (name: string): string[] => argv.filter((_, i) => argv[i - 1] === name);
const me = (who: string | undefined) => (who === "@me" ? state.login : who);
const json = (v: unknown): Answer => ({ stdout: `${JSON.stringify(v)}\n` });
const err = (stderr: string, code = 1): Answer => ({ code, stderr: `${stderr}\n` });
const unknown = (): Answer => err(`fake gh: no answer for gh ${argv.join(" ")}`, 2);

function pick(row: Record<string, unknown>, fields: string | undefined): Record<string, unknown> {
  if (fields === undefined) throw new Error("fake gh: --json without fields");
  const out: Record<string, unknown> = {};
  for (const f of fields.split(",")) {
    if (!(f in row)) throw new Error(`fake gh: unknown --json field ${f}`);
    out[f] = row[f];
  }
  return out;
}

/** The commit a branch has on the remote, as GitHub knows a PR's head. */
function remoteHead(branch: string): string {
  const r = spawnSync("git", ["--git-dir", state.remote, "rev-parse", "--verify", "-q", `refs/heads/${branch}`], { encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : ZERO;
}

/** The branch checked out where gh runs, as gh picks the PR of `gh pr view` with no number. */
function currentBranch(): string {
  return spawnSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { encoding: "utf8" }).stdout.trim();
}

function mergeableNow(p: GhPr): Mergeable {
  if (!Array.isArray(p.mergeable)) return p.mergeable;
  const now = p.mergeable[0] ?? "UNKNOWN";
  if (p.mergeable.length > 1) {
    p.mergeable = p.mergeable.slice(1);
    dirty = true;
  }
  return now;
}

const issueRow = (i: GhIssue): Record<string, unknown> => ({
  number: i.number,
  url: `${web}/issues/${i.number}`,
  title: i.title,
  body: i.body,
  state: i.open ? "OPEN" : "CLOSED",
  assignees: i.assignees.map((a) => ({ id: `U_${a}`, login: a, name: a })),
  labels: i.labels.map((l) => ({ id: `L_${l}`, name: l, description: "", color: "ededed" })),
  updatedAt: AT,
  comments: i.comments.map((c) => ({ author: { login: state.login }, body: c.body, url: c.url })),
});

const rollup = (p: GhPr) => (p.checks === "none" ? [] : [{ __typename: "CheckRun", name: "test", status: p.checks === "pending" ? "IN_PROGRESS" : "COMPLETED", conclusion: p.checks === "pending" ? "" : p.checks.toUpperCase() }]);

/** A PR as gh's `--json` knows it; `mergeable` is read only when asked for, as each read consumes one. */
function prRow(p: GhPr, fields: string | undefined): Record<string, unknown> {
  const row: Record<string, unknown> = {
    number: p.number,
    url: `${web}/pull/${p.number}`,
    title: p.title,
    body: p.body,
    state: p.state,
    isDraft: p.draft,
    headRefName: p.head,
    headRefOid: remoteHead(p.head),
    baseRefName: p.base,
    mergedAt: p.mergedAt ?? null,
    mergeCommit: p.mergeSha ? { oid: p.mergeSha } : null,
    statusCheckRollup: rollup(p),
  };
  if (fields?.split(",").includes("mergeable")) row.mergeable = mergeableNow(p);
  return row;
}

const newestFirst = <T extends { number: number }>(rows: T[]) => [...rows].sort((x, y) => y.number - x.number);
const limit = () => Number(flag("--limit") ?? 30);
const issueAt = (n: string | undefined) => state.issues.find((i) => i.number === Number(n));
const prAt = (n: string | undefined) => state.prs.find((p) => p.number === Number(n));
const noIssue = (n: string | undefined) => err(`GraphQL: Could not resolve to an issue or pull request with the number of ${n}. (repository.issue)`);
const noPr = (n: string | undefined) => err(`GraphQL: Could not resolve to a PullRequest with the number of ${n}. (repository.pullRequest)`);
const known = (l: string) => state.labels.some((d) => d.name === l) || state.issues.some((i) => i.labels.includes(l));

/** The `-q` expressions the check scripts use: a path (`.a.b`, `.[0].x`), optionally piped to `length`. */
function query(value: unknown, q: string): string {
  const [path, ...rest] = q.split("|").map((s) => s.trim());
  let v: unknown = value;
  for (const m of (path ?? "").matchAll(/\.(\w+)|\[(\d+)\]/g)) {
    if (v === null || v === undefined) break;
    v = m[1] !== undefined ? (v as Record<string, unknown>)[m[1]] : (v as unknown[])[Number(m[2])];
  }
  if (rest.length === 1 && rest[0] === "length") v = Array.isArray(v) ? v.length : 0;
  else if (rest.length > 0 || !/^(\.\w+|\.\[\d+\]\.\w+|\.\w+\.\w+)?$/.test(path ?? "")) throw new Error(`fake gh: -q ${q} is not one it knows`);
  return v === null || v === undefined ? "" : typeof v === "string" ? v : JSON.stringify(v);
}

/** `--json` fields picked, then `-q` applied when given, as gh prints either. */
function out(row: Record<string, unknown> | Record<string, unknown>[]): Answer {
  const q = flag("-q") ?? flag("--jq");
  if (q === undefined) return json(row);
  return { stdout: `${query(row, q)}\n` };
}

const RUN_BASE = 9000;
const runOf = (id: string | undefined) => state.prs.find((p) => p.run !== null && RUN_BASE + p.number === Number(id));

function answer(): Answer {
  const [a, b, n] = argv;
  const cmd = `${a} ${b}`;
  if (a === "--version") return { stdout: "gh version 2.60.0 (fake)\n" };
  const failing = state.fail[cmd] ?? state.fail["*"];
  if (failing) return err(failing.stderr, failing.code);
  if (cmd === "auth status") return { stderr: `github.com\n  ✓ Logged in to github.com account ${state.login}\n` };
  if (a === "api" && argv.includes("-R")) return err("unknown shorthand flag: 'R' in -R\n\nUsage:  gh api <endpoint> [flags]");
  if (cmd === "api user") return flag("--jq") === ".login" ? { stdout: `${state.login}\n` } : unknown();
  if (cmd === "repo view") return json(pick({ nameWithOwner: state.repo, name: state.repo.split("/")[1], url: web }, flag("--json")));

  const scoped = !(a === "api" || a === "run" || (a === "pr" && (b === "view" || b === "checks") && flag("-R") === undefined));
  if (scoped && flag("-R") !== state.repo) return err(`fake gh: ${cmd} without -R ${state.repo}`, 2);

  if (cmd === "issue list") {
    const label = flag("--label");
    const assignee = me(flag("--assignee"));
    const author = me(flag("--author"));
    const st = flag("--state") ?? "open";
    const rows = state.issues.filter(
      (i) => (st === "all" || i.open === (st === "open")) && (!label || i.labels.includes(label)) && (!assignee || i.assignees.includes(assignee)) && (!author || i.author === author),
    );
    return json(newestFirst(rows).slice(0, limit()).map((i) => pick(issueRow(i), flag("--json"))));
  }
  if (cmd === "issue view") {
    const i = issueAt(n);
    return i ? json(pick(issueRow(i), flag("--json"))) : noIssue(n);
  }
  if (cmd === "issue create") {
    if (flag("--body-file") !== "-") return unknown();
    // GitHub refuses an issue carrying a label the repository does not define
    const missing = flags("--label").find((l) => !state.labels.some((d) => d.name.toLowerCase() === l.toLowerCase()));
    if (missing) return err(`could not add label: '${missing}' not found`);
    const number = Math.max(0, ...state.issues.map((i) => i.number), ...state.prs.map((p) => p.number)) + 1;
    const assignee = me(flag("--assignee"));
    state.issues.push({ number, title: flag("--title") ?? "", body: stdin(), open: true, assignees: assignee ? [assignee] : [], labels: flags("--label"), author: state.login, comments: [] });
    dirty = true;
    return { stdout: `\nCreating issue in ${state.repo}\n\n${web}/issues/${number}\n` };
  }
  if (cmd === "issue comment") {
    const i = issueAt(n);
    if (!i || flag("--body-file") !== "-") return i ? unknown() : noIssue(n);
    const url = `${web}/issues/${i.number}#issuecomment-${9000 + i.comments.length}`;
    i.comments.push({ body: stdin(), url });
    dirty = true;
    return { stdout: `${url}\n` };
  }
  if (cmd === "issue edit") {
    const i = issueAt(n);
    if (!i) return noIssue(n);
    const remove = flags("--remove-label");
    const missing = remove.find((l) => !known(l));
    if (missing) return err(`failed to update ${web}/issues/${i.number}: '${missing}' not found`);
    const add = flags("--add-label");
    const assign = flags("--add-assignee").map((x) => me(x) as string);
    i.labels = [...i.labels.filter((l) => !remove.includes(l)), ...add.filter((l) => !i.labels.includes(l))];
    i.assignees = [...i.assignees, ...assign.filter((x) => !i.assignees.includes(x))];
    dirty = true;
    return { stdout: `${web}/issues/${i.number}\n` };
  }
  if (cmd === "issue close") {
    const i = issueAt(n);
    if (!i) return noIssue(n);
    if (!i.open) return { stderr: `! Issue ${state.repo}#${i.number} (${i.title}) is already closed\n` };
    i.open = false;
    dirty = true;
    return { stderr: `✓ Closed issue ${state.repo}#${i.number} (${i.title})\n` };
  }
  if (cmd === "label list") return json(state.labels.slice(0, limit()).map((l) => pick({ ...l, color: l.color.toLowerCase() }, flag("--json"))));
  if (cmd === "label create") {
    if (argv.includes("--force")) return err("fake gh: label create --force restyles a label a person may have chosen", 2);
    const name = n ?? "";
    if (state.labels.some((l) => l.name.toLowerCase() === name.toLowerCase())) return err(`label with name "${name}" already exists; use \`--force\` to update its color and description`);
    state.labels.push({ name, color: flag("--color") ?? "ededed", description: flag("--description") ?? "" });
    dirty = true;
    return { stdout: `✓ Label "${name}" created in ${state.repo}\n` };
  }
  if (cmd === "pr list") {
    if (flag("--state") !== "all") return unknown();
    const head = flag("--head");
    return json(newestFirst(state.prs.filter((p) => p.head === head)).slice(0, limit()).map((p) => pick(prRow(p, flag("--json")), flag("--json"))));
  }
  if (cmd === "pr create") {
    if (flag("--body-file") !== "-") return unknown();
    const number = Math.max(0, ...state.issues.map((i) => i.number), ...state.prs.map((p) => p.number)) + 1;
    const p: GhPr = { number, head: flag("--head") ?? "", base: flag("--base") ?? "", title: flag("--title") ?? "", body: stdin(), draft: argv.includes("--draft"), state: "OPEN", mergeable: "MERGEABLE", checks: "none", run: null, ...state.newPr };
    state.prs.push(p);
    dirty = true;
    return { stdout: `\nCreating ${p.draft ? "draft " : ""}pull request for ${p.head} into ${p.base} in ${state.repo}\n\n${web}/pull/${p.number}\n` };
  }
  if (cmd === "pr view") {
    const p = n !== undefined && !n.startsWith("-") ? prAt(n) : newestFirst(state.prs.filter((x) => x.head === currentBranch() && x.state === "OPEN"))[0];
    if (!p) return n !== undefined && !n.startsWith("-") ? noPr(n) : err(`no pull requests found for branch "${currentBranch()}"`);
    return out(pick(prRow(p, flag("--json")), flag("--json")));
  }
  if (cmd === "pr edit") {
    const p = prAt(n);
    if (!p) return noPr(n);
    const title = flag("--title");
    if (title !== undefined) p.title = title;
    if (flag("--body-file") === "-") p.body = stdin();
    dirty = true;
    return { stdout: `${web}/pull/${p.number}\n` };
  }
  if (cmd === "pr ready") {
    const p = prAt(n);
    if (!p) return noPr(n);
    if (!p.draft) return { stderr: `! Pull request ${state.repo}#${p.number} (${p.title}) is already "ready for review"\n` };
    p.draft = false;
    dirty = true;
    return { stderr: `✓ Pull request ${state.repo}#${p.number} (${p.title}) is marked as "ready for review"\n` };
  }
  if (cmd === "pr checks") {
    const p = prAt(n);
    if (!p) return noPr(n);
    if (p.checks === "none") return err(`no checks reported on the '${p.head}' branch`);
    const code = p.checks === "pending" ? 8 : p.checks === "failure" ? 1 : 0;
    const rows = [
      { name: "lint", bucket: "pass", link: `${web}/actions/runs/1/job/6` },
      { name: "test", bucket: { success: "pass", pending: "pending", failure: "fail" }[p.checks], link: `${web}/actions/runs/1/job/7` },
    ];
    const fields = flag("--json");
    if (fields === "bucket" || fields === "name,bucket,link") return { code, stdout: JSON.stringify(rows.map((r) => pick(r, fields))) };
    if (fields !== undefined) return unknown();
    // --watch waits the checks out; here they are already settled, or stay pending as scripted
    return { code, stdout: `lint\tpass\t10s\t${web}/actions/runs/1/job/6\ntest\t${p.checks === "failure" ? "fail" : p.checks === "pending" ? "pending" : "pass"}\t1m\t${web}/actions/runs/1/job/7\n` };
  }
  if (a === "api" && b?.startsWith("repos/{owner}/{repo}/commits/") && b.includes("/check-runs")) {
    const sha = b.split("/")[4];
    const p = state.prs.find((x) => remoteHead(x.head) === sha);
    if (!p || p.checks !== "failure") return { stdout: "" };
    return { stdout: `- test (id 7): ${web}/actions/runs/1/job/7\n` };
  }
  if (cmd === "run list") {
    const sha = flag("--commit");
    const p = state.prs.find((x) => x.run !== null && remoteHead(x.head) === sha);
    return out(p ? [{ databaseId: RUN_BASE + p.number }] : []);
  }
  if (cmd === "run watch") {
    const p = runOf(n);
    if (!p) return err(`could not find any workflow run with ID ${n}`);
    return p.run === "failure" ? { code: 1, stdout: `X run ${n} failed\n` } : { stdout: `✓ run ${n} completed\n` };
  }
  if (cmd === "run view") {
    const p = runOf(n);
    if (!p) return err(`could not find any workflow run with ID ${n}`);
    if (flag("--json") === "url") return out({ url: `${web}/actions/runs/${n}` });
    if (flag("--json") === "jobs") return { stdout: p.run === "failure" ? "- job 7: test\n" : "" };
    return unknown();
  }
  if (cmd === "api graphql") return graphql();
  return unknown();
}

function graphql(): Answer {
  const fs = values("-f");
  const [owner, name] = state.repo.split("/");
  if (!fs.includes(`owner=${owner}`) || !fs.includes(`name=${name}`)) return err("GraphQL: Could not resolve to a Repository with the name 'x'. (repository)");
  const q = fs.find((f) => f.startsWith("query="))?.slice("query=".length) ?? "";
  const variable = (v: string) => fs.find((f) => f.startsWith(`${v}=`))?.slice(v.length + 1);
  if (/\bissues\(/.test(q)) {
    const label = variable("label");
    const assignee = variable("assignee");
    const rows = newestFirst(state.issues.filter((i) => i.open && (!label || i.labels.includes(label)) && (!assignee || i.assignees.includes(assignee))));
    const from = Number(variable("after") ?? 0);
    const page = rows.slice(from, from + 100);
    const nodes = page.map((i) => ({
      ...pick(issueRow(i), "number,url,title,body,state,updatedAt"),
      assignees: { nodes: i.assignees.map((login) => ({ login })) },
      labels: { nodes: i.labels.map((l) => ({ name: l })) },
    }));
    const more = from + page.length < rows.length;
    return json({ data: { repository: { issues: { pageInfo: { hasNextPage: more, endCursor: more ? String(from + page.length) : null }, nodes } } } });
  }
  const repository: Record<string, { nodes: unknown[] }> = {};
  for (const m of q.matchAll(/(b\d+): pullRequests\(headRefName: ("(?:[^"\\]|\\.)*")/g)) {
    const head = JSON.parse(m[2] as string) as string;
    const newest = newestFirst(state.prs.filter((p) => p.head === head))[0];
    repository[m[1] as string] = { nodes: newest ? [pick(prRow(newest, undefined), "number,url,title,state,isDraft,headRefName,headRefOid,baseRefName,mergedAt,mergeCommit")] : [] };
  }
  return json({ data: { repository } });
}

let input: string | undefined;
function stdin(): string {
  input ??= readFileSync(0, "utf8");
  return input;
}

let result: Answer;
try {
  result = answer();
} catch (e) {
  result = err(String(e instanceof Error ? e.message : e), 2);
}
if (dirty) {
  // a rename, so a test or a concurrent gh never reads half a state
  const tmp = `${statePath}.${process.pid}`;
  writeFileSync(tmp, JSON.stringify(state, null, 2));
  renameSync(tmp, statePath);
}
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
process.exit(result.code ?? 0);
