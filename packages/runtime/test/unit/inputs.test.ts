import { describe, expect, test } from "bun:test";
import { loadWorkflow, type WorkflowLoad } from "@norn/kernel";
import { parse } from "yaml";
import { briefOf, criteriaOf, handoffArtifact, loadPackWorkflows, loadPinned, mirrorItem, readStoryDoc, reportRun, SPEC_ARTIFACT } from "../../src/index.ts";
import { has, harness, type Harnessed, record, tickUntil, trackerItem, WORKFLOWS } from "./support.ts";

const UNIT = "lt-1";
const WORKTREE = "/machine/repo/worktrees/lt-1";
const ITEM = { title: "Fix the typo in the help", body: "The help text says `teh`; it should say `the`.", url: "https://tracker.example/1", labels: ["norn", "docs"] };

async function started(): Promise<{ h: Harnessed; runId: string }> {
  const h = harness({ workflow: "handed" });
  h.items.push(trackerItem(1, ITEM));
  await tickUntil(h, has("agent.start"));
  await tickUntil(h, has("receipts.apply"));
  const runId = (await record(h, UNIT)).state?.run?.id;
  if (!runId) throw new Error("no run started");
  return { h, runId };
}

async function brief(h: Harnessed): Promise<string> {
  const r = await briefOf(h.env, UNIT);
  if (!r.ok) throw new Error(r.refusal.error);
  return r.value.markdown;
}

async function doc(h: Harnessed, path: string): Promise<string | null> {
  const r = await readStoryDoc(h.env, UNIT, path);
  if (!r.ok) throw new Error(r.failure.message);
  return r.value;
}

describe("the story's spec", () => {
  test("intake mirrors the tracker item into spec.md: key, title, labels, link and body", async () => {
    const h = harness({ workflow: "handed" });
    h.items.push(trackerItem(1, ITEM));
    await tickUntil(h, has("agent.start"));
    const spec = await doc(h, SPEC_ARTIFACT);
    expect(spec).toContain('key: "lt-1"');
    expect(spec).toContain('title: "Fix the typo in the help"');
    expect(spec).toContain('labels: ["docs", "norn"]');
    expect(spec).toContain("# Fix the typo in the help");
    expect(spec).toContain(ITEM.body);
    expect(spec).toContain(ITEM.url);
  });

  test("a tick mirrors an item that changed into the spec, with no run launched for it", async () => {
    const { h } = await started();
    h.items[0] = trackerItem(1, { ...ITEM, title: "Fix every typo in the help" });
    await h.runtime.tick();
    expect(await doc(h, SPEC_ARTIFACT)).toContain("# Fix every typo in the help");
  });

  test("a re-mirror rewrites the item block and keeps every section written outside it", () => {
    const first = mirrorItem(trackerItem(1, ITEM), null);
    const planned = `${first}\n## Plan\n\nChange the help string, add a test.\n`;
    const next = mirrorItem(trackerItem(1, { ...ITEM, title: "Fix two typos", body: "Also `adn`." }), planned);
    expect(next).toContain("# Fix two typos");
    expect(next).toContain("Also `adn`.");
    expect(next).not.toContain(ITEM.body);
    expect(next).toContain("## Plan\n\nChange the help string, add a test.\n");
    expect(mirrorItem(trackerItem(1, ITEM), next.replace("Also `adn`.", "edited by hand"))).toContain(ITEM.body);
    // a spec rewritten without the markers keeps all of its text under a fresh block
    const rewritten = mirrorItem(trackerItem(1, ITEM), "My own notes.\n");
    expect(rewritten).toContain(ITEM.body);
    expect(rewritten).toContain("My own notes.");
  });

  test("a re-mirror rewrites norn's frontmatter keys and keeps the ones a step added, such as the criteria QA covers", () => {
    const first = mirrorItem(trackerItem(1, ITEM), null);
    const sliced = first.replace('url: "https://tracker.example/1"\n', 'url: "https://tracker.example/1"\ncriteria:\n  - { id: AC1, verifier: agent }\n  - id: 01.AC2\n    verifier: test\n');
    const next = mirrorItem(trackerItem(1, { ...ITEM, title: "Fix two typos" }), sliced);
    expect(next).toStartWith('---\nkey: "lt-1"\ntitle: "Fix two typos"\nlabels: ["docs", "norn"]\nurl: "https://tracker.example/1"\ncriteria:\n  - { id: AC1, verifier: agent }\n  - id: 01.AC2\n    verifier: test\n---\n');
    expect(criteriaOf(next, "spec.md")).toEqual({ ok: true, value: { file: "spec.md", criteria: [{ id: "AC1", verifier: "agent" }, { id: "01.AC2", verifier: "test" }] } });
  });
});

