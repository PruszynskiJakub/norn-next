/**
 * Base sync replayed through the pure decide:
 * scripted facts (`story.base`) in, decisions out, with the effects act would have (the `run_git`
 * classify receipt, the check receipt, an agent report) fed back as receipts.
 */
import { describe, expect, test } from "bun:test";
import { deriveUlid, type Receipt, type UnitState, type Workflow, validate } from "@norn/schema";
import type { Action, Decision } from "../../src/actions.ts";
import { applyReceipts } from "../../src/apply.ts";
import { type BaseSidePath, renderBrief } from "../../src/brief.ts";
import { decide } from "../../src/decide/index.ts";
import { askingMidMerge, storyMerged, storyPhase } from "../../src/policy.ts";
import type { GitInProgress } from "../../src/ports.ts";
import type { NumberedReceipt, StoryBase, StoryFacts } from "../../src/facts.ts";
import { buildInbox } from "../../src/inbox/items.ts";
import { baseUpdateStep, checkWorkflowLevel, isStale, validateWorkflowDefinition } from "../../src/workflow.ts";
import { at, CONFIG, facts, HB, loaded, stateFor, storyFacts, storyUnit, T0, unitFacts } from "../fixtures.ts";

/** §4.4 in small: update → test → ready, with resolve for conflicts and a `stale` route at ready. */
const BASE_WF: Workflow = {
  name: "based",
  start: "update",
  steps: {
    update: { type: "git", action: "update", outcomes: { done: "test", conflict: { to: "resolve", counter: "base_conflict_loop" } } },
    resolve: { type: "agent", skill: "merge", inputs: ["spec", "handoff"], outcomes: { done: { to: "update", means: "base merged into the story branch, conflicts resolved and committed" } } },
    test: { type: "check", run: "bun test", timeout: "5m", outcomes: { pass: "ready", fail: "$stuck" } },
    ready: { type: "gate", outcomes: { approve: "$done", reject: "$stuck", stale: { to: "update", counter: "stale_loop" } } },
  },
  counters: { base_conflict_loop: { max: 2 }, stale_loop: { max: 3 } },
  base: { stale: "conflict" },
};
/** The same without a `stale` route at the gate (BS6: only the inbox item). */
const NO_ROUTE_WF: Workflow = { ...BASE_WF, name: "noroute", steps: { ...BASE_WF.steps, ready: { type: "gate", outcomes: { approve: "$done", reject: "$stuck" } } } };

const SHA = (c: string) => c.repeat(40);
const BASE_REF = "refs/remotes/origin/main";

function base(patch: Partial<StoryBase> = {}): StoryBase {
  return { ref: BASE_REF, sha: SHA("b"), head: SHA("h"), merge_base: SHA("m"), behind: 0, ahead: 2, conflicts: [], ...patch };
}

