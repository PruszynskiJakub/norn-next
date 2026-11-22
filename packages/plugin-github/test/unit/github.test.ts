/**
 * What the contract suites cannot see: the gh commands the plugin runs, how gh's failures map onto
 * PluginFailure codes, and the receipt marker that makes create, comment and open idempotent.
 */
import { describe, expect, test } from "bun:test";
import { failureOf, memoryHost, receiptId, scriptedExec, valueOf } from "@norn/conformance";
import { createTracker, type ExecOutput, type PluginFailureCode } from "@norn/plugin-api";
import { BRANCHES_PER_QUERY, changesQuery, classify, GH_TIMEOUT_MS, githubPlugin, githubTrackerFactory, receiptMarker, summarize } from "../../src/index.ts";
import { HEAD_SHA, LOGIN, NO_REPOSITORY, REPO, UNREACHABLE } from "./fake-gh.ts";
import { ROOT, rig } from "./world.ts";

const meta = (n: number) => ({ receipt_id: receiptId(n) });
const out = (stderr: string, code = 1, timedOut = false): ExecOutput => ({ code, stdout: "", stderr, timedOut });
const codeOf = (o: ExecOutput): PluginFailureCode => failureOf(classify(o, "gh x")).code;

describe("gh failures become PluginFailure codes", () => {
  test.each<[string, ExecOutput, PluginFailureCode, boolean]>([
    ["not logged in", out("To get started with GitHub CLI, please run:  gh auth login"), "auth", false],
    ["bad credentials", out("HTTP 401: Bad credentials (https://api.github.com/graphql)"), "auth", false],
    ["forbidden", out("HTTP 403: Resource not accessible by integration"), "auth", false],
    ["primary rate limit", out("HTTP 403: API rate limit exceeded for user ID 1."), "rate_limited", true],
    ["secondary rate limit", out("You have exceeded a secondary rate limit. Please wait a few minutes"), "rate_limited", true],
    ["missing issue", out("GraphQL: Could not resolve to an issue or pull request with the number of 9. (repository.issue)"), "not_found", false],
    ["missing or hidden repository", out("GraphQL: Could not resolve to a Repository with the name 'acme/nope'. (repository)"), "auth", false],
    ["no network", out(UNREACHABLE.stderr ?? ""), "unavailable", true],
    ["server error", out("HTTP 502: Bad Gateway (https://api.github.com/graphql)"), "unavailable", true],
    ["unknown label", out("could not add label: 'norn:wf:x' not found"), "invalid", false],
    ["label exists", out('label with name "norn" already exists; use `--force` to update its color and description'), "conflict", false],
    ["validation", out("HTTP 422: Validation Failed"), "invalid", false],
    ["anything else", out("something odd happened"), "unknown", false],
  ])("%s", (_, o, code, retryable) => {
    const f = failureOf(classify(o, "gh x"));
    expect({ code: f.code, retryable: f.retryable }).toEqual({ code, retryable });
  });

  test("a timeout is retryable unavailable; a missing gh is unavailable and not retryable", () => {
    expect(failureOf(classify(out("", 124, true), "gh x"))).toMatchObject({ code: "unavailable", retryable: true });
    expect(failureOf(classify(out("gh: command not found", 127), "gh x"))).toMatchObject({ code: "unavailable", retryable: false });
    expect(codeOf(out("", 1))).toBe("unknown");
  });
});