describe("readable inputs", () => {
  test("the brief names the story and each input under .agents/: the spec and handoff in its spec folder, the rest in .agents/run/in/, all ignored by git", async () => {
    const { h } = await started();
    const md = await brief(h);
    expect(md).toContain("## Story");
    expect(md).toContain("`lt-1`: Fix the typo in the help (https://tracker.example/1)");
    expect(md).toContain("- `spec` — the story's spec: its tracker item, mirrored, and the sections later steps added: `.agents/specs/lt-1/spec.md`");
    expect(md).toContain("- `handoff` — this unit's handoff, which you keep current: `.agents/specs/lt-1/handoffs/lt-1.md`");
    expect(md).toContain("- `last_check` — the last check's result. no check has run for this unit yet");
    expect(md).toContain("`.agents/specs/lt-1/handoffs/lt-1.md` is this unit's current state");
    expect(md).toContain("ignored by git");
    expect(await h.files.read(`${WORKTREE}/.agents/run/.gitignore`)).toBe("*\n");
    expect(await h.files.read(`${WORKTREE}/.agents/specs/lt-1/.gitignore`)).toBe("*\n");
    expect(await h.files.read(`${WORKTREE}/.agents/specs/lt-1/spec.md`)).toContain(ITEM.body);
    expect(await h.files.read(`${WORKTREE}/.agents/specs/lt-1/handoffs/lt-1.md`)).toContain("# Handoff: lt-1");
  });

  test("a handoff the agent writes is read back when it reports, and the next step's inputs carry it from a fresh worktree", async () => {
    const { h, runId } = await started();
    await brief(h);
    await h.files.write(`${WORKTREE}/.agents/specs/lt-1/handoffs/lt-1.md`, "# Handoff\n\nThe help string is fixed; the test is in help.test.ts.\n");
    await h.files.write(`${WORKTREE}/.agents/specs/lt-1/spec.md`, `${await h.files.read(`${WORKTREE}/.agents/specs/lt-1/spec.md`)}\n## Plan\n\nFix it in one place.\n`);
    expect((await reportRun(h.env, UNIT, runId, { verb: "done", outcome: "done" }, "r1")).ok).toBe(true);
    expect(await doc(h, handoffArtifact(UNIT))).toContain("the test is in help.test.ts");
    await tickUntil(h, async () => (await record(h, UNIT)).state?.run?.step === "review");
    // the next step may run in another checkout: only the story's documents carry the handoff there
    await h.files.remove(`${WORKTREE}/.agents/specs/lt-1/handoffs/lt-1.md`);
    await h.files.remove(`${WORKTREE}/.agents/run/.base/specs/lt-1/handoffs/lt-1.md`);
    h.items[0] = trackerItem(1, { ...ITEM, body: "The help text says `teh` twice." });
    const md = await brief(h);
    expect(md).toContain("# norn brief — lt-1 · review #1");
    expect(await h.files.read(`${WORKTREE}/.agents/specs/lt-1/handoffs/lt-1.md`)).toContain("the test is in help.test.ts");
    const spec = (await h.files.read(`${WORKTREE}/.agents/specs/lt-1/spec.md`)) ?? "";
    expect(spec).toContain("says `teh` twice.");
    expect(spec).toContain("## Plan\n\nFix it in one place.");
    expect(md).toContain("- `diff` — the change so far. run `git diff main...HEAD` in this worktree");
  });

  test("an untouched copy left in a worktree never overwrites a newer document", async () => {
    const { h } = await started();
    await brief(h);
    const write = await h.env.slots.store.artifacts?.write(UNIT, handoffArtifact(UNIT), "# Handoff\n\nnewer, from elsewhere\n");
    expect(write?.ok).toBe(true);
    await brief(h);
    expect(await h.files.read(`${WORKTREE}/.agents/specs/lt-1/handoffs/lt-1.md`)).toContain("newer, from elsewhere");
  });
});

describe("the run folder", () => {
  test("a launch empties .agents/run/out/, so a report reads only what its own run wrote there", async () => {
    const h = harness({ workflow: "handed" });
    h.items.push(trackerItem(1, ITEM));
    // left by an earlier run of the unit that died before it reported
    await h.files.write(`${WORKTREE}/.agents/run/out/findings.json`, "[]");
    await h.files.write(`${WORKTREE}/.agents/run/out/evidence/shot.txt`, "old");
    await tickUntil(h, has("agent.start"));
    const left = Object.keys(h.files.snapshot()).filter((p) => p.startsWith(`${WORKTREE}/.agents/run/out/`));
    expect(left).toEqual([]);
  });
});

describe("an input name the host does not provide", () => {
  const TYPO = (WORKFLOWS["handed.yaml"] as string).replace("inputs: [spec, handoff, last_findings, diff]", "inputs: [spec, handoff, last_findings, diff, mystery]");

  test("a unit that pinned a revision naming one before such names were refused keeps running it, and its brief notes the input", async () => {
    const h = harness({ workflow: "handed" });
    const byName = h.env.workflows as Record<string, WorkflowLoad>;
    const fixed = byName.handed as WorkflowLoad;
    const asFile = loadPackWorkflows({ workflows: { "handed.yaml": TYPO }, shared: {}, skills: {} }, h.env.slots.stepKinds, h.env.config.kernel);
    expect(asFile.ok && asFile.value.handed?.ok).toBe(false);
    // the same loader without the host's inputs, as a norn from before the refusal loaded the file
    const before = loadWorkflow(parse(TYPO), { stepKinds: h.env.slots.stepKinds, sharedFiles: {}, config: h.env.config.kernel });
    if (!before.ok) throw new Error(JSON.stringify(before.errors));
    byName.handed = before;
    h.items.push(trackerItem(1, ITEM));
    await tickUntil(h, has("agent.start"));
    await tickUntil(h, has("receipts.apply"));
    const build = (await record(h, UNIT)).state;
    expect(build?.workflow.hash).toBe(before.workflow.pinned.hash);
    // the file fixed since: the unit decides by the revision it pinned, which still loads
    byName.handed = fixed;
    expect(loadPinned(h.env, before.workflow.pinned)?.pinned.hash).toBe(before.workflow.pinned.hash);
    expect((await reportRun(h.env, UNIT, build?.run?.id as string, { verb: "done", outcome: "done" }, "r1")).ok).toBe(true);
    await tickUntil(h, async () => (await record(h, UNIT)).state?.run?.step === "review");
    const review = (await record(h, UNIT)).state;
    expect({ ended: review?.ended, hash: review?.workflow.hash }).toEqual({ ended: undefined, hash: before.workflow.pinned.hash });
    expect(await brief(h)).toContain("- `mystery` — norn provides no input of this name");
  });
});
