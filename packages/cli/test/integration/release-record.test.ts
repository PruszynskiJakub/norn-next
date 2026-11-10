/**
 * Every claim release (`norn story handoff`, a clean `watch` exit,
 * `norn story close`) pushes the story's branches and then its record to `refs/norn/runs/<story>`
 * before the claim ref goes, under either policy. A rejected record push releases nothing.
 * The order is what the bare remote received, logged by a real `post-receive` hook; a rejection is a
 * real `pre-receive` hook.
 */
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { chmodSync, existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { claimRef, recordRef, STORY_UNIT_DIR, ulid } from "@norn/schema";
import { appendReceipt, handoffPath, readState, workflowsDir } from "@norn/store";
import type { CliResult, TickReport } from "../../src/index.ts";
import { createHarness, type Harness, issue, runChecked, sh } from "../../../../test/support/harness.ts";
import { runStateOf, storyRunStateOf } from "../../../../test/support/run-state.ts";

setDefaultTimeout(90_000);

const MINI = `name: mini
start: plan
steps:
  plan:
    type: agent
    skill: norn-plan
    outcomes: { done: { to: slices, means: "slice files written" } }
  slices:
    type: slices
    outcomes: { done: $done, stuck: $stuck }
`;
const SLICE = `name: slice
start: implement
steps:
  implement:
    type: agent
    skill: norn-implement
    outcomes: { done: { to: $done, means: "tests pass" } }
`;
const SOLO = `name: solo
start: implement
steps:
  implement:
    type: agent
    skill: norn-implement
    outcomes: { done: { to: $done, means: "built" } }
`;
const CONFIG = "provider: gh\nworkflow: mini\nmode: auto\n";

let h: Harness;
const tick = (): Promise<TickReport> => {
  h.clock.advance(10_000);
  return h.tick();
};
const state = (dir: string) => {
  const r = readState(dir);
  return r.ok ? r.value : null;
};
async function tickUntil(pred: () => boolean, max = 12) {
  for (let i = 0; i < max && !pred(); i++) await tick();
  expect(pred()).toBe(true);
}
function report(runsDir: string, body: Record<string, unknown>) {
  const st = state(runsDir);
  if (!st) throw new Error(`no state in ${runsDir}`);
  appendReceipt(runsDir, { kind: "done", receipt_id: ulid(h.clock.now()), run_id: st.run?.run_id ?? null, step: st.step, attempt: st.attempt, at: h.clock.iso(), by: "agent", ...body } as never);
}

const remoteRef = (ref: string): string | null => sh(h.dir, ["ls-remote", h.remoteDir, ref]).split(/\s+/)[0] || null;
/** every file path under a folder, relative and sorted */
function filesOf(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) (e.isDirectory() ? walk : (p: string) => out.push(relative(dir, p)))(join(d, e.name));
  };
  if (existsSync(dir)) walk(dir);
  return out.sort();
}
function recordOnRemote(story: string) {
  const sha = remoteRef(recordRef(story));
  if (!sha) throw new Error(`no record ref for ${story}`);
  const files = sh(h.dir, ["--git-dir", h.remoteDir, "ls-tree", "-r", "--name-only", sha]).split("\n").filter(Boolean).sort();
  const trailers = Object.fromEntries(
    sh(h.dir, ["--git-dir", h.remoteDir, "log", "-1", "--format=%(trailers:only,unfold)", sha])
      .split("\n")
      .filter(Boolean)
      .map((l) => l.split(": ") as [string, string]),
  );
  return { sha, files, trailers };
}

