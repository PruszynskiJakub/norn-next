import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import {
  appendReceipt,
  bindNornHome,
  currentRound,
  loadSnapshot,
  loadUnit,
  machineDir,
  pinWorkflow,
  runStateDir,
  runStateStartDir,
  storyRunStateDir,
  storyDir,
  startDir,
  storyFile,
  storyUnitDir,
  writeHandoffHeader,
  handoffPath,
  writeSliceFile,
  writeState,
  writeStoryFile,
  writeUnitMarker,
} from "../../src/index.ts";
import { AT, receipt, state, tmp, WORKFLOW_YAML } from "../helpers.ts";

function seed(root: string, title = "Fix login") {
  const spec = storyDir(root, "gh-12", "fix-login");
  writeStoryFile(storyFile(spec), {
    id: "gh-12", slug: "fix-login", provider: "gh", number: 12, url: "u", title, assignee: null, workflow: "story", status: "active", intake_at: AT,
  }, "\nspec\n");
  writeSliceFile(join(spec, "slices/01-add-form.md"), { id: "gh-12/01", title: "Add form", depends_on: [], status: "active" }, "");
  writeSliceFile(join(spec, "slices/02-wire-api.md"), { id: "gh-12/02", title: "Wire", depends_on: ["gh-12/01"], status: "planned" }, "");
  const u1 = runStateDir(root, { key: "gh-12", spec_dir: relative(root, spec) }, "01-add-form");
  pinWorkflow(u1, WORKFLOW_YAML);
  appendReceipt(u1, receipt());
  appendReceipt(u1, receipt());
  writeState(u1, state({ applied_through: 1 }));
  writeHandoffHeader(handoffPath(spec, "01-add-form"), "header");
  return spec;
}

describe("loadSnapshot", () => {
  test("R3.4 (N1): a story worktree supplies only its own story; others come from the base copy", () => {
    const repo = tmp();
    const own = tmp(); // gh-12's own worktree: its record says active
    const other = tmp(); // gh-15's worktree, cut from a base that already records gh-12 as done
    seed(own, "Own copy");
    writeUnitMarker(own, { repo, story: "gh-12", slice: null, unit: "_story", spec_dir: ".agents/specs/gh-12-fix-login" });
    writeStoryFile(storyFile(storyDir(other, "gh-12", "fix-login")), { id: "gh-12", slug: "fix-login", provider: "gh", number: 12, url: "u", title: "Shadow copy", assignee: null, workflow: "story", status: "done", intake_at: AT }, "");
    writeStoryFile(storyFile(storyDir(other, "gh-15", "other")), { id: "gh-15", slug: "other", provider: "gh", number: 15, url: "u", title: "Other", assignee: null, workflow: "story", status: "active", intake_at: AT }, "");
    writeUnitMarker(other, { repo, story: "gh-15", slice: null, unit: "_story", spec_dir: ".agents/specs/gh-15-other" });
    // the shadowing worktree sorts first: before R3.4 it supplied gh-12's record
    const s = loadSnapshot({ repoRoot: repo, storyRoots: [other, own], home: tmp(), baseRef: null });
    expect(s.stories.map((x) => [x.key, x.root, x.frontmatter?.title])).toEqual([
      ["gh-12", own, "Own copy"],
      ["gh-15", other, "Other"],
    ]);
    // without its own worktree, gh-12 is not read from gh-15's worktree at all
    const t = loadSnapshot({ repoRoot: repo, storyRoots: [other], home: tmp(), baseRef: null });
    expect(t.stories.map((x) => x.key)).toEqual(["gh-15"]);
    // a root without a story marker supplies nothing
    expect(loadSnapshot({ repoRoot: repo, storyRoots: [tmp()], home: tmp(), baseRef: null }).stories).toEqual([]);
  });
});

describe("storyFile (GR2: spec.md, story.md still read)", () => {
  test("a new folder gets spec.md; spec.md wins over story.md; a folder holding only story.md keeps it", () => {
    const spec = storyDir(tmp(), "gh-12", "fix-login");
    expect(storyFile(spec)).toBe(join(spec, "spec.md"));
    mkdirSync(spec, { recursive: true });
    writeFileSync(join(spec, "story.md"), "");
    expect(storyFile(spec)).toBe(join(spec, "story.md"));
    writeFileSync(join(spec, "spec.md"), "");
    expect(storyFile(spec)).toBe(join(spec, "spec.md"));
  });
});

