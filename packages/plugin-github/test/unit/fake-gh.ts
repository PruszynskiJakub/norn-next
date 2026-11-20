/**
 * A scripted `gh` over an in-memory repository: it answers exactly the commands the plugin runs, in
 * gh's JSON shapes and exit codes, and only the `--json` fields asked for, so a dropped flag or field
 * shows up as a failing test. Repository-scoped commands must carry `-R acme/app`; `gh api` refuses one. A command it does
 * not know is left unanswered, which scriptedExec turns into exit 127.
 */
import type { ExecScript, ScriptedAnswer, SeedItem } from "@norn/conformance";
import type { ChecksSummary, TrackerLabel } from "@norn/plugin-api";

export const REPO = "acme/app";
export const LOGIN = "octocat";
export const AT = "2026-10-20T09:15:00Z";
export const HEAD_SHA = "c".repeat(40);
const WEB = `https://github.com/${REPO}`;

export interface FakeComment {
  body: string;
  url: string;
}

export interface FakeIssue {
  number: number;
  title: string;
  body: string;
  open: boolean;
  assignees: string[];
  labels: string[];
  author: string;
  comments: FakeComment[];
}

export interface FakePr {
  number: number;
  head: string;
  base: string;
  title: string;
  body: string;
  draft: boolean;
  state: "OPEN" | "CLOSED" | "MERGED";
  mergeSha?: string;
  mergedAt?: string;
  checks?: Exclude<ChecksSummary, "none">;
  /** the check runs on the head, as GitHub's checks API reports them; absent: `checks` alone, with no names or annotations */
  runs?: FakeCheckRun[];
}

export interface FakeAnnotation {
  path: string;
  start_line: number;
  annotation_level: "failure" | "warning" | "notice";
  message: string;
}

export interface FakeCheckRun {
  id: number;
  name: string;
  conclusion: "success" | "failure" | "cancelled" | null;
  details_url: string;
  annotations: FakeAnnotation[];
}

export interface FakeGh {
  script: ExecScript;
  issues: FakeIssue[];
  prs: FakePr[];
  labels: TrackerLabel[];
  seed(items: SeedItem[]): void;
  /** while on, every call fails as gh does when it cannot reach GitHub */
  failing(on: boolean): void;
  /** the next answers for these subcommands (`issue create`, ...), used once each, before the repository is touched */
  override(cmd: string, answer: ScriptedAnswer, apply?: boolean): void;
}

const json = (v: unknown): ScriptedAnswer => ({ stdout: JSON.stringify(v) });
const err = (stderr: string, code = 1): ScriptedAnswer => ({ code, stderr });
export const NO_REPOSITORY = err(`GraphQL: Could not resolve to a Repository with the name '${REPO}'. (repository)`);
export const UNREACHABLE = err("error connecting to api.github.com\ncheck your internet connection or https://githubstatus.com");
const noIssue = (n: string) => err(`GraphQL: Could not resolve to an issue or pull request with the number of ${n}. (repository.issue)`);
const noPr = (n: string) => err(`GraphQL: Could not resolve to a PullRequest with the number of ${n}. (repository.pullRequest)`);

function flag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

/** Every value of a repeatable flag, comma lists split, as gh reads `--label a --label b,c`. */
function flags(argv: string[], name: string): string[] {
  return argv.flatMap((a, i) => (argv[i - 1] === name ? a.split(",") : []));
}

/** Every value of a repeatable flag, unsplit: a GraphQL query has commas of its own. */
function values(argv: string[], name: string): string[] {
  return argv.filter((_, i) => argv[i - 1] === name);
}

function pick(row: Record<string, unknown>, fields: string | undefined): Record<string, unknown> {
  if (fields === undefined) throw new Error("fake gh: --json without fields");
  const out: Record<string, unknown> = {};
  for (const f of fields.split(",")) {
    if (!(f in row)) throw new Error(`fake gh: unknown --json field ${f}`);
    out[f] = row[f];
  }
  return out;
}

const UNSCOPED = new Set(["api user", "repo view", "api graphql"]);