// the remote logs every ref update it accepts, in order: `<new sha> <ref>`
const LOG = () => join(h.dir, "received.log");
const received = (): string[] => (existsSync(LOG()) ? readFileSync(LOG(), "utf8").split("\n").filter(Boolean) : []);
const ZERO = /^0+$/;
function logReceived() {
  const hook = join(h.remoteDir, "hooks", "post-receive");
  writeFileSync(hook, `#!/bin/sh\nwhile read old new ref; do echo "$new $ref" >> "${LOG()}"; done\nexit 0\n`);
  chmodSync(hook, 0o755);
  rmSync(LOG(), { force: true });
}
/** the order the remote took this story's updates in: branch names, `record`, `claim deleted` */
function orderOf(story: string, branches: string[]): string[] {
  return received().flatMap((l) => {
    const [sha, ref] = l.split(" ") as [string, string];
    if (ref === recordRef(story)) return ["record"];
    if (ref === claimRef(story)) return ZERO.test(sha) ? ["claim deleted"] : [];
    const b = branches.find((x) => ref === `refs/heads/${x}`);
    return b ? [b] : [];
  });
}
function rejectRecord(story: string): () => void {
  const hook = join(h.remoteDir, "hooks", "pre-receive");
  writeFileSync(hook, `#!/bin/sh\nwhile read old new ref; do\n  case "$ref" in ${recordRef(story)}) echo "records are closed today" >&2; exit 1;; esac\ndone\nexit 0\n`);
  chmodSync(hook, 0o755);
  return () => rmSync(hook, { force: true });
}

/** A mini story with its plan session started (held here, run state in the machine dir). */
async function storyAt(n: number, slug: string, labels?: string[]) {
  const spec = `.agents/specs/gh-${n}-${slug}`;
  const wt = h.worktree(`gh-${n}-${slug}`);
  const runs = () => runStateOf(join(wt, spec));
  h.remote.issues = [...h.remote.issues, issue(n, slug, labels)];
  await h.tick("--sync");
  await tickUntil(() => state(runs())?.status === "running");
  return { key: `gh-${n}`, spec, wt, branch: `gh-${n}-${slug}`, runs, record: () => storyRunStateOf(join(wt, spec)) };
}

beforeAll(async () => {
  h = await createHarness();
  expect((await h.norn("init")).exit).toBe(0);
  h.config(CONFIG);
  h.write(join(workflowsDir(h.root), "mini.yaml"), MINI);
  h.write(join(workflowsDir(h.root), "slice.yaml"), SLICE);
  h.write(join(workflowsDir(h.root), "solo.yaml"), SOLO);
  h.git(["add", "-A"]);
  h.git(["commit", "-q", "-m", "norn init"]);
  h.git(["push", "-q", "origin", "main"]);
});
afterAll(() => h.cleanup());

describe("norn story handoff pushes the record before the claim goes (B15, B11)", () => {
  test("AC1: under local with no ref yet: story branch, slice branch, then refs/norn/runs/gh-9 matching the story branch, then the claim", async () => {
    const s = await storyAt(9, "hand-it-over");
    h.write(join(s.wt, s.spec, "slices/01-form.md"), "---\nid: gh-9/01\ntitle: Form\ndepends_on: []\nstatus: planned\n---\n\nAcceptance: the form renders.\n");
    report(s.runs(), { outcome: "done", handoff: "planned one slice" });
    const sliceRuns = () => runStateOf(join(`${s.wt}--01-form`, s.spec), "01-form");
    await tickUntil(() => state(sliceRuns())?.status === "running");
    expect(remoteRef(recordRef("gh-9"))).toBeNull();
    // Resume notes in both handoffs, committed by the handoff: both branches move
    for (const [wt, unit] of [[s.wt, STORY_UNIT_DIR], [`${s.wt}--01-form`, "01-form"]] as const) {
      const file = handoffPath(join(wt, s.spec), unit);
      h.write(file, `${existsSync(file) ? readFileSync(file, "utf8") : ""}\n## Resume\nGo on with the form.\n`);
    }

    logReceived();
    const r = await h.norn("story", "handoff", "gh-9");
    expect(r.exit).toBe(0);
    const slice = "gh-9/01-form";
    expect(orderOf("gh-9", [s.branch, slice])).toEqual([s.branch, slice, "record", "claim deleted"]);
    const head = remoteRef(`refs/heads/${s.branch}`) as string;
    expect(head).toBe(sh(h.root, ["rev-parse", `refs/heads/${s.branch}`]));
    const rec = recordOnRemote("gh-9");
    expect(rec.trailers["Norn-Branch-Commit"]).toBe(head);
    expect(rec.files).toEqual(filesOf(s.record()));
    expect(rec.files).toContain("01-form/state.json");
    expect(remoteRef(claimRef("gh-9"))).toBeNull();
    expect(r.stdout).toContain(`handed over gh-9: record at ${rec.sha}, matches story branch ${head}`);
    expect(r.value).toMatchObject({ story: "gh-9", released: true, pushed: [s.branch, slice], record: { sha: rec.sha, branch_commit: head } });
  });
});

