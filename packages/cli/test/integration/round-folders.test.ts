/**
 * gh-71 B30, B31, B34 (D2, D7): the story's record lives in `runs/_story/rounds/01-<workflow>/`, with one
 * `runs/_story/handoff.md` above it; a story whose record is still flat (an older norn) is moved there by
 * its holder's first tick, in one commit with `git mv`, pushed, and goes on where it was.
 */
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { repoConfigPath, workflowsDir } from "@norn/store";
import type { CliResult } from "../../src/index.ts";
import { createHarness, type Harness, issue, runChecked } from "../../../../test/support/harness.ts";

setDefaultTimeout(30_000);

const DUO = `name: duo
start: implement
steps:
  implement:
    type: agent
    skill: norn-implement
    outcomes: { done: { to: review, means: "every criterion has a passing test" } }
  review:
    type: agent
    skill: norn-review
    outcomes:
      approve: { to: $done, means: "no blocking findings" }
      changes_requested: { to: implement, counter: review_loop, means: "blocking findings" }
counters: { review_loop: { max: 3 } }
`;
const CONFIG = `agents:
  claude: { adapter: claude }
remote: { provider: gh, label: norn }
default_workflow: duo
default_mode: manual
notifiers: []
`;

let h: Harness;
const BRANCH = "gh-9-round-thing";
const spec = `.agents/specs/${BRANCH}`;
const wt = () => `${h.root}-worktrees/${BRANCH}`;
const story = () => join(wt(), spec, "runs", "_story");
const round1 = () => join(story(), "rounds", "01-duo");
const inWt = (...argv: string[]): Promise<CliResult> => {
  const env: Record<string, string | undefined> = { ...h.deps.env, NORN_AGENT_PID: String(process.pid) };
  for (const k of ["NORN_AGENT", "NORN_RUN", "NORN_STORY", "NORN_SLICE", "NORN_AGENT_SESSION_ID"]) delete env[k];
  return runChecked(argv, { ...h.deps, cwd: wt(), env });
};
const ls = (dir: string) => (existsSync(dir) ? readdirSync(dir).sort() : []);
const git = (...args: string[]) => h.git(["-C", wt(), ...args]).trim();
async function tickUntil(pred: () => boolean, max = 10) {
  for (let i = 0; i < max && !pred(); i++) {
    h.clock.advance(10_000);
    await h.tick();
  }
  expect(pred()).toBe(true);
}

beforeAll(async () => {
  h = await createHarness();
  expect((await h.norn("init")).exit).toBe(0);
  h.write(repoConfigPath(h.root), CONFIG);
  h.write(join(workflowsDir(h.root), "duo.yaml"), DUO);
  h.git(["add", "-A"]);
  h.git(["commit", "-q", "-m", "norn init"]);
  h.git(["push", "-q", "origin", "main"]);
  h.remote.issues = [issue(9, "Round thing")];
});
afterAll(() => h.cleanup());

