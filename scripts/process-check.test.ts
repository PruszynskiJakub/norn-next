/** The "process" check (scripts/process-check.ts, .github/workflows/process.yml). */
import { describe, expect, test } from "bun:test";
import { closedInBody, gatherFacts, linkedIssues, type PrFacts, processCheck, runCheck } from "./process-check.ts";

const REPO = "PruszynskiJakub/norn";

const pr = (over: Partial<PrFacts> = {}): PrFacts => ({
  repo: REPO,
  author: "PruszynskiJakub",
  head: "gh-12-fix-login",
  cross_repo: false,
  labels: [],
  body: "",
  closing: [],
  issues: {},
  ...over,
});

describe("closing keywords", () => {
  test("#N, owner/name#N and the issue URL of this repository", () => {
    expect(closedInBody("Closes #12", REPO)).toEqual([12]);
    expect(closedInBody("fixes: PruszynskiJakub/norn#7\nRESOLVED #3", REPO)).toEqual([3, 7]);
    expect(closedInBody(`Closes https://github.com/${REPO}/issues/12\n\nDelivered by norn (story gh-12).`, REPO)).toEqual([12]);
  });
  test("ignores other repositories, bare mentions and words that only contain a keyword", () => {
    expect(closedInBody("Closes other/repo#12", REPO)).toEqual([]);
    expect(closedInBody("Closes https://github.com/other/repo/issues/12", REPO)).toEqual([]);
    expect(closedInBody("See #12. Encloses #4.", REPO)).toEqual([]);
  });
  test("references inside HTML comments and fenced code blocks do not count", () => {
    expect(closedInBody("<!-- Closes #12 -->\nCloses #", REPO)).toEqual([]);
    expect(closedInBody("<!--\nBypass: Closes #12\n-->", REPO)).toEqual([]);
    expect(closedInBody("```sh\nCloses #12\n```\n~~~\nfixes #13\n~~~", REPO)).toEqual([]);
    expect(closedInBody("```\nCloses #12 (unclosed fence runs to the end)", REPO)).toEqual([]);
    expect(closedInBody("```\nCloses #12\n```\n<!-- x -->\nCloses #14", REPO)).toEqual([14]);
    expect(linkedIssues("<!-- see #40 -->\n```\n#41\n```", REPO, 9)).toEqual([]);
    expect(processCheck(pr({ body: "<!-- Closes #12 -->" })).ok).toBe(false);
  });
  test("links in an issue body leave out the issue itself", () => {
    expect(linkedIssues("norn cannot deliver this: #40, see also #41 and #9", REPO, 9)).toEqual([40, 41]);
    expect(linkedIssues(`blocked by https://github.com/${REPO}/issues/40`, REPO, 9)).toEqual([40]);
    expect(linkedIssues("only #9 here", REPO, 9)).toEqual([]);
  });
});

describe("(a) norn story branch", () => {
  test("passes when the PR closes the story's issue, from the body or from GitHub's list", () => {
    expect(processCheck(pr({ body: `Summary\n\n---\n\nCloses https://github.com/${REPO}/issues/12\n\nDelivered by norn (story gh-12).` })).ok).toBe(true);
    expect(processCheck(pr({ closing: [12] })).ok).toBe(true);
  });
  test("refuses when it closes another issue or none, and says to add Closes #N", () => {
    const v = processCheck(pr({ body: "Closes #13" }));
    expect(v).toMatchObject({ ok: false, do_instead: expect.stringContaining("Closes #12") });
    expect(processCheck(pr()).ok).toBe(false);
  });
  test("slice branches and look-alikes are not story branches", () => {
    for (const head of ["gh-12/03-add-form", "gh-12", "gh-012-x", "GH-12-x", "gh-12-Fix", "feature/gh-12-x", "gl-12-x"])
      expect(processCheck(pr({ head, closing: [12] })).ok).toBe(false);
  });
  test("refuses a story branch from a fork", () => {
    expect(processCheck(pr({ cross_repo: true, closing: [12] }))).toMatchObject({ ok: false, error: expect.stringContaining("fork") });
  });
});