describe("under remote too (B15)", () => {
  test("AC1: a record already pushed at a boundary is pushed again when the handoff commit moved the branch", async () => {
    h.config(`${CONFIG}record:\n  policy: remote\n`);
    try {
      const s = await storyAt(14, "remote-handoff");
      const before = recordOnRemote("gh-14");
      const file = handoffPath(join(s.wt, s.spec), STORY_UNIT_DIR);
      h.write(file, `${existsSync(file) ? readFileSync(file, "utf8") : ""}\n## Resume\nPlan the form.\n`);
      logReceived();
      const r = await h.norn("story", "handoff", "gh-14");
      expect(r.exit).toBe(0);
      expect(orderOf("gh-14", [s.branch])).toEqual([s.branch, "record", "claim deleted"]);
      const rec = recordOnRemote("gh-14");
      const head = remoteRef(`refs/heads/${s.branch}`) as string;
      expect(rec.sha).not.toBe(before.sha);
      expect(rec.trailers["Norn-Branch-Commit"]).toBe(head);
      expect(before.trailers["Norn-Branch-Commit"]).not.toBe(head);
      expect(r.stdout).toContain(`handed over gh-14: record at ${rec.sha}, matches story branch ${head}`);
    } finally {
      h.config(CONFIG);
    }
  });
});

describe("a rejected record push releases nothing (B16)", () => {
  let s: Awaited<ReturnType<typeof storyAt>>;
  test("AC3: story handoff exits 3 with the reason and what to do; the claim is held and nothing is deleted", async () => {
    s = await storyAt(10, "rejected");
    const files = filesOf(s.record());
    const allow = rejectRecord("gh-10");
    try {
      const claim = remoteRef(claimRef("gh-10"));
      const r = await h.norn("story", "handoff", "gh-10", "--json");
      expect(r.exit).toBe(3);
      const body = r.value as { error: string; do_instead: string };
      expect(body.error).toContain("records are closed today");
      expect(body.do_instead).toBe("check the remote, then run norn story handoff gh-10 again");
      expect(remoteRef(claimRef("gh-10"))).toBe(claim);
      expect(remoteRef(recordRef("gh-10"))).toBeNull();
      expect(existsSync(s.wt)).toBe(true);
      expect(filesOf(s.record())).toEqual(files);
      // the markdown reply says the same
      const md = await h.norn("story", "handoff", "gh-10");
      expect(md.exit).toBe(3);
      expect(md.stdout).toContain("check the remote, then run norn story handoff gh-10 again");
    } finally {
      allow();
    }
  });

  test("AC3: a clean watch exit in the same case keeps that claim and says so", async () => {
    const allow = rejectRecord("gh-10");
    try {
      const claim = remoteRef(claimRef("gh-10"));
      const r = await runChecked(["watch", "--interval", "1ms", "--max-ticks", "1", "--human"], { ...h.deps, log: () => {} });
      expect(r.exit).not.toBe(0);
      expect(r.stdout).toMatch(/Could not release gh-10: [\s\S]*records are closed today[\s\S]*the claim is kept/);
      expect(remoteRef(claimRef("gh-10"))).toBe(claim);
      expect(remoteRef(recordRef("gh-10"))).toBeNull();
    } finally {
      allow();
    }
  });

  test("AC2: a clean watch exit pushes the record before it deletes the claim", async () => {
    logReceived();
    const r = await runChecked(["watch", "--interval", "1ms", "--max-ticks", "1"], { ...h.deps, log: () => {} });
    expect(r.exit).toBe(0);
    expect((r.value as { released: Array<{ story: string; ok: boolean }> }).released).toEqual([expect.objectContaining({ story: "gh-10", ok: true })]);
    expect(orderOf("gh-10", [s.branch]).filter((x) => x !== s.branch)).toEqual(["record", "claim deleted"]);
    const rec = recordOnRemote("gh-10");
    expect(rec.trailers["Norn-Branch-Commit"]).toBe(remoteRef(`refs/heads/${s.branch}`) as string);
    expect(rec.files).toEqual(filesOf(s.record()));
  });
});

