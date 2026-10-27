/**
 * RemotePort contract (ports.ts; GR1, GR6): what observe and act may assume of the issue provider —
 * the gh and glab adapters (over a scripted CLI, offline) and the harness's FakeRemote. `seed`
 * installs the world: the issues on the remote, assigned by login (`whoami()` is the user).
 */
import { describe, expect } from "bun:test";
import type { RemoteIssue, RemotePort, RemotePullRequest } from "@norn/core";
import { type ContractOptions, contractTest } from "./suite.ts";

export type RemoteContractTest =
  | "provider and whoami"
  | "listAssignedIssues: open issues assigned to the user with the label, nothing else (GR1)"
  | "getIssue: the listed issue, closed ones too; null when missing"
  | "findPullRequest: null for a branch without one"
  | "openDraftPullRequest opens a draft the branch then finds (GR6)"
  | "findPullRequest picks the newest of a branch's PRs";

export interface SeedIssue {
  number: number;
  title: string;
  body: string;
  state: "open" | "closed";
  assignees: string[];
  labels: string[];
}

export interface RemoteSubject {
  port: RemotePort;
  seed(issues: SeedIssue[]): void;
}

/** The world every RemotePort is checked against; `me` is the port's `whoami()`. */
export function world(me: string): SeedIssue[] {
  return [
    { number: 1, title: "Add login", body: "As a user I want to log in.", state: "open", assignees: [me], labels: ["norn", "auth"] },
    { number: 2, title: "Not ours to pick", body: "", state: "open", assignees: [me], labels: ["other"] },
    { number: 3, title: "Closed one", body: "", state: "closed", assignees: [me], labels: ["norn"] },
    { number: 4, title: "Someone else's", body: "", state: "open", assignees: ["someone-else"], labels: ["norn"] },
  ];
}

function expectIssueShape(i: RemoteIssue, provider: string): void {
  expect(i.provider).toBe(provider as RemoteIssue["provider"]);
  expect(Number.isInteger(i.number)).toBe(true);
  expect(typeof i.url).toBe("string");
  expect(typeof i.title).toBe("string");
  expect(typeof i.body).toBe("string");
  expect(["open", "closed"]).toContain(i.state);
  expect(Array.isArray(i.assignees) && Array.isArray(i.labels)).toBe(true);
  expect(Number.isNaN(Date.parse(i.updated_at))).toBe(false);
}

function expectPrShape(p: RemotePullRequest): void {
  expect(Number.isInteger(p.number)).toBe(true);
  expect(typeof p.url).toBe("string");
  expect(["open", "closed", "merged"]).toContain(p.state);
  expect(typeof p.is_draft).toBe("boolean");
  expect(typeof p.head_sha).toBe("string");
}

export function remoteContract(name: string, make: () => RemoteSubject, opts: ContractOptions<RemoteContractTest> = {}): void {
  describe(`RemotePort contract: ${name}`, () => {
    const t = (n: RemoteContractTest, fn: () => Promise<void>) => contractTest(opts, n, fn);
    const seeded = async () => {
      const s = make();
      const me = await s.port.whoami();
      s.seed(world(me));
      return { ...s, me };
    };

    t("provider and whoami", async () => {
      const { port, me } = await seeded();
      expect(["gh", "glab"]).toContain(port.provider);
      expect(me.length).toBeGreaterThan(0);
    });

    t("listAssignedIssues: open issues assigned to the user with the label, nothing else (GR1)", async () => {
      const { port, me } = await seeded();
      const issues = await port.listAssignedIssues({ label: "norn" });
      expect(issues.map((i) => i.number)).toEqual([1]);
      expectIssueShape(issues[0]!, port.provider);
      expect(issues[0]).toMatchObject({ title: "Add login", body: "As a user I want to log in.", state: "open", assignees: [me], labels: ["norn", "auth"] });
      expect(await port.listAssignedIssues({ label: "no-such-label" })).toEqual([]);
    });

    t("getIssue: the listed issue, closed ones too; null when missing", async () => {
      const { port } = await seeded();
      const [listed] = await port.listAssignedIssues({ label: "norn" });
      expect(await port.getIssue(1)).toEqual(listed!);
      const closed = await port.getIssue(3);
      expectIssueShape(closed!, port.provider);
      expect(closed!.state).toBe("closed");
      expect(await port.getIssue(999)).toBeNull();
    });

    t("findPullRequest: null for a branch without one", async () => {
      const { port } = await seeded();
      expect(await port.findPullRequest("gh-1-no-pr-here")).toBeNull();
    });

    t("openDraftPullRequest opens a draft the branch then finds (GR6)", async () => {
      const { port } = await seeded();
      const pr = await port.openDraftPullRequest({ head: "gh-1-add-login", base: "main", title: "Add login", body: "Closes #1" });
      expectPrShape(pr);
      expect(pr).toMatchObject({ state: "open", is_draft: true, head: "gh-1-add-login", base_branch: "main" });
      expect(pr.merged_at ?? null).toBeNull();
      const found = await port.findPullRequest("gh-1-add-login");
      expectPrShape(found!);
      expect(found).toMatchObject({ number: pr.number, url: pr.url, state: "open", is_draft: true, base_branch: "main" });
    });

    t("findPullRequest picks the newest of a branch's PRs", async () => {
      const { port } = await seeded();
      await port.openDraftPullRequest({ head: "gh-1-add-login", base: "main", title: "first", body: "" });
      const second = await port.openDraftPullRequest({ head: "gh-1-add-login", base: "main", title: "second", body: "" });
      expect((await port.findPullRequest("gh-1-add-login"))?.number).toBe(second.number);
    });
  });
}