describe("the story's current round (gh-71 D2, S5)", () => {
  test("a round folder without state.json (a round.start that stopped after the pin) is not the current round", () => {
    const base = tmp(); // a story's run-state folder (S12: `<machine dir>/runs/<story>`)
    const r1 = join(base, "_story/rounds/01-triage");
    pinWorkflow(r1, WORKFLOW_YAML);
    writeState(r1, state());
    expect(currentRound(base)).toEqual({ n: 1, workflow: "triage" });
    const r2 = join(base, "_story/rounds/02-story");
    pinWorkflow(r2, WORKFLOW_YAML);
    expect(currentRound(base)).toEqual({ n: 1, workflow: "triage" });
    expect(storyUnitDir(base)).toBe(r1);
    expect(startDir(base, "_story", "story")).toBe(r1);
    writeState(r2, state());
    expect(currentRound(base)).toEqual({ n: 2, workflow: "story" });
    expect(storyUnitDir(base)).toBe(r2);
  });
  test("a story whose round 1 was pinned but never got its state starts in round 1 again", () => {
    const base = tmp();
    pinWorkflow(join(base, "_story/rounds/01-triage"), WORKFLOW_YAML);
    expect(currentRound(base)).toBeNull();
    expect(startDir(base, "_story", "triage")).toBe(join(base, "_story/rounds/01-triage"));
  });
});

describe("run state lives in the checkout's machine dir, the handoff in the worktree (S12, gh-195/05, B2, B5)", () => {
  const story = { key: "gh-12", spec_dir: ".agents/specs/gh-12-fix-login" };
  test("a unit's run state is `<machine dir>/runs/<story>/<unit>`, the story's current round under `_story/rounds/`", () => {
    const root = tmp();
    bindNornHome(root, tmp());
    expect(storyRunStateDir(root, story)).toBe(join(machineDir(root), "runs/gh-12"));
    expect(runStateDir(root, story, "01-add-form")).toBe(join(machineDir(root), "runs/gh-12/01-add-form"));
    expect(runStateStartDir(root, story, "_story", "story")).toBe(join(machineDir(root), "runs/gh-12/_story/rounds/01-story"));
  });
  test("keyed by the unit, not by its record folder: the story's handoff stays above its rounds in the worktree, a slice's is in its folder", () => {
    const root = tmp();
    bindNornHome(root, tmp());
    const spec = join(root, story.spec_dir);
    const r2 = join(storyRunStateDir(root, story), "_story/rounds/02-story");
    pinWorkflow(r2, WORKFLOW_YAML);
    writeState(r2, state());
    expect(runStateDir(root, story, "_story")).toBe(r2);
    expect(handoffPath(spec, "_story")).toBe(join(spec, "runs/_story/handoff.md"));
    expect(handoffPath(spec, "01-add-form")).toBe(join(spec, "runs/01-add-form/handoff.md"));
    writeHandoffHeader(handoffPath(spec, "_story"), "story header");
    const u = loadUnit(root, story, { story: "gh-12", slice: null, dir: "_story", key: "gh-12" });
    expect(u.path).toBe(r2);
    expect(u.record).toBe("_story/rounds/02-story");
    expect(u.handoffFile).toBe(join(spec, "runs/_story/handoff.md"));
    expect(u.handoff?.header).toBe("story header");
    expect(existsSync(join(spec, "runs/_story/rounds"))).toBe(false);
  });
  test("S2: a receipt failing validation is named from the machine dir and marks only its unit", () => {
    const root = tmp();
    bindNornHome(root, tmp());
    const dir = runStateDir(root, story, "01-add-form");
    pinWorkflow(dir, WORKFLOW_YAML);
    writeState(dir, state());
    mkdirSync(join(dir, "receipts"), { recursive: true });
    writeFileSync(join(dir, "receipts/0001-done.json"), "{}");
    const u = loadUnit(root, story, { story: "gh-12", slice: "gh-12/01", dir: "01-add-form", key: "gh-12/01" });
    expect(u.errors.map((e) => e.file)).toEqual(["runs/gh-12/01-add-form/receipts/0001-done.json"]);
    expect(loadUnit(root, story, { story: "gh-12", slice: null, dir: "_story", key: "gh-12" }).errors).toEqual([]);
  });
});