describe("norn story close pushes the record before the claim goes (B15)", () => {
  test("AC2: story close: branches, then the record, then the claim", async () => {
    const s = await storyAt(11, "close-it");
    const files = filesOf(s.record());
    logReceived();
    const r: CliResult = await h.norn("story", "close", "gh-11", "--yes");
    expect(r.exit).toBe(0);
    expect(orderOf("gh-11", [s.branch])).toEqual([s.branch, "record", "claim deleted"]);
    const rec = recordOnRemote("gh-11");
    expect(rec.files).toEqual(files);
    expect(rec.trailers["Norn-Branch-Commit"]).toBe(remoteRef(`refs/heads/${s.branch}`) as string);
  });

  test("B16: story close whose record push is rejected removes nothing and keeps the claim", async () => {
    const s = await storyAt(13, "close-refused");
    const allow = rejectRecord("gh-13");
    try {
      const claim = remoteRef(claimRef("gh-13"));
      const r = await h.norn("story", "close", "gh-13", "--yes", "--json");
      expect(r.exit).toBe(3);
      expect((r.value as { error: string }).error).toContain("records are closed today");
      expect(remoteRef(claimRef("gh-13"))).toBe(claim);
      expect(existsSync(s.wt)).toBe(true);
    } finally {
      allow();
    }
  });
});

describe("a story with no branch is handed over all the same (B33)", () => {
  test("AC4: its ref is pushed with no Norn-Branch-Commit trailer and the claim is released", async () => {
    const s = await storyAt(12, "no-branch");
    // the story's spec on the base, its worktree and branch gone (#126: a story without a branch)
    h.git(["checkout", "-q", "main"]);
    sh(h.root, ["--work-tree", s.wt, "add", s.spec]);
    h.git(["commit", "-q", "-m", "gh-12 spec on main"]);
    h.git(["push", "-q", "origin", "main"]);
    sh(h.root, ["worktree", "remove", "--force", s.wt]);
    sh(h.root, ["branch", "-D", s.branch]);
    sh(h.root, ["push", "-q", "origin", "--delete", s.branch]);
    expect(remoteRef(`refs/heads/${s.branch}`)).toBeNull();
    const record = storyRunStateOf(join(h.root, s.spec));

    logReceived();
    const r = await h.norn("story", "handoff", "gh-12");
    expect(r.exit).toBe(0);
    expect(orderOf("gh-12", [s.branch])).toEqual(["record", "claim deleted"]);
    const rec = recordOnRemote("gh-12");
    expect(rec.trailers).toEqual({ "Norn-Story": "gh-12", "Norn-Holder": expect.any(String) });
    expect(rec.files).toEqual(filesOf(record));
    expect(remoteRef(claimRef("gh-12"))).toBeNull();
    expect(r.stdout).toContain(`handed over gh-12: record at ${rec.sha}, with no story branch`);
  });
});

describe("under remote, the tick that closes a story pushes its record once (review 09-F2)", () => {
  test("GR6b: a record changed since its last push goes out with close_story alone, never also as push_record", async () => {
    h.config(`${CONFIG}record:\n  policy: remote\n`);
    try {
      const s = await storyAt(15, "closed-issue", ["norn", "norn:wf:solo"]);
      report(s.runs(), { outcome: "done", handoff: "built" });
      await tickUntil(() => state(s.runs())?.status === "done");
      await tick(); // the boundary's record push
      const before = remoteRef(recordRef("gh-15"));
      expect(before).not.toBeNull();
      // the record moved on since that push, so a remote boundary would owe a push_record this tick
      h.write(join(s.record(), "_story", "notes.txt"), "last words\n");
      const i = h.remote.issues.find((x) => x.number === 15);
      if (!i) throw new Error("no issue");
      i.state = "closed";
      h.clock.advance(10_000);
      const r = (await h.norn("sync")).value as TickReport;
      expect(r.decisions.filter((d) => d.unit === "gh-15" && d.kind !== "noop" && d.rule !== "claim.renew").map((d) => `${d.kind} ${d.ok}`)).toEqual(["close_story true"]);
      const rec = recordOnRemote("gh-15");
      expect(rec.sha).not.toBe(before);
      expect(rec.files).toContain("_story/notes.txt");
      expect(existsSync(s.wt)).toBe(false);
    } finally {
      h.config(CONFIG);
    }
  });
});
