/** glab adapter against recorded CLI fixtures (X4, M4). */
import { describe, expect, test } from "bun:test";
import { fixtureExec, type Exec, type ExecFixture } from "../../src/git/exec.ts";
import calls from "./fixtures/calls.json";
import { createGlab, issueKey } from "../../src/glab/index.ts";
import { NETWORK_TIMEOUT_MS } from "@norn/store";

const stdins: Array<string | undefined> = [];
const timeouts: Array<number | undefined> = [];
const base = fixtureExec(calls as ExecFixture[]);
const exec: Exec = (argv, opts) => {
  stdins.push(opts?.stdin);
  timeouts.push(opts?.timeoutMs);
  return base(argv, opts);
};
const glab = createGlab({ cwd: "/repo", exec });

describe("glab adapter", () => {
  test("whoami", async () => {
    expect(await glab.whoami()).toBe("jpruszynski");
  });

  test("every glab call has the network timeout (H11)", async () => {
    timeouts.length = 0;
    await glab.whoami();
    expect(timeouts).toEqual([NETWORK_TIMEOUT_MS]);
  });

  test("listAssignedIssues maps to RemoteIssue (GR1)", async () => {
    const issues = await glab.listAssignedIssues({ label: "norn" });
    expect(issues.map((i) => issueKey(i.number))).toEqual(["gl-3", "gl-4"]);
    expect(issues[0]).toEqual({
      provider: "glab",
      number: 3,
      url: "https://gitlab.com/acme/app/-/issues/3",
      title: "Add login page",
      body: "As a user I want to log in.",
      state: "open",
      assignees: ["jpruszynski"],
      labels: ["norn"],
      updated_at: "2026-10-20T09:15:00.000Z",
    });
    expect(issues[1]?.body).toBe("");
  });

  test("getIssue: found, closed, missing", async () => {
    expect((await glab.getIssue(3))?.title).toBe("Add login page");
    expect(await glab.getIssue(2)).toMatchObject({ state: "closed", assignees: [] });
    expect(await glab.getIssue(999)).toBeNull();
  });

  test("findPullRequest picks the latest MR", async () => {
    expect(await glab.findPullRequest("gl-3-add-login-page")).toEqual({
      number: 8,
      url: "https://gitlab.com/acme/app/-/merge_requests/8",
      state: "merged",
      is_draft: false,
      head_sha: "d".repeat(40),
      merge_commit_sha: "f".repeat(40),
      merged_by: "jp",
      draft: false,
      head: "gl-3-add-login-page",
      base: "main",
      base_branch: "main",
      merged_at: "2026-10-22T08:00:00.000Z",
    });
    expect(await glab.findPullRequest("gl-99-none")).toBeNull();
  });

  test("openDraftPullRequest passes body on stdin", async () => {
    const mr = await glab.openDraftPullRequest({ head: "gl-4-fix-crash-on-save", base: "main", title: "Fix crash on save", body: "Closes #4" });
    expect(mr).toMatchObject({ number: 9, state: "open", is_draft: true, head_sha: "e".repeat(40), draft: true, head: "gl-4-fix-crash-on-save", merged_at: null });
    expect(stdins).toContain("Closes #4");
  });

  test("failures are typed PortErrors", async () => {
    const missing = createGlab({ cwd: "/repo", exec: async () => ({ code: 127, stdout: "", stderr: "ENOENT" }) });
    expect(await missing.whoami().catch((e) => e.code)).toBe("glab_missing");
    const net = createGlab({ cwd: "/repo", exec: async () => ({ code: 1, stdout: "", stderr: "dial tcp: lookup gitlab.com: Could not resolve host" }) });
    const err = await net.listAssignedIssues({ label: "norn" }).catch((e) => e);
    expect([err.code, err.retryable]).toEqual(["glab_network", true]);
  });
});
