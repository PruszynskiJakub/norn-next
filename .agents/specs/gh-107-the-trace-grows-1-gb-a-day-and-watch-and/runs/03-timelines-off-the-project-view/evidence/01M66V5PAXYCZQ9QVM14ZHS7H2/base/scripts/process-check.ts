/**
 * The "process" check (.github/workflows/process.yml): every PR to main comes from norn, from the
 * bypass, or from Dependabot. `processCheck` decides from facts alone; the CLI below gathers them
 * with `gh` and prints the verdict as one JSON value (P8): `{ok, reason}` or `{error, do_instead}`.
 *
 * A PR passes iff
 *   (a) its head branch is a norn story branch `gh-<N>-<slug>` (storyBranch, §7) and it closes #N;
 *   (b) it is labelled `bypass`, closes an issue labelled `bypass`, and that issue links another issue;
 *   (c) its author is Dependabot.
 * (a) and (b) also need a branch in this repository: a fork PR is input to an issue, not merged as is.
 *
 *   bun scripts/process-check.ts <pr-number>   (needs GH_TOKEN; GITHUB_REPOSITORY names the repo)
 */

export interface IssueFacts {
  number: number;
  labels: string[];
  body: string;
}

export interface PrFacts {
  /** `owner/name` of the repository the PR targets */
  repo: string;
  author: string;
  head: string;
  /** the head branch lives in a fork */
  cross_repo: boolean;
  labels: string[];
  body: string;
  /** issue numbers in this repository that GitHub will close on merge (closingIssuesReferences) */
  closing: number[];
  /** the issues the PR closes, by number, for the bypass rule; absent ones count as unknown */
  issues: Record<number, IssueFacts>;
}

export type Verdict = { ok: true; reason: string } | { ok: false; error: string; do_instead: string };

export const BYPASS_LABEL = "bypass";
const DEPENDABOT = new Set(["dependabot[bot]", "app/dependabot", "dependabot"]);
/** storyBranch(`gh-<N>`, slug): STORY_KEY_PATTERN + "-" + SLUG_PATTERN (packages/schema/src/common.ts). */
const STORY_BRANCH = /^gh-([1-9][0-9]*)-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const KEYWORDS = "close|closes|closed|fix|fixes|fixed|resolve|resolves|resolved";

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** An issue reference to this repository: `#N`, `owner/name#N` or its issue URL. */
function refPattern(repo: string): string {
  const r = escape(repo);
  return `(?:(?<![\\w/])#|\\b${r}#|https://github\\.com/${r}/issues/)([1-9][0-9]*)\\b`;
}

