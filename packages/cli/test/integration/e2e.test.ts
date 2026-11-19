/**
 * The CLI end to end, every norn call a subprocess of the binary from source: a person sets up a
 * repository with an installed harness plugin, creates a story, and ticks it through an agent step,
 * a check, a gate, open-pr and the merge; the agent is a script that answers its hooks and reports
 * through `norn hook test`, `norn brief`, `norn done` and `norn ask` as a coding agent does.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { layout } from "@norn/store-local";
import { agentNotes, awaitNote, machineOf, type NornOut, noteOf, norn, setUp, sh, status, type StoryShown, TEST_PLUGIN, tickUntil, type World, world } from "./world.ts";

const KEY = "lt-1";
const SLOW = 180_000;

describe("a story from intake to merged, through the CLI alone", () => {
  let w: World;
  let set: { added: NornOut; init: NornOut };
  let created: NornOut;
  const rules: string[] = [];
  let atGate: StoryShown | undefined;
  let approved: NornOut;
  let afterPr: StoryShown | undefined;
  let finished: NornOut;
  let afterReport: unknown;

  beforeAll(async () => {
    w = await world("work");
    set = await setUp(w);
    created = await norn(w, ["story", "create", "Add the feature", "--json"]);
    await tickUntil(w, rules, (u) => u?.step === "ready" && u.parked !== undefined);
    atGate = (await status(w)).stories.find((s) => s.key === KEY);
    approved = await norn(w, ["story", "approve", KEY, "--json"]);
    await tickUntil(w, rules, (u) => u?.step === "merge");
    afterPr = (await status(w)).stories.find((s) => s.key === KEY);
    // the person reviews the change and merges it with git; forge none sees the merge in git
    await sh(w.root, "git", "merge", "-q", "--no-ff", "--no-edit", `norn/${KEY}`);
    await sh(w.root, "git", "push", "-q", "origin", "main");
    await tickUntil(w, rules, (u) => u?.ended !== undefined);
    finished = await norn(w, ["status", "--json"]);
    afterReport = await awaitNote(w, "stop.after-report");
  }, SLOW);

  test("init completes the config plugin add started, and the installed harness resolves", () => {
    expect(set.added).toMatchObject({ code: 0, body: { name: "norn-plugin-test", api: "^1.5", provides: { harness: ["test"], packs: ["e2e"] }, team: false } });
    expect(set.added.body.spec).toBe(TEST_PLUGIN);
    expect(set.init.code).toBe(0);
    expect(set.init.body).toMatchObject({ chose: { tracker: "local", forge: "none", store: "local", executor: "test", runner: "headless" }, doctor: { ok: true } });
    expect(created).toMatchObject({ code: 0, body: { key: KEY, labels: ["norn"] } });
  });

  test("ticks carry it through the agent step and the check to the gate; approve passes it to open-pr, and the merge ends it done", async () => {
    expect(atGate?.units[0]).toMatchObject({ step: "ready", parked: "gate.park", waiting: { for: "gate", next: `norn story approve ${KEY}, or norn story reject ${KEY} --reason "<what to change>"` } });
    expect(approved).toMatchObject({ code: 0, body: { unit: KEY, step: "ready", outcome: "approve", replayed: false } });
    expect(afterPr?.change).toMatchObject({ id: 1, state: "open" });
    // open-pr pushed the story branch to the bare remote before opening the change
    expect(await sh(w.root, "git", "ls-remote", "--heads", "origin", `norn/${KEY}`)).toContain(`refs/heads/norn/${KEY}`);
    expect(finished.code).toBe(0);
    const story = (finished.body.stories as StoryShown[]).find((s) => s.key === KEY);
    expect(story?.change).toMatchObject({ state: "merged" });
    expect(story?.units[0]).toMatchObject({ ended: "done", ended_reason: "the change merged" });
    expect(rules).toEqual(expect.arrayContaining(["intake.story", "agent.start", "check.run", "check.finished", "gate.park", "step.run", "step.finished", "story.change_merged"]));
    expect(rules.filter((r) => r.endsWith("!"))).toEqual([]);
    // the agent's commit is what landed on main
    expect(await sh(w.root, "git", "log", "--format=%s", "-3", "main")).toContain("agent: feature.txt");
  });

  test("the agent ran its hooks and reports through the real binary: a brief, the guard, and one report", () => {
    expect(agentNotes(w).map((n) => n.run).filter((r, i, all) => all.indexOf(r) === i)).toHaveLength(1);
    expect(noteOf(w, "prompt")).toEqual({ kind: "allow" });
    // the bare `norn` the agent ran is the launcher's shim, never another norn on the PATH
    expect(noteOf(w, "norn")).toMatch(/\/runtime\/bin\/norn$/);
    const brief = noteOf(w, "brief") as { code: number; text: string };
    expect(brief.code).toBe(0);
    expect(brief.text).toContain("Build the thing.");
    expect(brief.text).toContain("`norn done done`");
    expect(noteOf(w, "write.inside")).toEqual({ kind: "allow" });
    expect(noteOf(w, "write.machine")).toMatchObject({ kind: "deny", reason: expect.stringContaining("run state") });
    expect(noteOf(w, "done")).toMatchObject({ code: 0, body: { unit: KEY, verb: "done", outcome: "done", replayed: false } });
  });

  test("the agent may not stop before `norn done`, and `norn done` with an outcome the step lacks refuses with exit 3 and what to do", () => {
    expect(noteOf(w, "stop.before-report")).toMatchObject({ kind: "block", reason: expect.stringContaining("norn done") });
    const bad = noteOf(w, "done.bad") as { code: number; body: Record<string, unknown> };
    expect(bad.code).toBe(3);
    expect(bad.body).toEqual({ error: expect.stringContaining('"shipped"'), do_instead: "report one of `done`", code: "outcome" });
    // once reported, a stop is let through
    expect(afterReport).toEqual({ kind: "allow" });
  });
});

describe("an agent that asks, and a person who answers", () => {
  let w: World;
  const rules: string[] = [];
  let parked: StoryShown | undefined;
  let answered: NornOut;
  let corrupt: NornOut;
  let corruptMd: NornOut;
  let afterReport: unknown;

  beforeAll(async () => {
    w = await world("ask");
    const { added } = await setUp(w);
    await norn(w, ["story", "create", "Add the button", "--json"]);
    await tickUntil(w, rules, (u) => u?.parked !== undefined);
    parked = (await status(w)).stories.find((s) => s.key === KEY);
    answered = await norn(w, ["story", "answer", KEY, "Blue."]);
    await tickUntil(w, rules, (u) => u?.step === "ready" && u.parked !== undefined);
    // a run-state file that does not parse
    writeFileSync(layout(machineOf(added)).state(KEY), '{"format": 1, "unit": 7');
    corrupt = await norn(w, ["story", "view", KEY, "--json"]);
    corruptMd = await norn(w, ["story", "view", KEY]);
    afterReport = await awaitNote(w, "stop.after-report");
  }, SLOW);

  test("`norn ask` parks the story on the question; `norn story answer` resumes the same session, which works on and reports", () => {
    expect(parked?.units[0]).toMatchObject({ step: "build", parked: "Which colour should the button be?", waiting: { for: "person", text: "Which colour should the button be?" } });
    expect(noteOf(w, "ask")).toMatchObject({ code: 0, body: { unit: KEY, verb: "ask", replayed: false } });
    expect(noteOf(w, "stop.after-ask")).toEqual({ kind: "allow" });
    expect(answered.code).toBe(0);
    expect(answered.stdout).toContain(`Answered ${KEY} at build`);
    // one run the whole way: the answer resumed its session, never a fresh launch
    const runs = [...new Set(agentNotes(w).map((n) => n.run))];
    expect(runs).toHaveLength(1);
    expect(noteOf(w, "answered")).toMatchObject({ session: `s-${runs[0]}`, prompt: expect.stringContaining("Blue.") });
    expect(noteOf(w, "done")).toMatchObject({ code: 0, body: { outcome: "done" } });
    expect(rules).toEqual(expect.arrayContaining(["agent.start", "check.finished", "gate.park"]));
    // the resumed session was not taken for the turn its ask ended, so nothing nudged a run that was working
    expect(rules.filter((r) => r.includes("nudge") || r.includes("died") || r.endsWith("!"))).toEqual([]);
    expect(afterReport).toEqual({ kind: "allow" });
  });

  test("a run-state file that does not parse makes story view a corrupt error, exit 4, never a guess", () => {
    expect(corrupt.code).toBe(4);
    expect(corrupt.body).toMatchObject({ code: "corrupt", error: expect.stringContaining(`${KEY} is corrupt`), do_instead: expect.any(String) });
    expect(corruptMd.code).toBe(4);
    expect(corruptMd.stdout).toContain("corrupt");
    expect(corruptMd.stdout).not.toContain("not started");
  });
});

describe("doctor on a machine without the plugin the config names", () => {
  test("reports the missing plugin with do_instead `norn plugin add <spec>`", async () => {
    const w = await world();
    await setUp(w);
    // the same checkout under another norn home: the repo's config names the plugin, this home never installed it
    const doctor = await norn(w, ["doctor", "--json"], { NORN_HOME_DIR: `${w.dir}/other-home` });
    expect(doctor.code).toBe(1);
    const checks = doctor.body.checks as { name: string; ok: boolean; code?: string; do_instead?: string; skipped?: boolean }[];
    expect(checks.find((c) => c.name === "plugins")).toMatchObject({ ok: false, code: "plugin_missing", do_instead: `norn plugin add ${TEST_PLUGIN}` });
    expect(checks.filter((c) => c.skipped).map((c) => c.name)).toEqual(["slots", "workflows", "labels", "hooks"]);
    // a command that needs the plugin refuses the same way, as a CliError
    const tick = await norn(w, ["tick", "--json"], { NORN_HOME_DIR: `${w.dir}/other-home` });
    expect(tick).toMatchObject({ code: 3, body: { code: "plugin_missing", do_instead: `norn plugin add ${TEST_PLUGIN}` } });
  }, SLOW);
});