describe("how gh is run", () => {
  test("every call runs gh in the checkout, bounded, never prompting, on the configured repository", async () => {
    const { tracker, exec, gh } = rig();
    gh.seed([{ id: 1, title: "t", body: "", open: true, assignees: [LOGIN], labels: ["norn"] }]);
    await tracker.get(1);
    await tracker.intake({ label: "norn", assignee: "me" });
    for (const c of exec.calls) {
      expect(c.argv[0]).toBe("gh");
      expect(c.opts).toMatchObject({ cwd: ROOT, timeoutMs: GH_TIMEOUT_MS, env: { GH_PROMPT_DISABLED: "1", NO_COLOR: "1" } });
    }
    expect(exec.calls[0]?.argv.slice(-2)).toEqual(["-R", REPO]);
  });

  test("intake lists the repository's issues by label, never through GitHub's search, whose index lags a fresh issue", async () => {
    const { tracker, exec, gh } = rig();
    gh.seed([
      { id: 1, title: "mine", body: "", open: true, assignees: [LOGIN], labels: ["norn"] },
      { id: 2, title: "theirs", body: "", open: true, assignees: ["someone"], labels: ["norn"] },
      { id: 3, title: "unlabelled", body: "", open: true, assignees: [LOGIN], labels: [] },
    ]);
    expect(valueOf(await tracker.intake({ label: "norn", assignee: "me" })).map((i) => i.id)).toEqual([1]);
    expect(valueOf(await tracker.intake({ label: "norn", assignee: null })).map((i) => i.id).sort()).toEqual([1, 2]);
    expect(exec.calls.some((c) => c.argv[1] === "issue" && c.argv[2] === "list")).toBe(false);
    const listing = exec.calls.find((c) => c.argv[1] === "api" && c.argv[2] === "graphql");
    expect(listing?.argv.find((a) => a.startsWith("query="))).toContain("issues(");
    expect(listing?.argv.join(" ")).not.toContain("search(");
  });

  test("intake asks gh who `me` is once per tracker, not on every tick", async () => {
    const { tracker, exec, gh } = rig();
    gh.seed([{ id: 1, title: "mine", body: "", open: true, assignees: [LOGIN], labels: ["norn"] }]);
    for (let i = 0; i < 3; i++) expect(valueOf(await tracker.intake({ label: "norn", assignee: "me" })).map((x) => x.id)).toEqual([1]);
    expect(exec.calls.filter((c) => c.argv[1] === "api" && c.argv[2] === "user")).toHaveLength(1);
  });

  test("intake reads every page of the listing", async () => {
    const { tracker, gh } = rig();
    gh.seed(Array.from({ length: 130 }, (_, i) => ({ id: i + 1, title: `s${i + 1}`, body: "", open: true, assignees: [], labels: ["norn"] })));
    expect(valueOf(await tracker.intake({ label: "norn", assignee: null }))).toHaveLength(130);
  });

  test("without a configured repository gh is asked once, and a failed lookup is asked again", async () => {
    const { tracker, exec, gh } = rig({});
    gh.failing(true);
    expect(failureOf(await tracker.get(1)).code).toBe("unavailable");
    gh.failing(false);
    await tracker.get(1);
    await tracker.get(2);
    expect(exec.calls.filter((c) => c.argv[1] === "repo").length).toBe(2);
    expect(exec.calls.filter((c) => c.argv[1] === "issue").every((c) => c.argv.at(-1) === REPO)).toBe(true);
  });

  test("a bad config is refused when the tracker is made, before any call", () => {
    const exec = scriptedExec(() => undefined);
    const r = createTracker(githubTrackerFactory, memoryHost({ exec }), { repo: "not a repo" });
    expect(failureOf(r).code).toBe("invalid");
    expect(failureOf(createTracker(githubTrackerFactory, memoryHost({ exec }), { repo: "acme/app", extra: 1 })).code).toBe("invalid");
    expect(exec.calls).toEqual([]);
  });

  test("the plugin provides the github tracker and forge under plugin API 1.1", () => {
    expect(githubPlugin.name).toBe("norn-github");
    expect(githubPlugin.api).toBe("^1.1");
    expect(Object.keys(githubPlugin.provides.tracker ?? {})).toEqual(["github"]);
    expect(Object.keys(githubPlugin.provides.forge ?? {})).toEqual(["github"]);
  });
});

describe("answers gh gives that the plugin must not trust", () => {
  test("output that is not JSON, or JSON of the wrong shape, is an invalid failure, never a throw", async () => {
    const { tracker, gh } = rig();
    gh.override("issue view", { stdout: "<html>oops</html>" });
    expect(failureOf(await tracker.get(1))).toMatchObject({ code: "invalid", retryable: false });
    gh.override("api graphql", { stdout: JSON.stringify({ data: { repository: { issues: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [{ number: "one" }] } } } }) });
    expect(failureOf(await tracker.intake({ label: "norn", assignee: null })).code).toBe("invalid");
  });

  test("get answers null for a missing issue, but a failure for an issue gh could not look up", async () => {
    const { tracker, gh } = rig();
    expect(valueOf(await tracker.get(7))).toBeNull();
    gh.override("issue view", { code: 1, stderr: "HTTP 401: Bad credentials" });
    expect(failureOf(await tracker.get(7)).code).toBe("auth");
  });

  test("get against a repository that does not resolve is a failure, never an absent issue", async () => {
    const { tracker, gh } = rig();
    gh.seed([{ id: 7, title: "t", body: "", open: true, assignees: [], labels: [] }]);
    gh.override("issue view", NO_REPOSITORY);
    expect(failureOf(await tracker.get(7))).toMatchObject({ code: "auth", retryable: false });
    gh.override("issue view", { code: 1, stderr: "HTTP 404: Not Found (https://api.github.com/repos/acme/app)" });
    expect(failureOf(await tracker.get(7)).code).toBe("not_found");
  });

  test("intake drops a closed issue even if gh let one through", async () => {
    const { tracker, gh } = rig();
    gh.seed([{ id: 3, title: "closed", body: "", open: false, assignees: [], labels: ["norn"] }]);
    const closed = { number: 3, url: "u", title: "closed", body: "", state: "CLOSED", assignees: { nodes: [] }, labels: { nodes: [{ name: "norn" }] }, updatedAt: "2026-10-20T09:15:00Z" };
    gh.override("api graphql", { stdout: JSON.stringify({ data: { repository: { issues: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [closed] } } } }) });
    expect(valueOf(await tracker.intake({ label: "norn", assignee: null }))).toEqual([]);
  });
});

