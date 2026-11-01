/**
 * `norn story take <story>` (GR1, SPEC-cockpit CP4): assign an open issue that carries the intake label
 * to the person — the cockpit's backlog take — so the next sync takes it in. Nothing is taken in, and
 * nothing is written locally, by the verb itself.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { repoConfigPath } from "@norn/store";
import type { RemoteIssue } from "@norn/core";
import { createHarness, type Harness, T0 } from "../../../../test/support/harness.ts";

const CONFIG = `agents:
  claude: { adapter: claude }
runner: { adapter: headless }
remote: { provider: gh, label: norn }
default_workflow: fix
default_mode: auto
notifiers: []
`;

const issue = (number: number, over: Partial<RemoteIssue> = {}): RemoteIssue => ({
  provider: "gh",
  number,
  url: `https://github.com/o/r/issues/${number}`,
  title: `Issue ${number}`,
  body: "",
  state: "open",
  assignees: [],
  labels: ["norn"],
  updated_at: new Date(T0).toISOString(),
  ...over,
});

let h: Harness;

beforeAll(async () => {
  h = await createHarness();
  expect((await h.norn("init")).exit).toBe(0);
  h.write(repoConfigPath(h.root), CONFIG);
  h.git(["add", "-A"]);
  h.git(["commit", "-q", "-m", "norn init"]);
  h.git(["push", "-q", "origin", "main"]);
});
afterAll(() => h.cleanup());
beforeEach(() => {
  h.remote.calls = [];
  h.remote.issues = [issue(12), issue(13, { assignees: ["someone-else"] }), issue(14, { state: "closed" }), issue(15, { labels: ["other"] })];
});

describe("story take (GR1, CP4)", () => {
  test("assigns the issue to the person; the next sync takes it in", async () => {
    const r = await h.norn("story", "take", "gh-12");
    expect(r.exit).toBe(0);
    expect(r.stdout).toContain("gh-12");
    expect(r.stdout).toContain("norn sync");
    expect(h.remote.calls).toContain("assign 12 tester");
    expect(h.remote.issues.find((i) => i.number === 12)?.assignees).toEqual(["tester"]);
    // the verb takes nothing in itself
    expect(h.remote.calls.filter((c) => c.startsWith("list "))).toEqual([]);
    const sync = await h.norn("sync", "--json");
    expect(sync.exit).toBe(0);
    const stories = ((await h.norn("story", "list", "--json")).value as { stories: Array<{ key: string }> }).stories;
    expect(stories.map((s) => s.key)).toContain("gh-12");
  });

  test("an issue assigned to someone else gets the person added (--json)", async () => {
    const r = await h.norn("story", "take", "gh-13", "--json");
    expect(r.exit).toBe(0);
    expect(r.value).toMatchObject({ story: "gh-13", number: 13, assignee: "tester", url: "https://github.com/o/r/issues/13" });
    expect(h.remote.issues.find((i) => i.number === 13)?.assignees).toEqual(["someone-else", "tester"]);
  });

  test("refuses a closed, unlabelled, missing or already-taken-in issue, assigning nothing", async () => {
    const codes: Record<string, string> = { "gh-14": "issue_closed", "gh-15": "not_labelled", "gh-99": "no_issue", "gh-12": "taken_in" };
    for (const [key, code] of Object.entries(codes)) {
      const r = await h.norn("story", "take", key, "--json");
      expect([key, r.exit, (r.value as { code?: string }).code]).toEqual([key, 3, code]);
    }
    expect(h.remote.calls.filter((c) => c.startsWith("assign "))).toEqual([]);
  });

  test("a key of another provider, or none, is a usage error", async () => {
    expect((await h.norn("story", "take", "gl-12", "--json")).exit).toBe(2);
    expect((await h.norn("story", "take", "--json")).exit).toBe(2);
  });
});