describe("(b) bypass", () => {
  const bypass = (over: Partial<PrFacts> = {}) =>
    pr({
      head: "bypass/30-fix-release",
      labels: ["bypass"],
      body: "Closes #30",
      issues: { 30: { number: 30, labels: ["bypass"], body: "norn cannot open the PR because of #29." } },
      ...over,
    });
  test("passes: PR labelled bypass closes a bypass issue that links another issue", () => {
    expect(processCheck(bypass())).toMatchObject({ ok: true, reason: expect.stringContaining("#29") });
  });
  test("refuses without the PR label", () => {
    expect(processCheck(bypass({ labels: [] })).ok).toBe(false);
  });
  test("refuses when the closed issue lacks the label or links nothing", () => {
    expect(processCheck(bypass({ issues: { 30: { number: 30, labels: [], body: "see #29" } } })).ok).toBe(false);
    expect(processCheck(bypass({ issues: { 30: { number: 30, labels: ["bypass"], body: "no link, only #30" } } })).ok).toBe(false);
  });
  test("refuses when it closes no issue", () => {
    expect(processCheck(bypass({ body: "" }))).toMatchObject({ ok: false, error: "bypass PR closes no issue" });
  });
  test("refuses a bypass from a fork", () => {
    expect(processCheck(bypass({ cross_repo: true })).ok).toBe(false);
  });
});

describe("(c) Dependabot and everything else", () => {
  test("Dependabot passes whatever its branch", () => {
    expect(processCheck(pr({ author: "dependabot[bot]", head: "dependabot/bun/dev-dependencies-1" })).ok).toBe(true);
    expect(processCheck(pr({ author: "app/dependabot", head: "dependabot/github_actions/actions-2" })).ok).toBe(true);
  });
  test("any other branch is refused with what to do instead", () => {
    const v = processCheck(pr({ head: "release-0.9.1", body: "Closes #5" }));
    expect(v).toMatchObject({ ok: false, do_instead: expect.stringContaining("norn issue") });
  });
});

describe("gathering facts with gh", () => {
  const ghPr = (over: Record<string, unknown> = {}) => ({
    author: { login: "PruszynskiJakub" },
    headRefName: "bypass/30-fix-release",
    isCrossRepository: false,
    labels: [{ name: "bypass" }],
    body: "Closes #31",
    closingIssuesReferences: [],
    ...over,
  });
  const fail = (args: string[]): never => {
    throw new Error(`gh ${args.join(" ")}: HTTP 404`);
  };

  test("a PR gh cannot read is a refusal, not a crash", () => {
    expect(runCheck(REPO, 5, fail)).toMatchObject({ ok: false, error: expect.stringContaining("could not read PR #5"), do_instead: expect.stringContaining("Re-run") });
  });
  test("a closed number gh cannot read as an issue (e.g. the PR itself) is a refusal, not a crash", () => {
    const run = (args: string[]) => (args[0] === "pr" ? ghPr() : fail(args));
    expect(runCheck(REPO, 31, run)).toMatchObject({ ok: false, error: expect.stringContaining("#31") });
  });
  test("reads the bypass issue and passes; other repositories' closing references are ignored", () => {
    const run = (args: string[]) =>
      args[0] === "pr"
        ? ghPr({
            body: "",
            closingIssuesReferences: [
              { number: 30, repository: { name: "norn", owner: { login: "PruszynskiJakub" } } },
              { number: 7, repository: { name: "x", owner: { login: "other" } } },
            ],
          })
        : { labels: [{ name: "bypass" }], body: "norn cannot do it: #29" };
    expect(gatherFacts(REPO, 33, run).closing).toEqual([30]);
    expect(runCheck(REPO, 33, run)).toMatchObject({ ok: true });
  });
});