describe("the receipt marker", () => {
  test("create writes the marker into the body through stdin, and reading the issue strips it", async () => {
    const { tracker, exec, gh } = rig();
    const made = valueOf(await tracker.perform({ kind: "create", title: "Fix it", body: "Body text", labels: ["norn"] }, meta(1)));
    expect(made).toMatchObject({ kind: "create", id: 1, key: "gh-1", url: `https://github.com/${REPO}/issues/1`, replayed: false });
    const call = exec.calls.find((c) => c.argv[2] === "create");
    expect(call?.argv).toContain("--body-file");
    expect(call?.opts.input).toBe(`Body text\n\n${receiptMarker(receiptId(1))}`);
    expect(gh.issues[0]?.body).toContain(receiptMarker(receiptId(1)));
    expect(valueOf(await tracker.get(1))?.body).toBe("Body text");
  });

  test("a create whose answer was lost is found again by its marker, never made twice", async () => {
    const { tracker, gh } = rig();
    gh.override("issue create", { stdout: "" }, true);
    const lost = failureOf(await tracker.perform({ kind: "create", title: "Once", body: "", labels: [] }, meta(2)));
    expect(lost).toMatchObject({ code: "unknown", retryable: true });
    const again = valueOf(await tracker.perform({ kind: "create", title: "Once", body: "", labels: [] }, meta(2)));
    expect(again).toMatchObject({ id: 1, replayed: true });
    expect(gh.issues.length).toBe(1);
  });

  test("a receipt id that could break out of the marker is refused before any call", async () => {
    const { tracker, forge, exec } = rig();
    expect(failureOf(await tracker.perform({ kind: "comment", id: 1, body: "x" }, { receipt_id: "x --> <b>" })).code).toBe("invalid");
    expect(failureOf(await forge.perform({ kind: "ready", id: 1 }, { receipt_id: "" })).code).toBe("invalid");
    expect(exec.calls).toEqual([]);
  });

  test("an update of the body keeps the open's marker, so the open performed again still finds its pull request", async () => {
    const { forge, gh } = rig();
    const opened = valueOf(await forge.perform({ kind: "open", head: "gh-1-x", base: "main", title: "X", body: "first", draft: true }, meta(3)));
    valueOf(await forge.perform({ kind: "update", id: opened.change.id, body: "rewritten" }, meta(4)));
    expect(gh.prs[0]?.body).toBe(`rewritten\n\n${receiptMarker(receiptId(3))}`);
    const again = valueOf(await forge.perform({ kind: "open", head: "gh-1-x", base: "main", title: "X", body: "first", draft: true }, meta(3)));
    expect(again).toMatchObject({ replayed: true, change: { id: opened.change.id } });
    expect(gh.prs.length).toBe(1);
  });
});

