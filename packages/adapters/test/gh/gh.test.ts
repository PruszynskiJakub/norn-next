/** gh adapter against recorded CLI fixtures (X4). */
import { describe, expect, test } from "bun:test";
import { fixtureExec, type ExecFixture } from "../../src/git/exec.ts";
import calls from "./fixtures/calls.json";
import { createGh, issueKey } from "../../src/gh/index.ts";

const gh = createGh({ cwd: "/repo", exec: fixtureExec(calls as ExecFixture[]) });

describe("gh adapter", () => {
  test("whoami", async () => {
    expect(await gh.whoami()).toBe("jpruszynski");
  });

  test("listAssignedIssues maps to RemoteIssue (GR1)", async () => {
    const issues = await gh.listAssignedIssues({ label: "norn" });
    expect(issues.map((i) => issueKey(i.number))).toEqual(["gh-12", "gh-15"]);
    expect(issues[0]).toEqual({
      provider: "gh",
      number: 12,
      url: "https://github.com/acme/app/issues/12",
      title: "Add login page",
      body: "As a user I want to log in.\n\n- [ ] email\n",
      state: "open",
      assignees: ["jpruszynski"],
      labels: ["norn", "auth"],
      updated_at: "2026-10-20T09:15:00Z",
    });
  });

  test("getIssue: found, closed, missing", async () => {
    expect((await gh.getIssue(12))?.title).toBe("Add login page");
    expect(await gh.getIssue(9)).toMatchObject({ state: "closed", assignees: [] });
    expect(await gh.getIssue(999)).toBeNull();
  });

  test("findPullRequest", async () => {
    expect(await gh.findPullRequest("gh-12-add-login-page")).toEqual({
      number: 40,
      url: "https://github.com/acme/app/pull/40",
      state: "merged",
      is_draft: false,
      head_sha: "a".repeat(40),
      merge_commit_sha: "b".repeat(40),
      merged_by: "jpruszynski",
      draft: false,
      head: "gh-12-add-login-page",
      base: "main",
      base_branch: "main",
      merged_at: "2026-10-22T08:00:00Z",
    });
    expect(await gh.findPullRequest("gh-99-none")).toBeNull();
  });

  test("openDraftPullRequest", async () => {
    const pr = await gh.openDraftPullRequest({ head: "gh-15-fix-crash-on-save", base: "main", title: "Fix crash on save", body: "Closes #15" });
    expect(pr).toMatchObject({ number: 41, state: "open", is_draft: true, head_sha: "c".repeat(40), draft: true, head: "gh-15-fix-crash-on-save", base: "main", merged_at: null });
  });

  test("failures are typed PortErrors", async () => {
    const missing = createGh({ cwd: "/repo", exec: async () => ({ code: 127, stdout: "", stderr: "ENOENT" }) });
    expect(await missing.whoami().catch((e) => e.code)).toBe("gh_missing");
    const auth = createGh({ cwd: "/repo", exec: async () => ({ code: 4, stdout: "", stderr: "To get started with GitHub CLI, please run:  gh auth login" }) });
    expect(await auth.listAssignedIssues({ label: "norn" }).catch((e) => e.code)).toBe("gh_auth");
    const junk = createGh({ cwd: "/repo", exec: async () => ({ code: 0, stdout: "not json", stderr: "" }) });
    expect(await junk.findPullRequest("x").catch((e) => e.code)).toBe("gh_bad_output");
  });
});