/** One story unit driven tick by tick: decide, then the effects act would have, as receipts. */
class Sim {
  state: UnitState;
  receipts: NumberedReceipt[] = [];
  base: StoryBase | undefined = base();
  pr: StoryFacts["pr"] = null;
  prSeen: StoryFacts["pr_seen"] = undefined;
  k = 0;
  /** what the next `git: update` effect yields (act's classify receipt, BS3) */
  git: "merge" | "conflict" | "stuck" = "merge";
  /** what the resolve agent reports */
  agent: "done" | "stuck" | "ask" = "done";
  /** the git operation in progress in the story worktree, as observe reports it */
  inProgress: GitInProgress | undefined = undefined;
  /** the base keeps moving into new conflicts while the agent resolves */
  moving = false;
  log: string[] = [];
  constructor(
    readonly wf: Workflow,
    readonly claimMine = true,
    readonly repoPatch: { default_branch?: string; remote?: string } = {},
  ) {
    this.state = stateFor(storyUnit(), wf);
  }
  get now() {
    return T0 + this.k * 60_000;
  }
  write(r: Receipt): void {
    this.receipts.push({ n: (this.receipts.at(-1)?.n ?? this.state.applied_through) + 1, file: "", receipt: r });
  }
  facts() {
    const tick = deriveUlid("01JAAAAAAAAAAAAAAAAAAAAAAA", this.k);
    const uf = unitFacts(storyUnit(), this.wf, this.state, { unapplied: this.receipts.filter((r) => r.n > this.state.applied_through) });
    if (this.inProgress && uf.worktree) uf.worktree = { ...uf.worktree, in_progress: this.inProgress };
    const fm = { ...storyFacts("gh-1", []).frontmatter!, workflow: this.wf.name };
    const claim: StoryFacts["claim"] = this.claimMine
      ? { state: "mine", sha: "c", blob: { version: 1, story: "gh-1", holder: "jakub@mac", heartbeat_id: HB, acquired_at: at(this.now), renewed_at: at(this.now), expires_at: at(this.now + 600_000), last_tick_id: null } }
      : { state: "none" };
    const sf = storyFacts("gh-1", [uf], { frontmatter: fm, claim, pr: this.pr, ...(this.prSeen ? { pr_seen: this.prSeen } : {}), ...(this.base ? { base: this.base } : {}) });
    return facts([sf], { tick_id: tick, repo: { root: "/r", default_branch: "main", remote: "origin", worktrees: "/r-worktrees", ...this.repoPatch } }, this.now);
  }
  /** one tick: decide (twice: pure), perform the unit's action like act, return it */
  tick(): Decision {
    const f = this.facts();
    const ds = decide(f, { [this.wf.name]: loaded(this.wf) }, CONFIG);
    expect(decide(f, { [this.wf.name]: loaded(this.wf) }, CONFIG)).toEqual(ds);
    const d = ds.find((x) => x.unit === "gh-1" && x.rule !== "claim.renew") as Decision;
    this.perform(d.action);
    this.log.push(d.rule);
    this.k++;
    return d;
  }
  private perform(a: Action): void {
    if ("receipts" in a) for (const r of a.receipts) this.receipts.push({ n: r.n, file: "", receipt: r.receipt });
    if ("state" in a && a.state) this.state = a.state;
    const st = this.state;
    const head = { receipt_id: deriveUlid("01JDDDDDDDDDDDDDDDDDDDDDDD", this.k), at: at(this.now), step: st.step, attempt: st.attempt } as const;
    if (a.kind === "run_git" && a.action === "update") {
      const u = a.update!;
      if (this.git === "stuck") this.write({ kind: "classify", ...head, run_id: a.run_id, by: "norn", outcome: "stuck", rule: a.rule, detail: "worktree dirty", route: "$stuck" });
      else if (this.git === "conflict" && this.base?.behind)
        this.write({ kind: "classify", ...head, run_id: a.run_id, by: "norn", outcome: "conflict", rule: a.rule, detail: "conflicts", route: "resolve", base: { ref: u.ref, sha: u.sha, conflicts: this.base.conflicts.length ? this.base.conflicts : ["a.ts"] } });
      else {
        // merged (or already up to date): the story now contains the base
        if (this.base) this.base = { ...this.base, behind: 0, conflicts: [], head: SHA("9"), ahead: this.base.ahead + 1 };
        this.write({ kind: "classify", ...head, run_id: a.run_id, by: "norn", outcome: "done", rule: a.rule, detail: "merged", route: "test", base: { ref: u.ref, sha: u.sha, conflicts: [] } });
      }
    }
    if (a.kind === "run_check") this.write({ kind: "check", ...head, run_id: a.run_id, by: "norn", outcome: "pass", command: a.command, exit_code: 0, duration_ms: 10, output_tail: "ok" });
    if (a.kind === "start_run") {
      const run_id = a.launch.run_id;
      if (this.agent === "done") {
        // the resolve agent merged the base and committed
        if (this.base && !this.moving) this.base = { ...this.base, behind: 0, conflicts: [], head: SHA("8") };
        this.write({ kind: "done", ...head, run_id, by: "agent", outcome: "done", handoff: "merged the base" });
      } else if (this.agent === "ask") this.write({ kind: "ask", ...head, run_id, by: "agent", question: "a.ts: keep the story's discount cap or the base's?" });
      else this.write({ kind: "stuck", ...head, run_id, by: "agent", reason: "a.ts: both sides need a new rule for discounts" });
    }
  }
  /** a person at the gate */
  approve(): void {
    this.write({ kind: "approve", receipt_id: deriveUlid("01JEEEEEEEEEEEEEEEEEEEEEEE", this.k), run_id: null, step: this.state.step, attempt: this.state.attempt, at: at(this.now), by: "human", who: "jakub@mac" });
  }
  runUntil(pred: (s: Sim) => boolean, max = 30): void {
    for (let i = 0; i < max && !pred(this); i++) this.tick();
    expect(pred(this)).toBe(true);
  }
  classifies(): Array<Extract<Receipt, { kind: "classify" }>> {
    return this.receipts.map((r) => r.receipt).filter((r): r is Extract<Receipt, { kind: "classify" }> => r.kind === "classify");
  }
}

const at_ = (step: string, status?: UnitState["status"]) => (s: Sim) => s.state.step === step && (status === undefined || s.state.status === status);

describe("workflow contract", () => {
  test("update is a story-only git action; stale is a gate outcome; base.step must exist", () => {
    expect(validateWorkflowDefinition(BASE_WF).issues).toEqual([]);
    expect(checkWorkflowLevel(BASE_WF, "slice").map((i) => i.path)).toEqual(["/steps/update"]);
    expect(baseUpdateStep(BASE_WF)).toBe("update");
    expect(baseUpdateStep({ ...BASE_WF, base: { step: "test" } })).toBe("test");
    const bad = validateWorkflowDefinition({ ...BASE_WF, base: { step: "nope" } });
    expect(bad.issues.map((i) => i.path)).toEqual(["/base/step"]);
    // `stale` is reserved
    const reserved = validateWorkflowDefinition({ ...BASE_WF, steps: { ...BASE_WF.steps, stale: { type: "check", run: "x", timeout: "1m", outcomes: { pass: "$done" } } } });
    expect(reserved.issues.some((i) => i.code === "reserved_name")).toBe(true);
    // A stale route without a counter is an uncounted cycle
    const uncounted = validateWorkflowDefinition({ ...BASE_WF, steps: { ...BASE_WF.steps, ready: { type: "gate", outcomes: { approve: "$done", stale: "update" } } } });
    expect(uncounted.issues.some((i) => i.code === "uncounted_cycle")).toBe(true);
  });

  test("BS7: stale by conflict (default) or by behind", () => {
    expect(isStale(BASE_WF, base({ behind: 3 }))).toBe(false);
    expect(isStale(BASE_WF, base({ behind: 3, conflicts: ["a.ts"] }))).toBe(true);
    expect(isStale({ ...BASE_WF, base: { stale: "behind" } }, base({ behind: 1 }))).toBe(true);
    expect(isStale(BASE_WF, undefined)).toBe(false);
  });
});