/** The text GitHub reads references from: HTML comments and fenced code blocks removed. */
export function visibleText(markdown: string): string {
  return markdown
    .replace(/<!--[\s\S]*?(?:-->|$)/g, " ")
    .replace(/^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:^ {0,3}\1[`~]*[ \t]*$|(?![\s\S]))/gm, " ");
}

/** Issues the body closes with a closing keyword (GitHub's syntax, case-insensitive). */
export function closedInBody(body: string, repo: string): number[] {
  const re = new RegExp(`\\b(?:${KEYWORDS})\\s*:?\\s+${refPattern(repo)}`, "gi");
  return uniq([...visibleText(body).matchAll(re)].map((m) => Number(m[1])));
}

/** Issues a text links, any reference form, without the issue itself. */
export function linkedIssues(body: string, repo: string, self: number): number[] {
  const re = new RegExp(refPattern(repo), "gi");
  return uniq([...visibleText(body).matchAll(re)].map((m) => Number(m[1]))).filter((n) => n !== self);
}

const uniq = (ns: number[]) => [...new Set(ns)].sort((a, b) => a - b);

/** Every issue the PR closes: GitHub's own list plus closing keywords in the body. */
export function closedIssues(f: PrFacts): number[] {
  return uniq([...f.closing, ...closedInBody(f.body, f.repo)]);
}

export function processCheck(f: PrFacts): Verdict {
  if (DEPENDABOT.has(f.author)) return { ok: true, reason: "Dependabot PR" };

  const closes = closedIssues(f);
  const fork = f.cross_repo
    ? refuse(
        `PR comes from a fork (${f.head}); only branches in ${f.repo} are merged`,
        "Open an issue that describes the change and link this PR from it; the maintainer delivers it with norn.",
      )
    : null;

  const story = STORY_BRANCH.exec(f.head);
  if (story) {
    if (fork) return fork;
    const n = Number(story[1]);
    if (closes.includes(n)) return { ok: true, reason: `norn story branch ${f.head} closes #${n}` };
    return refuse(
      `branch ${f.head} is the norn story branch for #${n}, but the PR does not close #${n}`,
      `Add \`Closes #${n}\` to the PR description (norn's open-pr step writes it; keep it when editing the body).`,
    );
  }

  if (f.labels.includes(BYPASS_LABEL)) {
    if (fork) return fork;
    if (!closes.length)
      return refuse(
        "bypass PR closes no issue",
        `Open an issue labelled \`${BYPASS_LABEL}\` that links the norn issue behind it, and add \`Closes #<that issue>\` to the PR description.`,
      );
    for (const n of closes) {
      const issue = f.issues[n];
      if (issue?.labels.includes(BYPASS_LABEL) && linkedIssues(issue.body, f.repo, n).length)
        return { ok: true, reason: `bypass: closes #${n}, which links ${linkedIssues(issue.body, f.repo, n).map((m) => `#${m}`).join(", ")}` };
    }
    const list = closes.map((n) => `#${n}`).join(", ");
    return refuse(
      `bypass PR closes ${list}, but none of them is labelled \`${BYPASS_LABEL}\` and links another issue`,
      `Label the closed issue \`${BYPASS_LABEL}\` and link the norn issue for the problem behind it in its body (\`#<M>\`), then re-run this check.`,
    );
  }

  return refuse(
    `branch ${f.head} is not a norn story branch (gh-<N>-<slug>) and the PR is not labelled \`${BYPASS_LABEL}\``,
    "Start every change as a norn issue and let norn open the PR from its story branch. Only when norn cannot deliver the change: open an issue labelled `bypass` that links the norn issue behind it, label this PR `bypass` and add `Closes #<bypass issue>`.",
  );
}

const refuse = (error: string, do_instead: string): Verdict => ({ ok: false, error, do_instead });

// ---------------------------------------------------------------- CLI: gather facts with gh

/** Runs `gh <args>` and returns its parsed JSON; throws on failure. */
export type Gh = (args: string[]) => unknown;

const gh: Gh = (args) => {
  const p = Bun.spawnSync(["gh", ...args], { stdout: "pipe", stderr: "pipe" });
  if (p.exitCode !== 0) throw new Error(`gh ${args.join(" ")}: ${p.stderr.toString().trim()}`);
  return JSON.parse(p.stdout.toString());
};

interface GhPr {
  author: { login: string };
  headRefName: string;
  isCrossRepository: boolean;
  labels: Array<{ name: string }>;
  body: string;
  closingIssuesReferences: Array<{ number: number; repository: { name: string; owner: { login: string } } }>;
}
interface GhIssue {
  labels: Array<{ name: string }>;
  body: string;
}

/** The facts for `processCheck`. An issue `gh` cannot read (e.g. `Closes #<a PR>`) is left out of `issues`. */
export function gatherFacts(repo: string, pr: number, run: Gh = gh): PrFacts {
  const p = run(["pr", "view", String(pr), "--repo", repo, "--json", "author,headRefName,isCrossRepository,labels,body,closingIssuesReferences"]) as GhPr;
  const same = (r: GhPr["closingIssuesReferences"][number]) => `${r.repository.owner.login}/${r.repository.name}`.toLowerCase() === repo.toLowerCase();
  const facts: PrFacts = {
    repo,
    author: p.author.login,
    head: p.headRefName,
    cross_repo: p.isCrossRepository,
    labels: p.labels.map((l) => l.name),
    body: p.body ?? "",
    closing: p.closingIssuesReferences.filter(same).map((r) => r.number),
    issues: {},
  };
  if (facts.labels.includes(BYPASS_LABEL))
    for (const n of closedIssues(facts)) {
      try {
        const i = run(["issue", "view", String(n), "--repo", repo, "--json", "labels,body"]) as GhIssue;
        facts.issues[n] = { number: n, labels: i.labels.map((l) => l.name), body: i.body ?? "" };
      } catch {
        // not an issue gh can read: it cannot be the bypass issue, processCheck refuses on its own
      }
    }
  return facts;
}

/** Gather and decide; a PR gh cannot read is a refusal with what to do, never a crash. */
export function runCheck(repo: string, pr: number, run: Gh = gh): Verdict {
  let facts: PrFacts;
  try {
    facts = gatherFacts(repo, pr, run);
  } catch (e) {
    return refuse(
      `could not read PR #${pr} in ${repo}: ${(e as Error).message}`,
      "Re-run the check. If it fails again, check that the PR exists and the workflow token can read pull requests and issues.",
    );
  }
  return processCheck(facts);
}

if (import.meta.main) {
  const pr = Number(process.argv[2]);
  const repo = process.env.GITHUB_REPOSITORY ?? "";
  if (!Number.isInteger(pr) || pr < 1 || !repo) {
    console.log(JSON.stringify({ error: "usage: bun scripts/process-check.ts <pr-number>", do_instead: "Set GITHUB_REPOSITORY=owner/name and pass the PR number." }));
    process.exit(2);
  }
  const verdict = runCheck(repo, pr);
  console.log(JSON.stringify(verdict));
  if (!verdict.ok) {
    console.log(`::error title=process::${verdict.error}. ${verdict.do_instead}`);
    process.exit(3); // ExitCode.refused: a rule says no
  }
}