describe("tracker effects", () => {
  test("labels never asks gh to remove a label the issue lacks, and skips the edit when nothing changes", async () => {
    const { tracker, exec, gh } = rig();
    gh.seed([{ id: 1, title: "t", body: "", open: true, assignees: [], labels: ["norn"] }]);
    valueOf(await tracker.perform({ kind: "labels", id: 1, add: ["norn:wf:story"], remove: ["never-defined", "norn"] }, meta(1)));
    const edit = exec.calls.find((c) => c.argv[2] === "edit");
    expect(edit?.argv).toEqual(["gh", "issue", "edit", "1", "--add-label", "norn:wf:story", "--remove-label", "norn", "-R", REPO]);
    const before = exec.calls.length;
    valueOf(await tracker.perform({ kind: "labels", id: 1, add: ["norn:wf:story"], remove: ["norn"] }, meta(2)));
    expect(exec.calls.slice(before).map((c) => c.argv[2])).toEqual(["view"]);
  });

  test("ensure_labels creates only the missing ones, matching names without case, and never restyles", async () => {
    const { tracker, exec, gh } = rig();
    gh.labels.push({ name: "Norn", color: "000000", description: "a person's choice" });
    valueOf(
      await tracker.perform(
        {
          kind: "ensure_labels",
          labels: [
            { name: "norn", color: "D93F0B", description: "pick me" },
            { name: "norn:wf:quick", color: "5319E7", description: "Make a small change" },
          ],
        },
        meta(1),
      ),
    );
    expect(exec.calls.filter((c) => c.argv[2] === "create").map((c) => c.argv[3])).toEqual(["norn:wf:quick"]);
    expect(gh.labels[0]).toEqual({ name: "Norn", color: "000000", description: "a person's choice" });
  });

  test("ensure_labels takes a label another writer made meanwhile as made", async () => {
    const { tracker, gh } = rig();
    gh.override("label create", { code: 1, stderr: 'label with name "norn" already exists; use `--force` to update its color and description' });
    expect(valueOf(await tracker.perform({ kind: "ensure_labels", labels: [{ name: "norn", color: "D93F0B", description: "" }] }, meta(1)))).toEqual({ kind: "ensure_labels", replayed: false });
  });

  test("a create with a label the repository lacks is refused as invalid", async () => {
    const { tracker, gh } = rig();
    gh.override("issue create", { code: 1, stderr: "could not add label: 'norn:wf:x' not found" });
    expect(failureOf(await tracker.perform({ kind: "create", title: "t", body: "", labels: ["norn:wf:x"] }, meta(1))).code).toBe("invalid");
  });
});