describe("base sync replay", () => {
  test("1: behind, no conflict → update merges (Norn-Tick trailer), done → test", () => {
    const s = new Sim(BASE_WF);
    s.base = base({ behind: 2 });
    const d = s.tick();
    expect(d.rule).toBe("git.update");
    const a = d.action as Extract<Action, { kind: "run_git" }>;
    expect(a.update).toEqual({ ref: BASE_REF, sha: SHA("b"), branch: "main", message: `Update gh-1 from main (${SHA("b").slice(0, 7)})`, trailers: { "Norn-Story": "gh-1", "Norn-Step": "update", "Norn-Tick": deriveUlid("01JAAAAAAAAAAAAAAAAAAAAAAA", 0) } });
    s.tick(); // apply the classify receipt
    expect(s.state).toMatchObject({ step: "test", status: "ready" });
    expect(s.log).toEqual(["git.update", "receipts.apply"]);
  });

  test("2: conflicts → resolve (brief carries base sha + paths) → done → update finds behind 0 → test", () => {
    const s = new Sim(BASE_WF);
    s.base = base({ behind: 4, conflicts: ["a.ts", "b.ts"] });
    s.git = "conflict";
    s.runUntil(at_("resolve"));
    expect(s.state.counters.base_conflict_loop).toBe(1);
    const brief = renderBrief({
      unit: storyUnit(),
      state: s.state,
      workflow: BASE_WF,
      mode: "auto",
      runner: "herdr",
      paths: { worktree: "/w", spec_dir: "/w/spec", story_file: "/w/spec/story.md", slice_file: null, unit_dir: "/w/spec/runs/_story" },
      diff_range: null,
      handoff: null,
      receipts: s.receipts,
      limits: { deadline: "60m", nudges: 2, retries: 1, slot: null, port_base: null },
    });
    expect(brief.json.rework?.base).toEqual({ ref: BASE_REF, sha: SHA("b"), conflicts: ["a.ts", "b.ts"] });
    expect(brief.markdown).toContain(`git merge --no-ff ${SHA("b")}`);
    expect(brief.markdown).toContain("never rebase");
    expect(brief.markdown).toContain("`a.ts`, `b.ts`");
    s.git = "merge";
    s.runUntil(at_("test"));
    expect(s.log).toEqual(["git.update", "receipts.apply", "agent.start", "receipts.apply", "git.update", "receipts.apply"]);
    // the second update found the story up to date
    expect(s.classifies().at(-1)).toMatchObject({ outcome: "done" });
  });

  test("2b: a resolve step with the base_side input: the base-update section lists the base side per conflicting path, trailer-less commits without a story", () => {
    const wf: Workflow = { ...BASE_WF, steps: { ...BASE_WF.steps, resolve: { ...BASE_WF.steps.resolve, inputs: ["spec", "handoff", "base_side"] } as Workflow["steps"][string] } };
    const s = new Sim(wf);
    s.base = base({ behind: 4, conflicts: ["a.ts", "b.ts"] });
    s.git = "conflict";
    s.runUntil(at_("resolve"));
    const spec = ".agents/specs/gh-5-login/spec.md";
    const pr = ".agents/specs/gh-5-login/pr.md";
    const side: BaseSidePath[] = [
      {
        path: "a.ts",
        commits: [
          { sha: SHA("1"), subject: "Login form validates", story: "gh-5", spec, pr },
          { sha: SHA("2"), subject: "hotfix by hand", story: null, spec: null, pr: null },
        ],
      },
      { path: "b.ts", commits: [] },
    ];
    const render = (over: { workflow?: Workflow; base_side?: typeof side | null }) =>
      renderBrief({
        unit: storyUnit(),
        state: s.state,
        workflow: over.workflow ?? wf,
        mode: "auto",
        runner: "herdr",
        paths: { worktree: "/w", spec_dir: "/w/spec", story_file: "/w/spec/story.md", slice_file: null, unit_dir: "/w/spec/runs/_story" },
        diff_range: null,
        handoff: null,
        receipts: s.receipts,
        limits: { deadline: "60m", nudges: 2, retries: 1, slot: null, port_base: null },
        ...(over.base_side !== undefined ? { base_side: over.base_side } : {}),
      });
    const brief = render({ base_side: side });
    expect(brief.json.rework?.base).toEqual({ ref: BASE_REF, sha: SHA("b"), conflicts: ["a.ts", "b.ts"], side });
    expect(brief.json.inputs).toContainEqual(expect.objectContaining({ kind: "base_side", label: "Base side", ref: "see Rework › Base update" }));
    const md = brief.markdown;
    const section = md.slice(md.indexOf("### Base update"));
    // Read before resolving: the base side comes before the resolve guidance
    expect(section.indexOf("Base side")).toBeLessThan(section.indexOf("Resolve each conflict by intent"));
    expect(section).toContain(`git show ${SHA("b")}:<path>`);
    expect(section).toContain(`- \`a.ts\`\n  - \`${SHA("1").slice(0, 12)}\` Login form validates — story gh-5: spec \`${spec}\`, PR body \`${pr}\``);
    expect(section).toContain(`  - \`${SHA("2").slice(0, 12)}\` hotfix by hand — no story (made outside norn)`);
    expect(section).toContain("- `b.ts`\n  - (no base commit since the merge base touched it)");
    // A story whose spec folder has no pr.md on the base: only what is there
    const noPr = render({ base_side: [{ path: "a.ts", commits: [{ sha: SHA("1"), subject: "s", story: "gh-5", spec, pr: null }] }] }).markdown;
    expect(noPr).toContain(`— story gh-5: spec \`${spec}\`\n`);
    // Without the input declared, nothing of the base side shows even when the caller passed it
    const undeclared = render({ workflow: BASE_WF, base_side: side });
    expect(undeclared.json.rework?.base).toEqual({ ref: BASE_REF, sha: SHA("b"), conflicts: ["a.ts", "b.ts"] });
    expect(undeclared.markdown).not.toContain("Base side");
  });

  test("3: base_conflict_loop exhausted → $stuck with the reason", () => {
    const s = new Sim(BASE_WF);
    s.base = base({ behind: 4, conflicts: ["a.ts"] });
    s.git = "conflict";
    // the resolve agent merges, but the base keeps moving into new conflicts
    s.moving = true;
    s.runUntil((x) => x.state.status === "stuck", 40);
    expect(s.state.park).toMatchObject({ kind: "exhausted", reason: "base_conflict_loop 2/2 at update.conflict" });
  });

  test("4: waiting at ready, a sibling merge makes conflicts → stale → update; and with stale: behind + clean merge", () => {
    for (const mode of ["conflict", "behind"] as const) {
      const wf: Workflow = { ...BASE_WF, base: { stale: mode } };
      const s = new Sim(wf);
      s.runUntil(at_("ready", "parked"));
      s.tick();
      expect(s.log.at(-1)).toBe("unit.parked.gate");
      // a sibling story merges into main
      s.base = mode === "conflict" ? base({ behind: 3, conflicts: ["a.ts"], sha: SHA("c") }) : base({ behind: 1, sha: SHA("c") });
      const d = s.tick();
      expect(d.rule).toBe("gate.stale");
      const r = s.classifies().at(-1);
      expect(r).toMatchObject({ outcome: "stale", rule: "base moved", route: "update", step: "ready", base: { sha: SHA("c"), behind: mode === "conflict" ? 3 : 1 } });
      expect(r?.detail).toBe(mode === "conflict" ? "3 behind, conflicts: a.ts" : "1 behind, conflicts: none");
      expect(s.state).toMatchObject({ step: "update", status: "ready", counters: { stale_loop: 1 } });
      // clean merge of the moved base, then back to ready
      s.runUntil(at_("ready", "parked"));
      expect(s.classifies().at(-1)).toMatchObject({ outcome: "done", step: "update" });
    }
  });

  test("4a: a story PR not fetched this tick holds the stale gate until a sync shows whether the PR merged", () => {
    const s = new Sim({ ...BASE_WF, base: { stale: "behind" } });
    s.runUntil(at_("ready", "parked"));
    const open: NonNullable<StoryFacts["pr"]> = { number: 7, url: "u", state: "open", is_draft: true, head_sha: SHA("h"), base_branch: "main" };
    // between syncs: the PR is only known from the last sync, and someone fetched the moved base
    s.pr = undefined;
    s.prSeen = { pr: open, observed_at: T0 };
    s.base = base({ behind: 1, sha: SHA("c") });
    const held = s.tick();
    expect(held.rule).toBe("gate.stale.awaits_sync");
    expect(held.action.kind).toBe("noop");
    expect(s.state).toMatchObject({ step: "ready", status: "parked" });
    // the sync shows the story's own PR merged: the merge path ends it, never stale → update
    s.pr = { ...open, state: "merged", is_draft: false, merged_at: at(s.now) };
    expect(s.tick().rule).not.toBe("gate.stale");
    expect(s.state.step).not.toBe("update");
    // the sync shows the PR still open: the base moved under it, so stale → update
    const t = new Sim({ ...BASE_WF, base: { stale: "behind" } });
    t.runUntil(at_("ready", "parked"));
    t.prSeen = { pr: open, observed_at: T0 };
    t.pr = open;
    t.base = base({ behind: 1, sha: SHA("c") });
    expect(t.tick().rule).toBe("gate.stale");
  });

  test("4b: an approve waiting at the gate wins over stale (C2: receipts first)", () => {
    const s = new Sim(BASE_WF);
    s.runUntil(at_("ready", "parked"));
    s.base = base({ behind: 3, conflicts: ["a.ts"] });
    s.approve();
    s.tick();
    expect(s.state).toMatchObject({ step: "$done", status: "done" });
  });

  test("5: gate without a stale route → no classification, Check item stale:* only", () => {
    const s = new Sim(NO_ROUTE_WF);
    s.runUntil(at_("ready", "parked"));
    s.base = base({ behind: 4, conflicts: ["a.ts", "b.ts"] });
    expect(s.tick().rule).toBe("unit.parked.gate");
    const inbox = buildInbox(s.facts(), CONFIG);
    expect(inbox.groups.check).toMatchObject([{ id: `stale:gh-1:${SHA("b")}`, title: "gh-1 conflicts with main in a.ts, b.ts (4 behind)", command: "norn story update-branch gh-1" }]);
    // a gate with the route: the tick classifies it, so no item
    const routed = new Sim(BASE_WF);
    routed.runUntil(at_("ready", "parked"));
    routed.base = base({ behind: 4, conflicts: ["a.ts"] });
    expect(buildInbox(routed.facts(), CONFIG).groups.check).toEqual([]);
    // not stale under conflict mode: no item
    s.base = base({ behind: 4 });
    expect(buildInbox(s.facts(), CONFIG).groups.check).toEqual([]);
  });

  test("BS10.1 (dogfood D1): no stale:* item for an ask in any step, nor while in update/resolve", () => {
    const s = new Sim(NO_ROUTE_WF);
    s.runUntil(at_("ready", "parked"));
    s.base = base({ behind: 4, conflicts: ["a.ts"] });
    const items = () => buildInbox(s.facts(), CONFIG).groups.check.filter((i) => i.id.startsWith("stale:")).map((i) => i.command);
    expect(items()).toEqual(["norn story update-branch gh-1"]);
    const gate = s.state;
    const since = at(s.now);
    // a permission prompt parks the unit (implicit ask) — in resolve, in test, anywhere: no item
    for (const step of ["resolve", "test", "update"]) {
      s.state = { ...gate, step, status: "parked", park: { kind: "ask", reason: "Allow git add?", since } };
      expect(items()).toEqual([]);
    }
    // stuck in update or resolve: the base is what they are about — no item
    for (const step of ["update", "resolve"]) {
      s.state = { ...gate, step, status: "stuck", park: { kind: "exhausted", reason: "base_conflict_loop 2/2 at update.conflict", since } };
      expect(items()).toEqual([]);
    }
    // stuck elsewhere: norn update is a way on
    s.state = { ...gate, step: "test", status: "stuck", park: { kind: "stuck", reason: "tests fail", since } };
    expect(items()).toEqual(["norn story update-branch gh-1"]);
  });

  test("6 (core): an update receipt re-enters update from $done, a gate or stuck; refused while running", () => {
    const s = new Sim(BASE_WF);
    s.runUntil(at_("ready", "parked"));
    s.approve();
    s.tick();
    expect(s.state.status).toBe("done");
    const apply = (st: UnitState, extra: Partial<Receipt> = {}) =>
      applyReceipts(st, [{ n: st.applied_through + 1, file: "", receipt: { kind: "update", receipt_id: deriveUlid("01JFFFFFFFFFFFFFFFFFFFFFFF", 1), run_id: null, step: st.step, attempt: st.attempt, at: at(), by: "human", who: "jakub@mac", from: st.step, to: "update", reason: "person", ...extra } as Receipt }], { workflow: BASE_WF, now: at() });
    const fromDone = apply(s.state);
    expect(fromDone.rejected).toEqual([]);
    expect(fromDone.state).toMatchObject({ step: "update", status: "ready" });
    expect(fromDone.advance).toEqual({ from: "$done", outcome: "update", to: "update", moved: true });
    // the merge item shows the gap and, when conflicting, sends the person to norn update
    s.pr = { number: 7, url: "https://github.com/o/r/pull/7", state: "open", is_draft: false, head_sha: SHA("h"), base_branch: "main" };
    s.base = base({ behind: 5, conflicts: ["a.ts"] });
    const merge = buildInbox(s.facts(), CONFIG).groups.your_turn[0];
    expect(merge).toMatchObject({ id: "merge:gh-1:7", command: "norn story update-branch gh-1" });
    expect(merge?.detail).toContain("behind main by 5");
    s.base = base({ behind: 5 });
    expect(buildInbox(s.facts(), CONFIG).groups.your_turn[0]).toMatchObject({ command: "gh pr merge 7", detail: "https://github.com/o/r/pull/7 · behind main by 5" });
    // running: refused
    const running = { ...s.state, step: "update", status: "running" as const } as UnitState;
    expect(apply(running).rejected[0]?.reason).toContain("update needs it done, at a gate, stuck or held by drifted skills");
    // Ready at an agent step — only when the receipt names the drifted skills that held it
    const held = { ...s.state, step: "resolve", status: "ready" as const } as UnitState;
    expect(apply(held).rejected[0]?.reason).toContain("update needs it done");
    expect(apply(held, { skills_drift: ["norn"] } as Partial<Receipt>).state).toMatchObject({ step: "update", status: "ready" });
    expect(apply({ ...held, step: "test" } as UnitState, { skills_drift: ["norn"] } as Partial<Receipt>).rejected[0]?.reason).toContain("update needs it done");
    // stuck
    expect(apply({ ...running, status: "stuck", park: { kind: "stuck", reason: "x", since: at() } } as UnitState).state).toMatchObject({ step: "update", status: "ready", park: null });
  });

  test("7 (core): update stuck (dirty worktree, diverged branch) → $stuck with the reason", () => {
    const s = new Sim(BASE_WF);
    s.base = base({ behind: 2 });
    s.git = "stuck";
    s.tick();
    s.tick();
    expect(s.state).toMatchObject({ step: "update", status: "stuck", park: { kind: "stuck", reason: "worktree dirty" } });
  });

  test("7a: resolve reports stuck (no resolution without new behaviour) → $stuck with its reason", () => {
    const s = new Sim(BASE_WF);
    s.base = base({ behind: 2, conflicts: ["a.ts"] });
    s.git = "conflict";
    s.agent = "stuck";
    s.runUntil((x) => x.state.status === "stuck");
    expect(s.state).toMatchObject({ step: "resolve", park: { kind: "stuck", reason: "a.ts: both sides need a new rule for discounts" } });
  });

  describe("ask instead of abort: the resolver may ask with the merge kept in progress", () => {
    const MERGING: GitInProgress = { operation: "merge", unmerged: ["a.ts"] };
    const resolveBrief = (s: Sim) =>
      renderBrief({
        unit: storyUnit(),
        state: s.state,
        workflow: BASE_WF,
        mode: "auto",
        runner: "herdr",
        paths: { worktree: "/w", spec_dir: "/w/spec", story_file: "/w/spec/story.md", slice_file: null, unit_dir: "/w/spec/runs/_story" },
        diff_range: null,
        handoff: null,
        receipts: s.receipts,
        limits: { deadline: "60m", nudges: 2, retries: 1, slot: null, port_base: null },
      });
    const atResolve = () => {
      const s = new Sim(BASE_WF);
      s.base = base({ behind: 2, conflicts: ["a.ts"] });
      s.git = "conflict";
      s.agent = "ask";
      return s;
    };

    test("the base-update section offers norn ask with the merge kept in progress, and keeps abort + norn stuck for a merge it cannot understand", () => {
      const s = atResolve();
      s.runUntil(at_("resolve"));
      const md = resolveBrief(s).markdown;
      const section = md.slice(md.indexOf("### Base update"));
      expect(section).toContain('`norn ask "<question>"`');
      expect(section).toMatch(/keep the merge in progress/i);
      expect(section).toContain("the files, what each side wants and the decision needed");
      expect(section).toContain("`git merge --abort`");
      expect(section).toContain('`norn stuck "<why>"`');
      expect(section).toMatch(/cannot understand/);
      // ask comes before abort: the way out that keeps the partial resolution first
      expect(section.indexOf("norn ask")).toBeLessThan(section.indexOf("git merge --abort"));
    });

    test("an answer resumes the same resolve step while the merge stays in progress", () => {
      const s = atResolve();
      s.runUntil(at_("resolve", "parked"));
      s.inProgress = MERGING;
      expect(s.state.park).toMatchObject({ kind: "ask" });
      const attempt = s.state.attempt;
      const ask = s.state.park?.receipt_id;
      s.write({ kind: "answer", receipt_id: deriveUlid("01JFFFFFFFFFFFFFFFFFFFFFFF", s.k), run_id: null, step: "resolve", attempt, at: at(s.now), by: "human", who: "jakub@mac", answer: "keep the story's cap", ...(ask ? { ask_receipt_id: ask } : {}) });
      const before = s.log.length;
      s.tick();
      expect(s.state).toMatchObject({ step: "resolve", attempt, park: null });
      s.agent = "done";
      s.moving = true;
      s.tick();
      expect(s.state).toMatchObject({ step: "resolve", attempt });
      expect(s.log.at(-1)).toBe("agent.start");
      // no new update: the merge in progress is the resolver's, left for it to conclude
      expect(s.log.slice(before)).not.toContain("git.update");
    });

    test("askingMidMerge: a unit parked at an ask with a merge in progress in its worktree, nothing else", () => {
      const s = atResolve();
      s.runUntil(at_("resolve", "parked"));
      const story = (inProgress: GitInProgress | undefined) => {
        s.inProgress = inProgress;
        return s.facts().stories[0]!;
      };
      expect(askingMidMerge(story(MERGING))?.unit.key ?? null).toBe("gh-1");
      expect(askingMidMerge(story(undefined))?.unit.key ?? null).toBe(null);
      expect(askingMidMerge(story({ operation: null, unmerged: [] }))?.unit.key ?? null).toBe(null);
      expect(askingMidMerge(story({ operation: "rebase", unmerged: [] }))?.unit.key ?? null).toBe(null);
      // a merge in progress while the resolver still runs is no ask
      const running = atResolve();
      running.agent = "done";
      running.moving = true;
      running.runUntil(at_("resolve", "running"));
      running.inProgress = MERGING;
      expect(askingMidMerge(running.facts().stories[0]!)?.unit.key ?? null).toBe(null);
    });
  });

  test("7b: PR merged into another branch → no cleanup, parked `remote: PR merged into …`; base_branch develop → update and open-pr use it", () => {
    const s = new Sim(BASE_WF);
    s.runUntil(at_("ready", "parked"));
    s.approve();
    s.tick();
    s.pr = { number: 7, url: "u", state: "merged", is_draft: false, head_sha: SHA("h"), base_branch: "release" };
    const d = s.tick();
    expect(d.rule).toBe("remote.park");
    expect(d.action).toMatchObject({ kind: "park", commit: { message: "norn: gh-1 stuck (remote: PR merged into release, not main)" } });
    expect(s.state.park).toMatchObject({ kind: "remote", reason: "remote: PR merged into release, not main" });
    expect(storyMerged(storyPhase(s.facts().stories[0] as StoryFacts, "main"))).toBeNull();
    expect(storyMerged(storyPhase({ ...(s.facts().stories[0] as StoryFacts), pr: { ...s.pr, base_branch: "main" } }, "main"))).toBe("pr");
    // a PR cached by an older norn names its target only as `base`: still read (until 0.11.0)
    const legacy = (target: string): StoryFacts["pr"] => ({ number: 7, url: "u", state: "merged", is_draft: false, head_sha: SHA("h"), base: target });
    expect(storyMerged(storyPhase({ ...(s.facts().stories[0] as StoryFacts), pr: legacy("release") }, "main"))).toBeNull();
    expect(storyMerged(storyPhase({ ...(s.facts().stories[0] as StoryFacts), pr: legacy("main") }, "main"))).toBe("pr");
    // an open PR on the wrong base is a Check item (retarget)
    s.pr = { ...s.pr, state: "open" };
    expect(buildInbox(s.facts(), CONFIG).groups.check.map((i) => i.id)).toContain("retarget:gh-1:7:release");

    // config base_branch: develop (observe puts it in repo.default_branch, BS0)
    const dev = new Sim({ ...BASE_WF, steps: { ...BASE_WF.steps, test: { type: "check", run: "x", timeout: "1m", outcomes: { pass: "open-pr" } }, "open-pr": { type: "git", action: "open-pr", outcomes: { done: "ready" } } } }, true, { default_branch: "develop" });
    dev.base = base({ ref: "refs/remotes/origin/develop", behind: 1 });
    const u = dev.tick().action as Extract<Action, { kind: "run_git" }>;
    expect(u.update).toMatchObject({ ref: "refs/remotes/origin/develop", branch: "develop", message: expect.stringContaining("from develop") });
    dev.runUntil(at_("open-pr"));
    const pr = dev.tick().action as Extract<Action, { kind: "run_git" }>;
    expect(pr.pr?.base).toBe("develop");
  });

  test("11: host-less — base ref refs/heads/<base>; cases 1–4 hold", () => {
    const s = new Sim(BASE_WF, true, { remote: "origin" });
    s.base = base({ ref: "refs/heads/main", behind: 2, conflicts: ["a.ts"] });
    s.git = "conflict";
    s.runUntil(at_("resolve"));
    expect(s.classifies().at(-1)?.base?.ref).toBe("refs/heads/main");
    s.git = "merge";
    s.runUntil(at_("ready", "parked"));
    s.base = base({ ref: "refs/heads/main", behind: 1, conflicts: ["b.ts"], sha: SHA("d") });
    expect(s.tick().rule).toBe("gate.stale");
    expect(s.state.step).toBe("update");
  });

  test("C3: base_conflict_loop with reset_on update.done — unrelated base moves never exhaust it; the reset is journaled", () => {
    const run = (wf: Workflow) => {
      const s = new Sim(wf);
      s.git = "conflict";
      s.runUntil(at_("ready", "parked"));
      // three sibling merges, each conflicting once and resolved at the first attempt
      for (const c of ["c", "d", "e"]) {
        s.base = base({ behind: 2, conflicts: ["a.ts"], sha: SHA(c) });
        expect(s.tick().rule).toBe("gate.stale");
        s.runUntil((x) => at_("ready", "parked")(x) || x.state.status === "stuck", 40);
        if (s.state.status === "stuck") break;
      }
      return s;
    };
    const plain = run(BASE_WF);
    expect(plain.state.park).toMatchObject({ kind: "exhausted", reason: "base_conflict_loop 2/2 at update.conflict" });

    const wf: Workflow = { ...BASE_WF, counters: { ...BASE_WF.counters, base_conflict_loop: { max: 2, reset_on: "update.done" } } };
    expect(validateWorkflowDefinition(wf).issues).toEqual([]);
    const s = run(wf);
    expect(s.state).toMatchObject({ step: "ready", status: "parked", counters: { base_conflict_loop: 0, stale_loop: 3 } });
    // journaled: every clean update after a conflict carries the reset in its advance (trace, commit, handoff line)
    const res = applyReceipts({ ...s.state, step: "update", status: "running", counters: { base_conflict_loop: 1, stale_loop: 0 } } as UnitState, [{ n: s.state.applied_through + 1, file: "", receipt: { kind: "classify", receipt_id: deriveUlid("01JGGGGGGGGGGGGGGGGGGGGGGG", 1), run_id: null, step: "update", attempt: s.state.attempt, at: at(), by: "norn", outcome: "done", rule: "git.update", route: "test" } }], { workflow: wf, now: at() });
    expect(res.advance).toEqual({ from: "update", outcome: "done", to: "test", reset: ["base_conflict_loop"] });
    expect(res.log.at(-1)).toContain("(reset base_conflict_loop)");
    // a repeated conflict on one base move still exhausts it
    const looping = new Sim(wf);
    looping.base = base({ behind: 4, conflicts: ["a.ts"] });
    looping.git = "conflict";
    looping.moving = true;
    looping.runUntil((x) => x.state.status === "stuck", 40);
    expect(looping.state.park).toMatchObject({ kind: "exhausted", reason: "base_conflict_loop 2/2 at update.conflict" });
    // Reset_on names a declared edge
    const bad = validateWorkflowDefinition({ ...wf, counters: { ...wf.counters, stale_loop: { max: 3, reset_on: "update.merged" } } });
    expect(bad.issues).toMatchObject([{ code: "unknown_reset", path: "/counters/stale_loop/reset_on" }]);
  });

  test("reset_on takes a list of edges: a light-path update (clean or resolved) resets the counter like done", () => {
    const wf: Workflow = {
      name: "light",
      start: "update",
      steps: {
        update: { type: "git", action: "update", outcomes: { done: "test", clean: "test", resolved: "test", conflict: { to: "resolve", counter: "base_conflict_loop" } } },
        resolve: { type: "agent", skill: "norn-merge", outcomes: { done: { to: "update", means: "merged" } } },
        test: { type: "check", run: "true", timeout: "1m", outcomes: { pass: "$done", fail: "$stuck" } },
      },
      counters: { base_conflict_loop: { max: 2, reset_on: ["update.done", "update.clean", "update.resolved"] } },
    };
    expect(validate("workflow", wf)).toMatchObject({ ok: true });
    expect(validateWorkflowDefinition(wf).issues).toEqual([]);
    for (const outcome of ["done", "clean", "resolved"]) {
      const st = { ...stateFor(storyUnit(), wf), step: "update", status: "running", counters: { base_conflict_loop: 1 } } as UnitState;
      const res = applyReceipts(st, [{ n: 1, file: "", receipt: { kind: "classify", receipt_id: deriveUlid("01JGGGGGGGGGGGGGGGGGGGGGGG", 2), run_id: null, step: "update", attempt: 1, at: at(), by: "norn", outcome, rule: "git.update", route: "test" } }], { workflow: wf, now: at() });
      expect({ outcome, advance: res.advance }).toEqual({ outcome, advance: { from: "update", outcome, to: "test", reset: ["base_conflict_loop"] } });
    }
    const bad = validateWorkflowDefinition({ ...wf, counters: { base_conflict_loop: { max: 2, reset_on: ["update.done", "update.merged"] } } });
    expect(bad.issues).toMatchObject([{ code: "unknown_reset", path: "/counters/base_conflict_loop/reset_on/1" }]);
  });

  test("no base observed → update waits", () => {
    const s = new Sim(BASE_WF);
    s.base = undefined;
    expect(s.tick().rule).toBe("git.update.no_base");
  });
});

