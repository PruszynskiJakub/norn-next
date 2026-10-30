/**
 * `norn story create` (B18–B23, D3): the issue is created on the remote with the `norn` label (and
 * the workflow's), assigned to the person, and taken in at once by the same intake `sync` runs (GR1);
 * it is not started. A terminal is prompted for the title and the body; a script is refused. `--web`
 * opens the remote's new-issue page instead and creates nothing.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { acquireTickLock, repoConfigPath, workflowsDir } from "@norn/store";
import type { StoryView } from "@norn/view";
import type { CliDeps, CliResult } from "../src/index.ts";
import { createHarness, FakeInteraction, type Harness } from "./harness.ts";
import { runChecked } from "./harness.ts";

setDefaultTimeout(30_000);

const workflow = (name: string) => `name: ${name}
start: work
steps:
  work:
    type: agent
    skill: norn-implement
    outcomes: { done: $done }
`;

const CONFIG = `agents:
  claude: { adapter: claude }
runner: { adapter: headless }
remote: { provider: gh, label: norn }
default_workflow: fix
default_mode: auto
notifiers: []
`;

let h: Harness;
let shell: string[][];
/** `norn …` with these deps over the harness's, the outside shell recorded */
const norn = (deps: Partial<CliDeps>, ...argv: string[]): Promise<CliResult> =>
  runChecked(argv, { ...h.deps, shell: async (a) => (shell.push(a), { code: 0, stderr: "" }), ...deps });
const creates = () => h.remote.calls.filter((c) => c.startsWith("issue+ "));
const stories = async () => ((await h.norn("story", "list", "--json")).value as { stories: StoryView[] }).stories;
/** what the checkout has on disk: spec folders and worktrees */
const local = () => [join(h.root, ".agents/specs"), `${h.root}-worktrees`].flatMap((d) => (existsSync(d) ? readdirSync(d) : [])).sort();

beforeAll(async () => {
  h = await createHarness();
  expect((await h.norn("init")).exit).toBe(0);
  h.write(repoConfigPath(h.root), CONFIG);
  for (const name of ["fix", "spec"]) h.write(join(workflowsDir(h.root), `${name}.yaml`), workflow(name));
  h.git(["add", "-A"]);
  h.git(["commit", "-q", "-m", "norn init"]);
  h.git(["push", "-q", "origin", "main"]);
});
afterAll(() => h.cleanup());
beforeEach(() => {
  shell = [];
  h.remote.calls = [];
  h.remote.createError = null;
});

describe("with a title (B18)", () => {
  test("creates the labelled, assigned issue, takes it in and prints its key; nothing starts", async () => {
    const r = await norn({ interaction: null }, "story", "create", "--title", "Fix login timeout", "--workflow", "fix", "--body", "It times out after 5s.");
    expect(r.exit).toBe(0);
    const created = h.remote.issues.at(-1)!;
    const key = `gh-${created.number}`;
    expect(created).toMatchObject({ title: "Fix login timeout", body: "It times out after 5s.", labels: ["norn", "norn:wf:fix"], assignees: ["tester"] });
    expect(r.stdout).toContain(key);
    expect(h.remote.calls).toContain("list norn"); // the intake sync ran
    const story = (await stories()).find((s) => s.key === key);
    expect(story).toMatchObject({ story_status: "new", workflow: "fix", status: "not_started", step: null });
  });

  test("--json prints the story key and the issue", async () => {
    const r = await norn({}, "story", "create", "--title", "Second one", "--json");
    expect(r.exit).toBe(0);
    const created = h.remote.issues.at(-1)!;
    expect(r.value).toMatchObject({ story: `gh-${created.number}`, url: created.url, taken_in: true });
    expect(created.labels).toEqual(["norn"]); // no --workflow: the norn label only
    expect(created.body).toBe("");
  });

  test("--body-file sets the body", async () => {
    const file = join(h.dir, "body.md");
    h.write(file, "From a file.\n");
    expect((await norn({}, "story", "create", "--title", "From file", "--body-file", file)).exit).toBe(0);
    expect(h.remote.issues.at(-1)!.body).toBe("From a file.\n");
  });
});

