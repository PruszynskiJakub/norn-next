## HEAD 55c959ed0553a44155299db44fafde9123415db2
## src hits of -worktrees in packages/
## worktreesDir definition and fillers
HEAD:packages/cli/src/commands/story-start.ts:15:import { heartbeatId, readLocalClaim, worktreesDir } from "@norn/store";
HEAD:packages/cli/src/commands/story-start.ts:38:  const parent = worktreesDir(ctx.root);
HEAD:packages/cli/src/runtime/agent-unit.ts:11:import { loadUnit, readPinnedWorkflow, readUnitHooks, readSliceFile, readState, readStoryFile, storyFile, type UnitMarker, runStateDir, worktreesDir } from "@norn/store";
HEAD:packages/cli/src/runtime/agent-unit.ts:110:  const wt = storyWorktreePath(worktreesDir(s.root), s.unit.story, slug);
HEAD:packages/cli/src/runtime/checkout.ts:95:  worktreesDir,
HEAD:packages/cli/src/runtime/checkout.ts:449:  const storyWt = branch ? (wtByBranch.get(branch) ?? storyWorktreePath(worktreesDir(root), key, branch.slice(key.length + 1))) : null;
HEAD:packages/cli/src/runtime/observe/index.ts:59:  worktreesDir,
HEAD:packages/cli/src/runtime/observe/index.ts:176:      if (w.path.startsWith(`${worktreesDir(root)}/`)) orphanWts.push(w.path);
HEAD:packages/cli/src/runtime/observe/index.ts:510:    repo: { root, default_branch: base, remote: remoteName, worktrees: worktreesDir(root) },
HEAD:packages/core/src/commands.ts:14:export const storyWorktreePath = (worktreesDir: string, story: string, slug: string) =>
HEAD:packages/core/src/commands.ts:15:  `${worktreesDir.replace(/\/+$/, "")}/${storyDirName(story, slug)}`;
HEAD:packages/core/src/facts.ts:444:   * `worktrees` is the absolute folder unit worktrees sit in (store's `worktreesDir`): core cannot derive it.
HEAD:packages/store/src/local-facts.ts:43:import { worktreesDir } from "./paths.ts";
HEAD:packages/store/src/local-facts.ts:172:    const conventional = storyWorktreePath(worktreesDir(root), s.key, s.slug);
HEAD:packages/store/src/paths.ts:154:export const worktreesDir = (root: string) => join(machineDir(root), "worktrees");
HEAD:packages/store/src/worktree.ts:11:import { envNornPath, unitMarkerPath, WORKTREE_LOCAL_FILES, worktreesDir } from "./paths.ts";
HEAD:packages/store/src/worktree.ts:91:  if (!branch || !path.startsWith(`${worktreesDir(repo)}/`)) return null;
HEAD:packages/store/src/worktree.ts:127: * The unit worktrees in the worktrees folder (`worktreesDir`), found without git — what a read-only view
HEAD:packages/store/src/worktree.ts:135:  const base = worktreesDir(repoRoot);
HEAD:packages/store/test/unit/worktree.test.ts:5:import { bindNornHome, machineDir, machineHolder, readEnvNorn, readUnitMarker, scanWorktrees, slotEnv, worktreesDir, writeEnvNorn, writeUnitMarker } from "../../src/index.ts";
HEAD:packages/view/src/load.ts:58:  worktreesDir,
HEAD:packages/view/src/load.ts:463:    repo: { root: opts.repoRoot, default_branch: defaultBranch, remote: config.git_remote, worktrees: worktreesDir(opts.repoRoot) },
## tests/support hits (excluding recorded fixtures, .txt)
HEAD:packages/adapters/test/unit/herdr/cockpit.test.ts:31:    expect(agents[0]).toEqual({ pane_id: "w2:p5", workspace_id: "w2", agent: "claude", status: "idle", cwd: "/repo-worktrees/gh-1-login", agent_session_id: "sess-refine" });
HEAD:packages/adapters/test/unit/herdr/cockpit.test.ts:42:    expect(findAgentPane(agents, reach({ agent_session_id: "gone", worktree: "/repo-worktrees/gh-1-login/" }))).toBe("w2:p5");
HEAD:packages/adapters/test/unit/herdr/cockpit.test.ts:44:    expect(findAgentPane(agents, reach({ worktree: "/repo-worktrees/gh-2-search" }))).toBeNull();
HEAD:packages/adapters/test/unit/herdr/cockpit.test.ts:45:    expect(findAgentPane(agents, reach({ worktree: "/repo-worktrees/gh-3-none" }))).toBeNull();
HEAD:packages/adapters/test/unit/herdr/cockpit.test.ts:94:    { workspace_id: "w3A", label: "gh-1/01 implement", pane_ids: ["w3A:p1"], cwds: ["/repo-worktrees/gh-1-01-login"] },
HEAD:packages/adapters/test/unit/herdr/cockpit.test.ts:102:  expect(findWorkspace(ws, reach({ pane_id: "w9:p9", worktree: "/repo-worktrees/gh-1-01-login/" }))).toBe("w3A");
HEAD:packages/adapters/test/unit/herdr/cockpit.test.ts:122:    { pane_id: "w3A:p1", tab_id: "w3A:t1", workspace_id: "w3A", cwd: "/repo-worktrees/gh-1-01-login", status: "idle" },
HEAD:packages/adapters/test/unit/herdr/herdr.test.ts:294:        "Accessing workspace: /Users/u/Projects/norn-sandbox-todoist-b-worktrees/gh-9-keyboard-shortcut-q-focuses-quick-add Quick safety check: Is this a project you created or one you trust? (Like your own code, a well-known open source project, or work from your team). If not, take a moment to review what's in this folder first. Claude Code'll be able to read, edit, and execute files here. Security guide",
HEAD:packages/cli/test/integration/worktrees-machine-dir.test.ts:3: * `<repo>-worktrees/` folder beside the repository: where norn creates them (story at intake, slice
HEAD:packages/cli/test/integration/worktrees-machine-dir.test.ts:27:const besideRepo = (root: string) => `${root}-worktrees`;
HEAD:packages/cli/test/integration/worktrees-machine-dir.test.ts:86:    expect(readdirSync(dirname(h.root)).filter((f) => f.endsWith("-worktrees"))).toEqual([]);
HEAD:packages/cli/test/unit/cockpit-tui.test.ts:48:    root: `/repo-worktrees/${key}-x`,
HEAD:packages/core/test/fixtures.ts:98:    worktree: worktree(unit.slice ? `/r-worktrees/gh-1-login--${unit.dir}` : "/r-worktrees/gh-1-login"),
HEAD:packages/core/test/fixtures.ts:139:    worktree: worktree(`/r-worktrees/${key}-login`),
HEAD:packages/core/test/fixtures.ts:155:    repo: { root: "/r", default_branch: "main", remote: "origin", worktrees: "/r-worktrees" },
HEAD:packages/core/test/rule-cases.ts:22:const STORY_WT = "/r-worktrees/gh-1-login";
HEAD:packages/core/test/rule-cases.ts:100:      unmarked: [{ path: "/r-worktrees/gh-1-login", marker: { repo: "/r", story: "gh-1", slice: null, unit: "_story", spec_dir: ".agents/specs/gh-1-login" } }],
HEAD:packages/core/test/rule-cases.ts:195:    const slice = sliceAt("01", "form", {}, { worktree: worktree("/r-worktrees/gh-1-login--01-form") });
HEAD:packages/core/test/rule-cases.ts:262:    const a = sliceAt("01", "form", ready("integrate"), { worktree: worktree("/r-worktrees/gh-1-login--01-form") });
HEAD:packages/core/test/rule-cases.ts:263:    const b = sliceAt("02", "api", ready("integrate"), { worktree: worktree("/r-worktrees/gh-1-login--02-api") });
HEAD:packages/core/test/unit/attended-wait.test.ts:11:const WT = "/r-worktrees/gh-1-login";
HEAD:packages/core/test/unit/base-sync.test.ts:76:    return facts([sf], { tick_id: tick, repo: { root: "/r", default_branch: "main", remote: "origin", worktrees: "/r-worktrees", ...this.repoPatch } }, this.now);
HEAD:packages/core/test/unit/brief.test.ts:34:    worktree: "/r-worktrees/gh-1-login--02-form",
HEAD:packages/core/test/unit/brief.test.ts:79:    expect(b.json.rework).toMatchObject({ from: "test.fail", check: { exit_code: 1, log: `/r-worktrees/gh-1-login--02-form/.agents/specs/gh-1-login/runs/02-form/logs/${RUN}.log` }, findings: null });
HEAD:packages/core/test/unit/brief.test.ts:103:        paths: { worktree: "/r-worktrees/gh-1-login", spec_dir: ".agents/specs/gh-1-login", story_file: ".agents/specs/gh-1-login/story.md", slice_file: null, unit_dir: ".agents/specs/gh-1-login/runs/_story" },
HEAD:packages/core/test/unit/brief.test.ts:177:const ABS_UNIT = "/r-worktrees/gh-1-login--02-form/.agents/specs/gh-1-login/runs/02-form";
HEAD:packages/core/test/unit/brief.test.ts:284:  const UNIT = "/r-worktrees/gh-1-login--02-form/.agents/specs/gh-1-login/runs/02-form";
HEAD:packages/core/test/unit/brief.test.ts:460:    const wt = "/w/norn-sandbox-todoist-worktrees/gh-1-projects-and-items";
HEAD:packages/core/test/unit/brief.test.ts:484:    const wt = "/w/norn-sandbox-todoist-worktrees/gh-2-due-dates-with-today-and-upcoming-views--03-due-dates-in-project-lists";
HEAD:packages/core/test/unit/brief.test.ts:717:  const storyPaths = { worktree: "/r-worktrees/gh-1-login", spec_dir: ".agents/specs/gh-1-login", story_file: ".agents/specs/gh-1-login/story.md", slice_file: null, unit_dir: ".agents/specs/gh-1-login/runs/_story" };
HEAD:packages/core/test/unit/brief.test.ts:801:      paths: { worktree: "/r-worktrees/gh-1-login", spec_dir: ".agents/specs/gh-1-login", story_file: ".agents/specs/gh-1-login/story.md", slice_file: null, unit_dir: ".agents/specs/gh-1-login/runs/_story" },
HEAD:packages/core/test/unit/decide.test.ts:49:  return storyFacts(key, [unitFacts(unit, wf, st, { run: rf, worktree: { path: `/r-worktrees/${key}-login`, exists: true, status: null, last_commit_at: null, last_file_change_at: null, slot: 1 } })], { ...story, frontmatter: { ...storyFacts(key, []).frontmatter!, workflow: "solo", intake_at: at(intake) } });
HEAD:packages/core/test/unit/decide.test.ts:109:    const clean = { ...worktreeOf("/r-worktrees/gh-1-login"), status: wtStatus("/r-worktrees/gh-1-login", "gh-1-login") };
HEAD:packages/core/test/unit/decide.test.ts:110:    expect(fresh({ intake_only: true, worktree: clean })?.lost_intake).toEqual({ drop: { worktree: "/r-worktrees/gh-1-login", branch: "gh-1-login" } });
HEAD:packages/core/test/unit/decide.test.ts:114:    expect(fresh({ intake_only: true, worktree: dirty })?.lost_intake).toEqual({ keep: "/r-worktrees/gh-1-login has uncommitted changes" });
HEAD:packages/core/test/unit/decide.test.ts:188:    expect(a.launch).toMatchObject({ agent: "claude", cwd: "/r-worktrees/gh-1-login", prompt: "Run `norn brief` in this worktree and do the step it gives you.", env: { NORN_STORY: "gh-1", NORN_RUN: a.launch.run_id, NORN_SLOT: "1", PORT_BASE: "4010" } });
HEAD:packages/core/test/unit/decide.test.ts:192:    expect(a.commit).toMatchObject({ cwd: "/r-worktrees/gh-1-login", branch: "gh-1-login", push: true, trailers: { "Norn-Story": "gh-1", "Norn-Step": "implement" } });
HEAD:packages/core/test/unit/decide.test.ts:353:    expect(a).toMatchObject({ kind: "run_check", command: "bun test", timeout_ms: 300_000, cwd: "/r-worktrees/gh-1-login" });
HEAD:packages/core/test/unit/decide.test.ts:400:    expect(JSON.stringify(a)).not.toContain("/r-worktrees");
HEAD:packages/core/test/unit/decide.test.ts:409:    expect(JSON.stringify(a)).not.toContain("/r-worktrees");
HEAD:packages/core/test/unit/decide.test.ts:424:      worktree: { path: "/r-worktrees/gh-1-login--02-s02", branch: "gh-1/02-s02", from: "gh-1-login", slot: 1 },
HEAD:packages/core/test/unit/decide.test.ts:428:    expect(a.starts[0]?.commit).toEqual({ cwd: "/r-worktrees/gh-1-login--02-s02", branch: "gh-1/02-s02", message: "norn: start gh-1/02 (slice)", trailers: { "Norn-Story": "gh-1", "Norn-Slice": "gh-1/02", "Norn-Step": "implement", "Norn-Tick": TICK }, push: true });
HEAD:packages/core/test/unit/decide.test.ts:449:    f.units[1]!.worktree!.status = wtStatus("/r-worktrees/gh-1-login--01-s01", "gh-1/01-s01");
HEAD:packages/core/test/unit/decide.test.ts:450:    expect(decide(facts([f]), WORKFLOWS, CONFIG).find((d) => d.unit === "gh-1/01")?.action).toMatchObject({ kind: "mark_done", slice_status: "integrated", cleanup: { worktree: "/r-worktrees/gh-1-login--01-s01", branch_local: "gh-1/01-s01", release_slot: true } });
HEAD:packages/core/test/unit/decide.test.ts:531:      commit: { cwd: "/r-worktrees/gh-1-login", branch: "gh-1-login", message: "norn: mirror gh-1 from the remote issue", trailers: { "Norn-Story": "gh-1", "Norn-Step": "test", "Norn-Tick": TICK }, push: true },
HEAD:packages/core/test/unit/decide.test.ts:540:    expect(m.kind === "update_story_mirror" && m.commit).toEqual({ cwd: "/r-worktrees/gh-1-login", branch: "gh-1-login", message: "norn: mirror gh-1 from the remote issue", trailers: { "Norn-Story": "gh-1", "Norn-Tick": TICK }, push: true });
HEAD:packages/core/test/unit/decide.test.ts:584:    rebase.units[0]!.worktree = { ...worktreeOf("/r-worktrees/gh-1-login"), in_progress: { operation: "rebase", unmerged: [] } };
HEAD:packages/core/test/unit/decide.test.ts:601:    f.units[0]!.worktree = { ...worktreeOf("/r-worktrees/gh-1-login"), in_progress: { operation: "rebase", unmerged: [] } };
HEAD:packages/core/test/unit/decide.test.ts:624:    f.units[1]!.worktree = { ...worktreeOf("/r-worktrees/gh-1-login/01-s01"), in_progress: { operation: "rebase", unmerged: [] } };
HEAD:packages/core/test/unit/decide.test.ts:684:    f.units[0]!.worktree = { ...worktreeOf("/r-worktrees/gh-1-login"), in_progress: { operation: "rebase", unmerged: [] } };
HEAD:packages/core/test/unit/decide.test.ts:703:      worktree: { path: "/r-worktrees/gh-5-fix-lodz-bug", branch: "gh-5-fix-lodz-bug", from: "main" },
HEAD:packages/core/test/unit/decide.test.ts:714:    expect(d?.action).toMatchObject({ commit: { cwd: "/r-worktrees/gh-5-fix", branch: "gh-5-fix", message: "norn: intake gh-5 Fix", trailers: { "Norn-Story": "gh-5", "Norn-Tick": TICK }, push: false } });
HEAD:packages/core/test/unit/decide.test.ts:952:      commit: { cwd: "/r-worktrees/gh-1-login", branch: "gh-1-login", message: "norn: gh-1 record moved into round 1", trailers: { "Norn-Story": "gh-1", "Norn-Step": "implement", "Norn-Tick": TICK }, push: true },
HEAD:packages/core/test/unit/handoff-inbox.test.ts:57:      your_turn: [`gh-1 | refine: attended step — work with the agent | 1h | cd /r-worktrees/gh-1-login && claude --permission-mode auto -- 'Run \`norn brief\` in this worktree and do the step it gives you.'`],
HEAD:packages/core/test/unit/handoff-inbox.test.ts:76:      { command: "norn story start gh-1", detail: `by hand: cd /r-worktrees/gh-1-login && claude --permission-mode auto -- 'Run \`norn brief\` in this worktree and do the step it gives you.'` },
HEAD:packages/core/test/unit/handoff-inbox.test.ts:119:    expect(manual(uf).groups.your_turn[0]?.command).toStartWith("cd /r-worktrees/gh-1-login--02-form && ");
HEAD:packages/core/test/unit/handoff-inbox.test.ts:128:    expect(running(uf)[0]?.reach?.worktree).toBe("/r-worktrees/gh-1-login--02-form");
HEAD:packages/core/test/unit/handoff-inbox.test.ts:261:    const dir = "/r-worktrees/gh-1-login--02-form/.agents/specs/gh-1-login/runs/02-form";
HEAD:packages/core/test/unit/prompts.test.ts:39:const hook = (event: HookFact["event"], ms: number): HookFact => ({ event, at: at(ms), agent: "claude", native: event, cwd: "/r-worktrees/gh-1-login", run_id: RUN });
HEAD:packages/core/test/unit/recovery.test.ts:21:const WT = "/r-worktrees/gh-1-login";
HEAD:packages/store/test/unit/run-hooks.test.ts:6:const WT = "/repo-worktrees/gh-9-x";
HEAD:packages/view/test/unit/cockpit.test.ts:42:    root: `/repo-worktrees/${key}-x`,
HEAD:packages/view/test/unit/cockpit.test.ts:62:  const reach = { worktree: "/repo-worktrees/gh-2-x", agent_session_id: "s2", pane_id: null };
HEAD:packages/view/test/unit/cockpit.test.ts:140:    expect(row(rows, "attended:gh-2")?.actions[1]?.effect).toEqual({ kind: "place", place: "agent", story: "gh-2", reach: { worktree: "/repo-worktrees/gh-2-x", agent_session_id: "s2", pane_id: null } });
## docs hits
## docs concepts
94:A unit's **run state** (`state.json`, the numbered receipts, the pinned workflow, logs of failed checks and QA evidence) lives on the machine that runs the story, in the checkout's machine dir: `~/.norn/repos/<id>/runs/<story>/<unit>/`. It is in no worktree and on no branch, so removing a worktree or running `git clean -fdx` leaves the story where it was, and it leaves the machine only as the story's record, when norn pushes it to the record ref. The unit worktrees live beside it, in the same machine dir's `worktrees/` folder: a story's at `~/.norn/repos/<id>/worktrees/<story>-<slug>`, each slice's next to it at `…/worktrees/<story>-<slug>--<nn>-<slug>`. Nothing norn makes sits beside your repository.
151:| worktree | The git worktree a unit works in, in the checkout's machine dir under `worktrees/` (`~/.norn/repos/<id>/worktrees/<story>-<slug>`, a slice's with `--<nn>-<slug>` added). |