describe("a new story's record is round 1 (B30, B31)", () => {
  let runId = "";

  test("AC1: state, pinned workflow, receipts from 0001 and evidence sit in rounds/01-duo/; only handoff.md and rounds/ under runs/_story", async () => {
    await tickUntil(() => h.state(round1())?.step === "implement");
    const brief = await inWt("brief", "--json");
    expect(brief.exit).toBe(0);
    runId = (brief.value as { run_id: string }).run_id;
    expect((brief.value as { brief: { inputs: Array<{ kind: string; ref: string }> } }).brief.inputs).toContainEqual(expect.objectContaining({ ref: `${spec}/runs/_story/handoff.md` }));
    const ev = join(h.root, "..", "ev-ac1");
    mkdirSync(ev, { recursive: true });
    writeFileSync(join(ev, "AC1.md"), "seen\n");
    expect((await inWt("done", "done", "--handoff", "built it", "--evidence", ev)).exit).toBe(0);
    await tickUntil(() => h.state(round1())?.step === "review");

    expect(ls(story())).toEqual(["handoff.md", "rounds"]);
    expect(ls(join(story(), "rounds"))).toEqual(["01-duo"]);
    expect(ls(round1())).toEqual(["evidence", "receipts", "state.json", "workflow.yaml"]);
    expect(ls(join(round1(), "receipts"))[0]).toStartWith("0001-");
    expect(ls(join(round1(), "evidence", runId))).toEqual(["AC1.md"]);
    expect(h.state(round1())).toMatchObject({ workflow: "duo", step: "review" });
    // the pushed record has the same shape
    expect(git("ls-tree", "--name-only", `origin/${BRANCH}:${spec}/runs/_story`).split("\n")).toEqual(["handoff.md", "rounds"]);
  });

  test("AC2: the handoff is runs/_story/handoff.md, and its Goal / Progress / Resume survive the step's report", async () => {
    const file = join(story(), "handoff.md");
    const before = h.read(file);
    const body = before.replace(/## Goal\n[\s\S]*$/, "## Goal\nShip the round thing.\n\n## Progress\n- first milestone\n\n## Resume\nRun the review.\n");
    h.write(file, body);
    expect((await inWt("brief", "--json")).exit).toBe(0);
    expect((await inWt("done", "changes_requested", "--handoff", "one blocker", "--findings", writeFindings())).exit).toBe(0);
    await tickUntil(() => h.state(round1())?.step === "implement");
    const after = h.read(file);
    expect(after).toContain("## Goal\nShip the round thing.");
    expect(after).toContain("- first milestone");
    expect(after).toContain("- review#1 changes_requested: one blocker");
    expect(after).toContain("## Resume\nRun the review.");
    expect(existsSync(join(round1(), "handoff.md"))).toBe(false);
  });
});

function writeFindings(): string {
  const f = join(h.root, "..", "findings-ac2.json");
  writeFileSync(f, JSON.stringify([{ id: "F1", severity: "blocking", title: "missing test", detail: "AC1 has no test", file: "src/x.ts", line: 1 }]));
  return f;
}

describe("a flat record from an older norn moves into round 1 (B34)", () => {
  let flatHead = "";
  let flatState: unknown;

  test("setup: the story's record laid out flat, as an older norn wrote it, committed and pushed", () => {
    for (const name of ls(round1())) git("mv", join(round1(), name), join(story(), name));
    rmSync(join(story(), "rounds"), { recursive: true, force: true });
    git("commit", "-q", "-m", "older norn: flat record");
    git("push", "-q", "origin", BRANCH);
    flatHead = git("rev-parse", "HEAD");
    flatState = h.state(story());
    expect(flatState).toMatchObject({ step: "implement", counters: { review_loop: 1 } });
    expect(ls(story())).toEqual(["evidence", "handoff.md", "receipts", "state.json", "workflow.yaml"]);
  });

  test("AC3: the first tick moves everything but handoff.md into rounds/01-duo/ with git mv, in one pushed commit; the story goes on at its step", async () => {
    h.clock.advance(10_000);
    const r = await h.tick();
    const mine = r.decisions.filter((d) => d.unit === "gh-9" && d.rule !== "claim.renew");
    expect(mine.map((d) => d.rule)).toEqual(["round.migrate"]);

    expect(git("rev-list", "--count", `${flatHead}..HEAD`)).toBe("1");
    expect(git("log", "-1", "--format=%s")).toBe("norn: gh-9 record moved into round 1");
    const changes = git("show", "--name-status", "-M", "--format=", "HEAD").split("\n");
    expect(changes.length).toBeGreaterThan(3);
    for (const c of changes) expect(c).toMatch(new RegExp(`^R100\\t${spec}/runs/_story/[^\\t]+\\t${spec}/runs/_story/rounds/01-duo/`));
    expect(git("rev-parse", `origin/${BRANCH}`)).toBe(git("rev-parse", "HEAD"));
    expect(git("status", "--porcelain")).toBe("");

    expect(ls(story())).toEqual(["handoff.md", "rounds"]);
    expect(h.state(round1())).toEqual(flatState as never);
    // paths the receipts carry are relative to the round, so they still resolve
    const withEvidence = ls(join(round1(), "receipts"))
      .map((n) => JSON.parse(h.read(join(round1(), "receipts", n))) as { evidence?: string })
      .filter((x) => x.evidence);
    expect(withEvidence.length).toBeGreaterThan(0);
    for (const x of withEvidence) expect(existsSync(join(round1(), x.evidence as string))).toBe(true);
  });

  test("the story goes on: the next tick decides at implement, round 1, counters unchanged", async () => {
    h.clock.advance(10_000);
    const r = await h.tick();
    expect(r.decisions.filter((d) => d.unit === "gh-9").map((d) => d.rule)).not.toContain("round.migrate");
    expect(h.state(round1())).toMatchObject({ step: "implement", counters: { review_loop: 1 } });
    const status = (await h.norn("status", "--json")).value as { groups: Record<string, Array<{ story: string; step: string | null }>> };
    expect(Object.values(status.groups).flat().find((i) => i.story === "gh-9")).toMatchObject({ step: "implement" });
  });
});

describe("an old flat record merged into the base stays flat and reads as round 1 (B36)", () => {
  const OLD = ".agents/specs/gh-1-projects-and-items";
  let head = "";

  test("setup: a story an older norn finished, its flat record merged into main", () => {
    cpSync(join(import.meta.dir, "../../../view/test/integration/fixtures/gh-1/spec"), join(h.root, OLD), { recursive: true });
    h.git(["add", "-A"]);
    h.git(["commit", "-q", "-m", "merge gh-1 (older norn)"]);
    h.git(["push", "-q", "origin", "main"]);
    head = h.git(["rev-parse", "HEAD"]).trim();
  });

  test("AC5: run list and run view read it as its one round; nothing is written to the base or the record", async () => {
    const list = await h.norn("run", "list", "gh-1", "--json");
    expect(list.exit).toBe(0);
    expect(JSON.stringify(list.value)).toContain('"refine"');
    const view = await h.norn("run", "view", "gh-1", "--json");
    expect(view.exit).toBe(0);
    expect(JSON.stringify(view.value)).toContain('"$done"');
    h.clock.advance(10_000);
    const r = await h.tick();
    expect(r.decisions.filter((d) => d.unit === "gh-1").map((d) => d.rule)).not.toContain("round.migrate");

    expect(existsSync(join(h.root, OLD, "runs/_story/rounds"))).toBe(false);
    expect(existsSync(join(h.root, OLD, "runs/_story/state.json"))).toBe(true);
    expect(h.git(["status", "--porcelain", "--", OLD]).trim()).toBe("");
    expect(h.git(["rev-parse", "HEAD"]).trim()).toBe(head);
    expect(h.git(["rev-parse", "origin/main"]).trim()).toBe(head);
  });
});