export function fakeGh(login = LOGIN): FakeGh {
  const world = {
    issues: [] as FakeIssue[],
    prs: [] as FakePr[],
    labels: [] as TrackerLabel[],
  };
  let down = false;
  const overrides = new Map<string, { answer: ScriptedAnswer; apply: boolean }>();
  const me = (who: string | undefined) => (who === "@me" ? login : who);

  const issueRow = (i: FakeIssue): Record<string, unknown> => ({
    number: i.number,
    url: `${WEB}/issues/${i.number}`,
    title: i.title,
    body: i.body,
    state: i.open ? "OPEN" : "CLOSED",
    assignees: i.assignees.map((a) => ({ id: `U_${a}`, login: a, name: a })),
    labels: i.labels.map((l) => ({ id: `L_${l}`, name: l, description: "", color: "ededed" })),
    updatedAt: AT,
    comments: i.comments.map((c) => ({ author: { login }, body: c.body, url: c.url })),
  });
  const prRow = (p: FakePr): Record<string, unknown> => ({
    number: p.number,
    url: `${WEB}/pull/${p.number}`,
    title: p.title,
    body: p.body,
    state: p.state,
    isDraft: p.draft,
    headRefName: p.head,
    headRefOid: HEAD_SHA,
    baseRefName: p.base,
    mergedAt: p.mergedAt ?? null,
    mergeCommit: p.mergeSha ? { oid: p.mergeSha } : null,
  });
  const newestFirst = <T extends { number: number }>(rows: T[]) => [...rows].sort((x, y) => y.number - x.number);
  const limit = (argv: string[]) => Number(flag(argv, "--limit") ?? 30);
  const issueAt = (n: string | undefined) => world.issues.find((i) => i.number === Number(n));
  const prAt = (n: string | undefined) => world.prs.find((p) => p.number === Number(n));
  /** a label gh lets you remove: one the repository defines or some issue carries */
  const known = (l: string) => world.labels.some((d) => d.name === l) || world.issues.some((i) => i.labels.includes(l));

  const answer = (argv: string[], input: string | undefined): ScriptedAnswer | undefined => {
    const [, a, b, n] = argv;
    const cmd = `${a} ${b}`;
    if (cmd === "api user") return flag(argv, "--jq") === ".login" ? { stdout: `${login}\n` } : undefined;
    if (cmd === "repo view") return json(pick({ nameWithOwner: REPO, url: WEB }, flag(argv, "--json")));
    if (cmd === "issue list") {
      const label = flag(argv, "--label");
      const assignee = me(flag(argv, "--assignee"));
      const author = me(flag(argv, "--author"));
      const st = flag(argv, "--state") ?? "open";
      const rows = world.issues.filter(
        (i) =>
          (st === "all" || i.open === (st === "open")) && (!label || i.labels.includes(label)) && (!assignee || i.assignees.includes(assignee)) && (!author || i.author === author),
      );
      return json(newestFirst(rows).slice(0, limit(argv)).map((i) => pick(issueRow(i), flag(argv, "--json"))));
    }
    if (cmd === "issue view") {
      const i = issueAt(n);
      return i ? json(pick(issueRow(i), flag(argv, "--json"))) : noIssue(n ?? "");
    }
    if (cmd === "issue create") {
      if (flag(argv, "--body-file") !== "-") return undefined;
      const number = Math.max(0, ...world.issues.map((i) => i.number)) + 1;
      const assignee = me(flag(argv, "--assignee"));
      world.issues.push({ number, title: flag(argv, "--title") ?? "", body: input ?? "", open: true, assignees: assignee ? [assignee] : [], labels: flags(argv, "--label"), author: login, comments: [] });
      return { stdout: `\nCreating issue in ${REPO}\n\n${WEB}/issues/${number}\n` };
    }
    if (cmd === "issue comment") {
      if (flag(argv, "--body-file") !== "-") return undefined;
      const i = issueAt(n);
      if (!i) return noIssue(n ?? "");
      const url = `${WEB}/issues/${i.number}#issuecomment-${9000 + i.comments.length}`;
      i.comments.push({ body: input ?? "", url });
      return { stdout: `${url}\n` };
    }
    if (cmd === "issue edit") {
      const i = issueAt(n);
      if (!i) return noIssue(n ?? "");
      const remove = flags(argv, "--remove-label");
      const unknown = remove.find((l) => !known(l));
      if (unknown) return err(`failed to update ${WEB}/issues/${i.number}: '${unknown}' not found`);
      const add = flags(argv, "--add-label");
      const assign = flags(argv, "--add-assignee").map((x) => me(x) as string);
      i.labels = [...i.labels.filter((l) => !remove.includes(l)), ...add.filter((l) => !i.labels.includes(l))];
      i.assignees = [...i.assignees, ...assign.filter((x) => !i.assignees.includes(x))];
      return { stdout: `${WEB}/issues/${i.number}\n` };
    }
    if (cmd === "issue close") {
      const i = issueAt(n);
      if (!i) return noIssue(n ?? "");
      if (!i.open) return { stderr: `! Issue ${REPO}#${i.number} (${i.title}) is already closed\n` };
      i.open = false;
      return { stderr: `✓ Closed issue ${REPO}#${i.number} (${i.title})\n` };
    }
    if (cmd === "label list") return json(world.labels.slice(0, limit(argv)).map((l) => pick({ ...l, color: l.color.toLowerCase() }, flag(argv, "--json"))));
    if (cmd === "label create") {
      if (argv.includes("--force")) throw new Error("fake gh: label create --force restyles a label a person may have chosen");
      const name = n ?? "";
      if (world.labels.some((l) => l.name.toLowerCase() === name.toLowerCase()))
        return err(`label with name "${name}" already exists; use \`--force\` to update its color and description`);
      world.labels.push({ name, color: flag(argv, "--color") ?? "ededed", description: flag(argv, "--description") ?? "" });
      return { stdout: `✓ Label "${name}" created in ${REPO}\n` };
    }
    if (cmd === "pr list") {
      const head = flag(argv, "--head");
      if (flag(argv, "--state") !== "all") return undefined;
      return json(newestFirst(world.prs.filter((p) => p.head === head)).slice(0, limit(argv)).map((p) => pick(prRow(p), flag(argv, "--json"))));
    }
    if (cmd === "pr create") {
      if (flag(argv, "--body-file") !== "-") return undefined;
      const p: FakePr = { number: 40 + world.prs.length, head: flag(argv, "--head") ?? "", base: flag(argv, "--base") ?? "", title: flag(argv, "--title") ?? "", body: input ?? "", draft: argv.includes("--draft"), state: "OPEN" };
      world.prs.push(p);
      return { stdout: `\nCreating ${p.draft ? "draft " : ""}pull request for ${p.head} into ${p.base} in ${REPO}\n\n${WEB}/pull/${p.number}\n` };
    }
    if (cmd === "pr view") {
      const p = prAt(n);
      return p ? json(pick(prRow(p), flag(argv, "--json"))) : noPr(n ?? "");
    }
    if (cmd === "pr edit") {
      const p = prAt(n);
      if (!p) return noPr(n ?? "");
      const title = flag(argv, "--title");
      if (title !== undefined) p.title = title;
      if (flag(argv, "--body-file") === "-") p.body = input ?? "";
      return { stdout: `${WEB}/pull/${p.number}\n` };
    }
    if (cmd === "pr ready") {
      const p = prAt(n);
      if (!p) return noPr(n ?? "");
      if (!p.draft) return { stderr: `! Pull request ${REPO}#${p.number} (${p.title}) is already "ready for review"\n` };
      p.draft = false;
      return { stderr: `✓ Pull request ${REPO}#${p.number} (${p.title}) is marked as "ready for review"\n` };
    }
    if (cmd === "pr checks") {
      const fields = flag(argv, "--json");
      if (fields !== "bucket" && fields !== "bucket,name,link") return undefined;
      const p = prAt(n);
      if (!p) return noPr(n ?? "");
      if (!p.checks) return err(`no checks reported on the '${p.head}' branch`);
      const bucketOf = { success: "pass", failure: "fail", cancelled: "cancel" } as const;
      const rows = p.runs
        ? p.runs.map((r) => ({ bucket: r.conclusion === null ? "pending" : bucketOf[r.conclusion], name: r.name, link: r.details_url }))
        : { success: ["pass", "skipping"], pending: ["pass", "pending"], failure: ["pass", "fail"] }[p.checks].map((bucket, i) => ({ bucket, name: `check-${i}`, link: `${WEB}/actions/runs/${i}` }));
      return { code: p.checks === "pending" ? 8 : p.checks === "failure" ? 1 : 0, stdout: JSON.stringify(rows.map((r) => pick(r, fields))) };
    }
    if (a === "api" && b?.startsWith(`repos/${REPO}/`)) {
      const path = b.slice(`repos/${REPO}/`.length);
      const runs = world.prs.flatMap((p) => p.runs ?? []);
      if (path === `commits/${HEAD_SHA}/check-runs?per_page=100`)
        return json({ total_count: runs.length, check_runs: runs.map(({ annotations: _a, ...r }) => ({ ...r, head_sha: HEAD_SHA, status: r.conclusion === null ? "in_progress" : "completed" })) });
      const m = /^check-runs\/(\d+)\/annotations$/.exec(path);
      const run = m ? runs.find((r) => r.id === Number(m[1])) : undefined;
      if (run) return json(run.annotations.map((x) => ({ ...x, end_line: x.start_line, blob_href: `${WEB}/blob/${HEAD_SHA}/${x.path}` })));
      return err("gh: Not Found (HTTP 404)");
    }
    if (cmd === "api graphql") {
      const fs = values(argv, "-f");
      const [owner, name] = REPO.split("/");
      if (!fs.includes(`owner=${owner}`) || !fs.includes(`name=${name}`)) return err("GraphQL: Could not resolve to a Repository with the name 'x'. (repository)");
      const query = fs.find((f) => f.startsWith("query="))?.slice("query=".length) ?? "";
      const variable = (n: string) => fs.find((f) => f.startsWith(`${n}=`))?.slice(n.length + 1);
      if (/\bissues\(/.test(query)) {
        // the repository's issue connection, as GitHub pages it: open, by label and assignee, newest first
        const label = variable("label");
        const assignee = variable("assignee");
        const rows = newestFirst(world.issues.filter((i) => i.open && (!label || i.labels.includes(label)) && (!assignee || i.assignees.includes(assignee))));
        const from = Number(variable("after") ?? 0);
        const page = rows.slice(from, from + 100);
        const nodes = page.map((i) => {
          const r = issueRow(i);
          return { ...pick(r, "number,url,title,body,state,updatedAt"), assignees: { nodes: i.assignees.map((login) => ({ login })) }, labels: { nodes: i.labels.map((name) => ({ name })) } };
        });
        const more = from + page.length < rows.length;
        return json({ data: { repository: { issues: { pageInfo: { hasNextPage: more, endCursor: more ? String(from + page.length) : null }, nodes } } } });
      }
      const repository: Record<string, { nodes: unknown[] }> = {};
      for (const m of query.matchAll(/(b\d+): pullRequests\(headRefName: ("(?:[^"\\]|\\.)*")/g)) {
        const head = JSON.parse(m[2] as string) as string;
        const newest = newestFirst(world.prs.filter((p) => p.head === head))[0];
        const { body: _body, ...node } = newest ? prRow(newest) : { body: "" };
        repository[m[1] as string] = { nodes: newest ? [node] : [] };
      }
      return json({ data: { repository } });
    }
    return undefined;
  };

  const script: ExecScript = (argv, opts) => {
    if (argv[0] !== "gh") return undefined;
    if (down) return UNREACHABLE;
    // gh api takes no repository flag and refuses the whole call when given one
    if (argv[1] === "api" && argv.includes("-R")) return err("unknown shorthand flag: 'R' in -R\n\nUsage:  gh api <endpoint> [flags]");
    const cmd = `${argv[1]} ${argv[2]}`;
    const o = overrides.get(cmd);
    if (o) {
      overrides.delete(cmd);
      if (!o.apply) return o.answer;
      answer(argv, opts.input);
      return o.answer;
    }
    // a REST path names the repository itself
    const rest = argv[1] === "api" && argv[2]?.startsWith("repos/");
    if (!UNSCOPED.has(cmd) && !rest && flag(argv, "-R") !== REPO) return err(`fake gh: ${cmd} without -R ${REPO}`);
    return answer(argv, opts.input);
  };

  return {
    script,
    get issues() {
      return world.issues;
    },
    get prs() {
      return world.prs;
    },
    get labels() {
      return world.labels;
    },
    seed(items) {
      world.issues = items.map((s) => ({ number: s.id, title: s.title, body: s.body, open: s.open, assignees: [...s.assignees], labels: [...s.labels], author: "someone-else", comments: [] }));
    },
    failing(on) {
      down = on;
    },
    override(cmd, a, apply = false) {
      overrides.set(cmd, { answer: a, apply });
    },
  };
}