describe("at a terminal without a title (B19)", () => {
  test("prompts for the title and opens the editor for the body", async () => {
    const term = new FakeInteraction();
    term.lines = ["Prompted title"];
    term.edited = ["Written in the editor.\n"];
    const r = await norn({ interaction: term }, "story", "create", "--workflow", "spec");
    expect(r.exit).toBe(0);
    expect(term.asks).toEqual(["Title:"]);
    expect(term.edits).toHaveLength(1);
    expect(h.remote.issues.at(-1)).toMatchObject({ title: "Prompted title", body: "Written in the editor.\n", labels: ["norn", "norn:wf:spec"] });
  });

  test("an empty title creates nothing (exit 2)", async () => {
    const term = new FakeInteraction();
    term.lines = ["   "];
    const r = await norn({ interaction: term }, "story", "create");
    expect(r.exit).toBe(2);
    expect(term.edits).toEqual([]);
    expect(creates()).toEqual([]);
  });
});

describe("a script without a title (B20)", () => {
  test("--json or no TTY is a usage error naming --title; nothing is prompted", async () => {
    for (const [deps, flags] of [[{ interaction: new FakeInteraction() }, ["--json"]], [{ interaction: null }, []], [{ interaction: new FakeInteraction(false) }, []]] as const) {
      const r = await norn(deps, "story", "create", ...flags);
      expect(r.exit).toBe(2);
      expect(r.stdout).toContain("--title");
      if (deps.interaction) expect(deps.interaction.asks).toEqual([]);
    }
    expect(((await norn({}, "story", "create", "--json")).value as { do_instead: string }).do_instead).toContain("--title");
    expect(creates()).toEqual([]);
  });
});

describe("an unknown workflow (B21)", () => {
  test("is refused before anything is created, listing the workflows", async () => {
    const r = await norn({}, "story", "create", "--title", "Nope", "--workflow", "nope", "--json");
    expect(r.exit).toBe(3);
    expect(r.value).toMatchObject({ code: "unknown_workflow", error: expect.stringContaining("nope") });
    const body = r.value as { error: string; do_instead: string };
    for (const name of ["fix", "spec"]) expect(`${body.error} ${body.do_instead}`).toContain(name);
    expect(h.remote.calls).toEqual([]);
  });
});

describe("the remote failing (B22)", () => {
  test("names the failure, points at norn doctor and leaves nothing locally", async () => {
    const before = local();
    const head = h.git(["rev-parse", "HEAD"]);
    h.remote.createError = new Error("HTTP 401: Bad credentials");
    const r = await norn({}, "story", "create", "--title", "Never made", "--json");
    expect(r.exit).not.toBe(0);
    expect(r.value).toMatchObject({ error: expect.stringContaining("HTTP 401: Bad credentials"), do_instead: "norn doctor" });
    expect(h.remote.calls).not.toContain("list norn"); // no intake ran
    expect(local()).toEqual(before);
    expect(h.git(["rev-parse", "HEAD"])).toBe(head);
    expect((await stories()).map((s) => s.title)).not.toContain("Never made");
  });
});

describe("the intake failing after the issue exists (B22)", () => {
  test("prints the created story with exit 0 and points at norn sync, never at a second create", async () => {
    const lock = await acquireTickLock(h.root, { note: "watch" }); // a running `norn watch` holds it
    if (!lock.ok) throw new Error("tick lock not taken");
    try {
      const r = await norn({}, "story", "create", "--title", "Made while watch ticks", "--json");
      expect(r.exit).toBe(0);
      const created = h.remote.issues.at(-1)!;
      expect(creates()).toHaveLength(1);
      expect(r.value).toMatchObject({ story: `gh-${created.number}`, url: created.url, taken_in: false, do_instead: "norn sync" });
      expect((r.value as { intake_error: string }).intake_error).toContain("another tick is running");
      const md = await norn({}, "story", "create", "--title", "Made while watch ticks, markdown");
      expect(md.exit).toBe(0);
      expect(md.stdout).toContain(`gh-${h.remote.issues.at(-1)!.number}`);
      expect(md.stdout).toContain("norn sync");
      expect(md.stdout).not.toContain("took it in");
    } finally {
      lock.release();
    }
  });
});

describe("--web (B23)", () => {
  test("opens the remote's new-issue page with the norn and workflow labels; creates nothing", async () => {
    const r = await norn({}, "story", "create", "--web", "--workflow", "spec");
    expect(r.exit).toBe(0);
    expect(shell).toHaveLength(1);
    const [opener, url] = shell[0]!;
    expect(opener).toBe(process.platform === "darwin" ? "open" : "xdg-open");
    expect(decodeURIComponent(url!)).toBe("https://github.com/o/r/issues/new?labels=norn,norn:wf:spec");
    expect(creates()).toEqual([]);
  });

  test("an unknown workflow is refused before the page opens", async () => {
    const r = await norn({}, "story", "create", "--web", "--workflow", "nope");
    expect(r.exit).toBe(3);
    expect(shell).toEqual([]);
  });
});