describe("forge reads", () => {
  test("checks folds gh's buckets and exit codes into one summary", async () => {
    expect(summarize([])).toBe("none");
    expect(summarize(["pass", "skipping"])).toBe("success");
    expect(summarize(["pass", "pending"])).toBe("pending");
    expect(summarize(["pending", "cancel"])).toBe("failure");
    const { forge, gh } = rig();
    expect(failureOf(await forge.checks(999)).code).toBe("not_found");
    gh.override("pr checks", { code: 1, stdout: "", stderr: "HTTP 401: Bad credentials" });
    expect(failureOf(await forge.checks(1)).code).toBe("auth");
  });

  test("checkReport names each failed check with its run's link, and asks mergeability only while the checks are unsettled", async () => {
    const { forge, gh, exec } = rig();
    gh.prs.push({ number: 7, head: "gh-1-a", base: "main", title: "t", body: "", draft: true, state: "OPEN", checks: "failure", mergeable: "CONFLICTING" });
    const report = (id: number) => (forge.checkReport ? forge.checkReport(id) : Promise.reject(new Error("no checkReport")));
    expect(valueOf(await report(7))).toEqual({ summary: "failure", failed: [{ name: "test", url: "https://github.com/acme/app/actions/runs/1/job/7" }] });
    expect(exec.calls.some((c) => c.argv.includes("mergeable"))).toBe(false);
    const p = gh.prs[0] as (typeof gh.prs)[number];
    p.checks = "pending";
    expect(valueOf(await report(7))).toEqual({ summary: "pending", failed: [], conflicts: true });
    // UNKNOWN is GitHub still computing: the report says nothing rather than guess
    p.mergeable = "UNKNOWN";
    expect(valueOf(await report(7))).toEqual({ summary: "pending", failed: [] });
  });

  test("findChanges asks about at most a query's worth of branches per call, and each branch once", async () => {
    const { forge, exec } = rig();
    const branches = Array.from({ length: BRANCHES_PER_QUERY + 3 }, (_, i) => `gh-${i + 1}-b`);
    const found = valueOf(await forge.findChanges([...branches, "gh-1-b"]));
    expect(Object.keys(found).length).toBe(branches.length);
    const queries = exec.calls.filter((c) => c.argv[1] === "api");
    expect(queries.length).toBe(2);
    expect(queries[0]?.argv).toContain("owner=acme");
    expect(queries[0]?.argv).toContain("name=app");
  });

  test("findChanges runs gh api without -R, which gh api refuses, and finds a branch's pull request", async () => {
    const { forge, exec } = rig();
    const { change } = valueOf(await forge.perform({ kind: "open", head: "gh-5-q", base: "main", title: "Q", body: "", draft: true }, meta(1)));
    expect(valueOf(await forge.findChanges(["gh-5-q"]))["gh-5-q"]).toMatchObject({ id: change.id, draft: true });
    const query = exec.calls.find((c) => c.argv[1] === "api");
    expect(query?.argv).not.toContain("-R");
  });

  test("a branch name with quotes cannot break the query", async () => {
    const q = changesQuery(['we"ird\\name']);
    expect(q).toContain(`headRefName: ${JSON.stringify('we"ird\\name')}`);
  });

  test("a merged pull request carries its merge commit; an open one has the head sha and no merge facts", async () => {
    const { forge, gh } = rig();
    const { change } = valueOf(await forge.perform({ kind: "open", head: "gh-2-y", base: "main", title: "Y", body: "", draft: false }, meta(1)));
    expect(change).toEqual({ id: 40, url: `https://github.com/${REPO}/pull/40`, state: "open", draft: false, head_branch: "gh-2-y", base_branch: "main", head_sha: HEAD_SHA, title: "Y" });
    Object.assign(gh.prs[0] ?? {}, { state: "MERGED", mergeSha: "f".repeat(40), mergedAt: "2026-11-01T00:00:00Z" });
    expect(valueOf(await forge.findChanges(["gh-2-y"]))["gh-2-y"]).toMatchObject({ state: "merged", merge_sha: "f".repeat(40), merged_at: "2026-11-01T00:00:00Z" });
  });

  test("fileUrl pins a commit's file to its full sha: blob ?raw=true for an image, the blob page for a link", async () => {
    const sha = "0123456789abcdef0123456789abcdef01234567";
    for (const config of [{ repo: REPO }, {}]) {
      const { forge } = rig(config);
      const url = (path: string, form: "image" | "link") => (forge.fileUrl ? forge.fileUrl(sha, path, form) : Promise.reject(new Error("no fileUrl")));
      expect(forge.capabilities.raw_urls).toBe(true);
      expect(valueOf(await url("AC1.webp", "image"))).toBe(`https://github.com/${REPO}/blob/${sha}/AC1.webp?raw=true`);
      expect(valueOf(await url("logs/AC2.log", "link"))).toBe(`https://github.com/${REPO}/blob/${sha}/logs/AC2.log`);
    }
  });

  test("fileUrl names only a full commit sha, never a ref name or a short sha", async () => {
    const { forge } = rig();
    const url = (commit: string) => (forge.fileUrl ? forge.fileUrl(commit, "AC1.webp", "image") : Promise.reject(new Error("no fileUrl")));
    for (const commit of ["main", "refs/norn/evidence/gh-1", "0123456", `${"a".repeat(39)}g`, ""]) expect(valueOf(await url(commit))).toBeNull();
    expect(valueOf(await url("A".repeat(40)))).toBe(`https://github.com/${REPO}/blob/${"a".repeat(40)}/AC1.webp?raw=true`);
    expect(valueOf(await url("b".repeat(64)))).toBe(`https://github.com/${REPO}/blob/${"b".repeat(64)}/AC1.webp?raw=true`);
  });

  test("fileUrl percent-encodes the path segment by segment, so the link opens the file", async () => {
    const { forge } = rig();
    const sha = "c".repeat(40);
    const url = (path: string) => (forge.fileUrl ? forge.fileUrl(sha, path, "link") : Promise.reject(new Error("no fileUrl")));
    expect(valueOf(await url("login page/AC 1 #2?.webp"))).toBe(`https://github.com/${REPO}/blob/${sha}/login%20page/AC%201%20%232%3F.webp`);
    expect(valueOf(await url("ünï/100%.log"))).toBe(`https://github.com/${REPO}/blob/${sha}/%C3%BCn%C3%AF/100%25.log`);
    for (const path of ["", "/AC1.webp", "a//b.log", "../AC1.webp", "./AC1.webp"]) expect(valueOf(await url(path))).toBeNull();
  });

  test("fileUrl gives null for a repository the forge cannot resolve, never a guessed URL", async () => {
    const { forge, gh } = rig({});
    gh.override("repo view", NO_REPOSITORY);
    const url = () => (forge.fileUrl ? forge.fileUrl("d".repeat(40), "AC1.webp", "image") : Promise.reject(new Error("no fileUrl")));
    expect(valueOf(await url())).toBeNull();
  });

  test("ready on a pull request that is not a draft changes nothing", async () => {
    const { forge, exec } = rig();
    const { change } = valueOf(await forge.perform({ kind: "open", head: "gh-3-z", base: "main", title: "Z", body: "", draft: false }, meta(1)));
    const before = exec.calls.length;
    expect(valueOf(await forge.perform({ kind: "ready", id: change.id }, meta(2))).change.draft).toBe(false);
    expect(exec.calls.slice(before).map((c) => `${c.argv[1]} ${c.argv[2]}`)).toEqual(["pr view"]);
  });
});
