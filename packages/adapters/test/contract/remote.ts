/**
 * RemotePort contract (ports.ts; GR1, GR6): what observe and act may assume of the issue provider —
 * the gh and glab adapters (over a scripted CLI, offline) and the harness's FakeRemote. `seed`
 * installs the world: the issues on the remote, assigned by login (`whoami()` is the user).
 */
import { describe, expect } from "bun:test";
import type { PortError, RemoteIssue, RemoteLabel, RemotePort, RemotePullRequest } from "@norn/core";
import { type ContractOptions, contractTest } from "./suite.ts";

export type RemoteContractTest =
  | "provider and whoami"
  | "listAssignedIssues: open issues assigned to the user with the label, nothing else (GR1)"
  | "getIssue: the listed issue, closed ones too; null when missing"
  | "findPullRequest: null for a branch without one"
  | "openDraftPullRequest opens a draft the branch then finds (GR6)"
  | "findPullRequest picks the newest of a branch's PRs"
  | "createIssue opens an issue with the labels and assignee, which intake then lists (B18)"
  | "newIssueUrl: the remote's new-issue page with the labels filled in (B23)"
  | "rawFileUrl: a commit's file served raw, its path segments encoded (gh-195 B28)"
  | "replaceIssueLabel swaps one label for another (B19)"
  | "replaceIssueLabel adds the new label when the old one is not on the issue (B19)"
  | "replaceIssueLabel rejects with a PortError when the provider fails, changing nothing (B20)"
  | "listLabelledIssues: open issues with the label, whoever they are assigned to (GR1, CP2)"
  | "assignIssue adds the assignee, and intake then lists the issue (GR1)"
  | "listLabels: the repository's labels with colour and description (GR10)"
  | "createLabel defines a label that listLabels then lists, leaving the others alone (GR10)"
  | "createLabel rejects a name already taken with an _exists PortError, editing nothing (GR10)"
  | "listLabels and createLabel reject with a PortError when the provider fails (GR10)";

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
  /** from now on, the provider fails every label edit (B20), label listings and creations included (GR10) */
  failLabelEdits(): void;
  /** the labels defined on the repository (GR10), replacing any seeded before */
  seedLabels(labels: RemoteLabel[]): void;
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

    t("createIssue opens an issue with the labels and assignee, which intake then lists (B18)", async () => {
      const { port, me } = await seeded();
      const created = await port.createIssue({ title: "Fix login timeout", body: "It times out.", labels: ["norn", "norn:wf:fix"], assignee: me });
      expectIssueShape(created, port.provider);
      expect(created).toMatchObject({ title: "Fix login timeout", body: "It times out.", state: "open", assignees: [me], labels: ["norn", "norn:wf:fix"] });
      expect([1, 2, 3, 4]).not.toContain(created.number);
      expect(await port.getIssue(created.number)).toEqual(created);
      expect((await port.listAssignedIssues({ label: "norn" })).map((i) => i.number)).toEqual([1, created.number]);
    });

    t("newIssueUrl: the remote's new-issue page with the labels filled in (B23)", async () => {
      const { port } = await seeded();
      const url = await port.newIssueUrl({ labels: ["norn", "norn:wf:spec"] });
      expect(url).toStartWith("https://");
      const page = decodeURIComponent(url.replace(/\+/g, " "));
      expect(page).toContain("issues/new");
      expect(page).toContain("norn:wf:spec");
      expect(page).toMatch(/\bnorn\b(?!:)/);
      expect((await port.listAssignedIssues({ label: "norn" })).map((i) => i.number)).toEqual([1]); // nothing created
    });

    t("rawFileUrl: a commit's file served raw, its path segments encoded (gh-195 B28)", async () => {
      const { port } = await seeded();
      const commit = "0123456789abcdef0123456789abcdef01234567";
      const url = await port.rawFileUrl({ commit, path: "_story/rounds/01-story/evidence/01ABC/after shot.png" });
      expect(url).toStartWith("https://");
      expect(url).toContain(`/${commit}/_story/rounds/01-story/evidence/01ABC/after%20shot.png`);
      expect(url).toMatch(port.provider === "gh" ? /\/blob\/[0-9a-f]{40}\/.*\?raw=true$/ : /\/-\/raw\/[0-9a-f]{40}\/[^?]*$/);
      expect((await port.listAssignedIssues({ label: "norn" })).map((i) => i.number)).toEqual([1]); // nothing created
    });

    t("listLabelledIssues: open issues with the label, whoever they are assigned to (GR1, CP2)", async () => {
      const { port, seed, me } = await seeded();
      seed([...world(me), { number: 6, title: "Nobody's yet", body: "", state: "open", assignees: [], labels: ["norn"] }]);
      const issues = await port.listLabelledIssues({ label: "norn" });
      expect(issues.map((i) => i.number).sort((a, b) => a - b)).toEqual([1, 4, 6]);
      for (const i of issues) expectIssueShape(i, port.provider);
      expect(issues.find((i) => i.number === 4)).toMatchObject({ title: "Someone else's", assignees: ["someone-else"], labels: ["norn"] });
      expect(issues.find((i) => i.number === 6)?.assignees).toEqual([]);
      expect(await port.listLabelledIssues({ label: "no-such-label" })).toEqual([]);
    });

    t("assignIssue adds the assignee, and intake then lists the issue (GR1)", async () => {
      const { port, seed, me } = await seeded();
      seed([...world(me), { number: 6, title: "Nobody's yet", body: "", state: "open", assignees: [], labels: ["norn"] }]);
      await port.assignIssue(6, me);
      await port.assignIssue(4, me);
      expect((await port.getIssue(6))!.assignees).toEqual([me]);
      expect([...(await port.getIssue(4))!.assignees].sort()).toEqual([me, "someone-else"].sort());
      expect((await port.listAssignedIssues({ label: "norn" })).map((i) => i.number).sort((a, b) => a - b)).toEqual([1, 4, 6]);
    });

    const defined: RemoteLabel[] = [
      { name: "norn", color: "D93F0B", description: "pick me" },
      { name: "auth", color: "EDEDED", description: "" },
    ];

    t("listLabels: the repository's labels with colour and description (GR10)", async () => {
      const { port, seedLabels } = await seeded();
      seedLabels(defined);
      const labels = await port.listLabels();
      expect([...labels].sort((a, b) => a.name.localeCompare(b.name))).toEqual([...defined].sort((a, b) => a.name.localeCompare(b.name)));
    });

    t("createLabel defines a label that listLabels then lists, leaving the others alone (GR10)", async () => {
      const { port, seedLabels } = await seeded();
      seedLabels(defined);
      await port.createLabel({ name: "norn:wf:quick", color: "5319E7", description: "Make a small change" });
      const labels = await port.listLabels();
      expect(labels.find((l) => l.name === "norn:wf:quick")).toEqual({ name: "norn:wf:quick", color: "5319E7", description: "Make a small change" });
      expect(labels.find((l) => l.name === "norn")).toEqual(defined[0]!);
      expect(labels).toHaveLength(3);
    });

    t("createLabel rejects a name already taken with an _exists PortError, editing nothing (GR10)", async () => {
      const { port, seedLabels } = await seeded();
      seedLabels(defined);
      const err = await port.createLabel({ name: "norn", color: "5319E7", description: "other" }).then(
        () => null,
        (e: unknown) => e,
      );
      expect((err as PortError).code).toEndWith("_exists");
      expect((await port.listLabels()).find((l) => l.name === "norn")).toEqual(defined[0]!);
    });

    t("listLabels and createLabel reject with a PortError when the provider fails (GR10)", async () => {
      const { port, seedLabels, failLabelEdits } = await seeded();
      seedLabels(defined);
      failLabelEdits();
      for (const call of [() => port.listLabels(), () => port.createLabel({ name: "x", color: "5319E7", description: "" })]) {
        const err = await call().then(
          () => null,
          (e: unknown) => e,
        );
        expect(err).toBeInstanceOf(Error);
        expect(typeof (err as PortError).code).toBe("string");
      }
    });

    const triaged = (me: string): SeedIssue => ({ number: 5, title: "Triaged", body: "", state: "open", assignees: [me], labels: ["norn", "norn:wf:triage"] });

    t("replaceIssueLabel swaps one label for another (B19)", async () => {
      const { port, seed, me } = await seeded();
      seed([...world(me), triaged(me)]);
      await port.replaceIssueLabel(5, { remove: "norn:wf:triage", add: "norn:wf:story" });
      const labels = (await port.getIssue(5))!.labels;
      expect(labels).toContain("norn:wf:story");
      expect(labels).not.toContain("norn:wf:triage");
      expect(labels).toContain("norn");
    });

    t("replaceIssueLabel adds the new label when the old one is not on the issue (B19)", async () => {
      const { port } = await seeded();
      await port.replaceIssueLabel(1, { remove: "norn:wf:triage", add: "norn:wf:story" });
      expect([...(await port.getIssue(1))!.labels].sort()).toEqual(["auth", "norn", "norn:wf:story"]);
    });

    t("replaceIssueLabel rejects with a PortError when the provider fails, changing nothing (B20)", async () => {
      const { port, seed, failLabelEdits, me } = await seeded();
      seed([...world(me), triaged(me)]);
      failLabelEdits();
      const err = await port.replaceIssueLabel(5, { remove: "norn:wf:triage", add: "norn:wf:story" }).then(
        () => null,
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(Error);
      expect(typeof (err as PortError).code).toBe("string");
      expect(typeof (err as PortError).retryable).toBe("boolean");
      expect((await port.getIssue(5))!.labels).toEqual(["norn", "norn:wf:triage"]);
    });
  });
}