/** BASE_WF with a merge step after ready: an approved story waits there for its PR to merge. */
const MERGE_WF: Workflow = {
  ...BASE_WF,
  name: "merging",
  steps: {
    ...BASE_WF.steps,
    ready: { type: "gate", outcomes: { approve: "merge", reject: "$stuck", stale: { to: "update", counter: "stale_loop" } } },
    merge: { type: "merge", outcomes: { stale: { to: "update", counter: "stale_loop" } } },
  },
};
const OPEN_PR: NonNullable<StoryFacts["pr"]> = { number: 7, url: "https://github.com/o/r/pull/7", state: "open", is_draft: false, head_sha: SHA("h"), base_branch: "main" };

/** A Sim approved at ready, its story waiting at the merge step with an open PR. */
function atMerge(wf: Workflow = MERGE_WF): Sim {
  const s = new Sim(wf);
  s.pr = OPEN_PR;
  s.runUntil(at_("ready", "parked"));
  s.approve();
  s.tick();
  return s;
}

describe("merge step", () => {
  test("a merge step validates with stale as its only outcome; any other outcome is refused with the reason", () => {
    expect(validateWorkflowDefinition(MERGE_WF).issues).toEqual([]);
    const other = validateWorkflowDefinition({ ...MERGE_WF, steps: { ...MERGE_WF.steps, merge: { type: "merge", outcomes: { approve: "$done", stale: { to: "update", counter: "stale_loop" } } } } });
    expect(other.ok).toBe(false);
    expect(other.issues.map((i) => i.path)).toContain("/steps/merge/outcomes/approve");
    expect(other.issues.find((i) => i.path === "/steps/merge/outcomes/approve")?.message).toContain("a merge step has only the outcome 'stale'");
    // a stale route without a counter loops forever
    const uncounted = validateWorkflowDefinition({ ...MERGE_WF, steps: { ...MERGE_WF.steps, merge: { type: "merge", outcomes: { stale: "update" } } } });
    expect(uncounted.issues.some((i) => i.code === "uncounted_cycle")).toBe(true);
  });

  test("ready approving enters the merge step, which waits for the PR: the story stays active and keeps its claim", () => {
    const s = atMerge();
    expect(s.state).toMatchObject({ step: "merge", status: "parked", park: { kind: "merge" } });
    expect(s.tick().rule).toBe("unit.parked.merge");
    const story = s.facts().stories[0] as StoryFacts;
    expect(storyPhase(story, "main")).toEqual({ phase: "active" });
  });

  test("the inbox shows exactly one item for a story at the merge step: today's merge item, never a gate item", () => {
    const s = atMerge();
    s.base = base({ behind: 2 });
    const inbox = buildInbox(s.facts(), CONFIG);
    const items = Object.values(inbox.groups).flat().filter((i) => i.story === "gh-1");
    expect(items).toMatchObject([{ id: "merge:gh-1:7", group: "your_turn", title: "Merge PR #7", command: "gh pr merge 7", detail: "https://github.com/o/r/pull/7 · behind main by 2", url: OPEN_PR.url }]);
    // a draft PR keeps today's draft note
    s.pr = { ...OPEN_PR, is_draft: true };
    expect(buildInbox(s.facts(), CONFIG).groups.your_turn[0]).toMatchObject({ title: "Merge PR #7 (still a draft)", detail: expect.stringContaining("draft: mark it ready first (gh pr ready 7)") });
  });

  test("the PR merging ends the story through today's merge path; a PR closed unmerged parks it as today", () => {
    const merged = atMerge();
    merged.pr = { ...OPEN_PR, state: "merged", merged_at: at(merged.now) };
    const d = merged.tick();
    expect(d.rule).toBe("remote.pr_merged");
    expect(d.action).toMatchObject({ kind: "cleanup_merged_story", story_status: "done", finish: [{ state: { step: "$done", status: "done" } }] });

    const closed = atMerge();
    closed.pr = { ...OPEN_PR, state: "closed" };
    const c = closed.tick();
    expect(c.rule).toBe("remote.park");
    expect(closed.state).toMatchObject({ status: "stuck", park: { kind: "remote", reason: "remote: PR closed unmerged" } });
  });

  test("a stale base move sends a story at the merge step back to update through stale_loop, after a sync shows the PR", () => {
    const s = atMerge();
    s.base = base({ behind: 3, conflicts: ["a.ts"], sha: SHA("c") });
    const d = s.tick();
    expect(d.rule).toBe("gate.stale");
    expect(s.classifies().at(-1)).toMatchObject({ outcome: "stale", step: "merge", route: "update", detail: "3 behind, conflicts: a.ts" });
    expect(s.state).toMatchObject({ step: "update", status: "ready", counters: { stale_loop: 1 } });
    // back through update and ready, into the merge step again
    s.runUntil(at_("ready", "parked"));
    s.approve();
    s.tick();
    expect(s.state).toMatchObject({ step: "merge", status: "parked" });

    // between syncs, a moved base may be the story's own squash-merged PR: wait for a sync
    const t = atMerge({ ...MERGE_WF, base: { stale: "behind" } });
    t.pr = undefined;
    t.prSeen = { pr: OPEN_PR, observed_at: T0 };
    t.base = base({ behind: 1, sha: SHA("c") });
    expect(t.tick().rule).toBe("gate.stale.awaits_sync");
    t.pr = { ...OPEN_PR, state: "merged", merged_at: at(t.now) };
    expect(t.tick().rule).toBe("remote.pr_merged");

    // a counter at its max stops the loop
    const u = atMerge({ ...MERGE_WF, counters: { ...MERGE_WF.counters, stale_loop: { max: 1 } } });
    u.base = base({ behind: 3, conflicts: ["a.ts"], sha: SHA("c") });
    u.tick();
    u.runUntil(at_("ready", "parked"));
    u.approve();
    u.tick();
    u.base = base({ behind: 3, conflicts: ["b.ts"], sha: SHA("d") });
    u.tick();
    u.tick();
    expect(u.state).toMatchObject({ status: "stuck", park: { kind: "exhausted", reason: "stale_loop 1/1 at merge.stale" } });
  });

  test("nothing at the merge step can be approved or rejected", () => {
    const s = atMerge();
    for (const kind of ["approve", "reject"] as const) {
      const res = applyReceipts(s.state, [{ n: s.state.applied_through + 1, file: "", receipt: { kind, receipt_id: deriveUlid("01JEEEEEEEEEEEEEEEEEEEEEEE", 9), run_id: null, step: "merge", attempt: s.state.attempt, at: at(), by: "human", who: "jakub@mac" } }], { workflow: MERGE_WF, now: at() });
      expect(res.rejected[0]?.reason).toBe("merge is not a gate waiting for a decision");
      expect(res.state).toMatchObject({ step: "merge", status: "parked" });
    }
  });

  test("story update-branch brings the base in for a story waiting at the merge step", () => {
    const s = atMerge();
    const res = applyReceipts(s.state, [{ n: s.state.applied_through + 1, file: "", receipt: { kind: "update", receipt_id: deriveUlid("01JFFFFFFFFFFFFFFFFFFFFFFF", 1), run_id: null, step: "merge", attempt: s.state.attempt, at: at(), by: "human", who: "jakub@mac", from: "merge", to: "update", reason: "person" } as Receipt }], { workflow: MERGE_WF, now: at() });
    expect(res.rejected).toEqual([]);
    expect(res.state).toMatchObject({ step: "update", status: "ready" });
  });
});
