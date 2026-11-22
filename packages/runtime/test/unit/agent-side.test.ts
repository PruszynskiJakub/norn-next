import { describe, expect, test } from "bun:test";
import { claudeHarness } from "@norn/harness-claude";
import { markPrompt, ok, RUN_ENV, type VcsConflictMarker } from "@norn/plugin-api";
import {
  type AgentRunRequest,
  batchesDir,
  batchName,
  briefOf,
  claimHeldElsewhere,
  EventLogSessionSource,
  ingestHook,
  type IngestDeps,
  MAX_STOP_BLOCKS,
  queueInjection,
  readEvents,
  recordSentPrompt,
  reportRun,
  writeStoryDoc,
  WRITES_ENV,
} from "../../src/index.ts";
import { has, harness, type Harnessed, record, type Report, rulesOf, session, tickUntil, trackerItem } from "./support.ts";

const UNIT = "lt-1";
const WORKTREE = "/machine/repo/worktrees/lt-1";

/** A story at its agent step with the run started and on the record. */
async function running(formerHolders?: string[], workflow = "agented"): Promise<{ h: Harnessed; runId: string }> {
  const h = harness({ workflow, ...(formerHolders && { formerHolders }) });
  h.items.push(trackerItem(1));
  await tickUntil(h, has("agent.start"));
  await tickUntil(h, has("receipts.apply"));
  const runId = (await record(h, UNIT)).state?.run?.id;
  if (!runId) throw new Error("no run started");
  return { h, runId };
}

function deps(h: Harnessed, over: Partial<IngestDeps> = {}): IngestDeps {
  return { ctx: h.ctx, harnesses: { claude: claudeHarness }, journal: h.env.journal, worktreeOf: () => WORKTREE, writableRoots: ["/tmp"], ...over };
}

const env = (runId: string) => ({ [RUN_ENV.unit]: UNIT, [RUN_ENV.run]: runId });

async function hook(h: Harnessed, runId: string, name: string, payload: Record<string, unknown>, over: Partial<IngestDeps> = {}) {
  const r = await ingestHook(deps(h, over), { harness: "claude", hook: name, payload: { hook_event_name: name, session_id: "s1", ...payload }, env: env(runId) });
  await r.delivered();
  return r;
}

const preWrite = (path: string) => ({ tool_use_id: `t-${path}`, tool_name: "Write", tool_input: { file_path: path, content: "x" } });

describe("stop hook", () => {
  test("a turn ending before the run reports is blocked with how to report; after the report it is allowed", async () => {
    const { h, runId } = await running();
    const blocked = await hook(h, runId, "Stop", {});
    const out = JSON.parse(blocked.reply.stdout);
    expect(out.decision).toBe("block");
    expect(out.reason).toContain("norn done <done>");
    expect(out.reason).toContain("norn ask");
    expect(out.reason).toContain("norn stuck");
    expect(blocked.problems).toEqual([]);

    const reported = await reportRun(h.env, UNIT, runId, { verb: "done", outcome: "done", text: "built" }, "r1");
    expect(reported.ok).toBe(true);
    const allowed = await hook(h, runId, "Stop", {});
    expect(allowed.reply).toEqual({ stdout: "", exit_code: 0 });
  });

  test("a run that never reports is blocked at most MAX_STOP_BLOCKS times; the next turn end is allowed and reads as ended", async () => {
    const { h, runId } = await running();
    for (let i = 0; i < MAX_STOP_BLOCKS; i++) expect(JSON.parse((await hook(h, runId, "Stop", { stop_hook_active: i > 0 })).reply.stdout).decision).toBe("block");
    const past = await hook(h, runId, "Stop", { stop_hook_active: true });
    expect(past.reply).toEqual({ stdout: "", exit_code: 0 });
    expect(past.problems).toEqual([]);
    expect((await hook(h, runId, "Stop", {})).reply).toEqual({ stdout: "", exit_code: 0 });
    // the allowed turn end reaches the session facts, so decide's nudges and retries take over
    const facts = await new EventLogSessionSource({ ctx: h.ctx, classify: { silentAfterMs: 60_000 } }).facts(UNIT, runId);
    expect(facts?.activity).toBe("turn_ended");
  });

  test("past the cap a queued nudge still rides on a stop block, once, without the report demand", async () => {
    const { h, runId } = await running();
    for (let i = 0; i < MAX_STOP_BLOCKS; i++) await hook(h, runId, "Stop", {});
    await queueInjection(h.ctx, UNIT, runId, { id: "n1", source: "nudge", text: "norn: carry on", at: h.ctx.now() });
    const carried = JSON.parse((await hook(h, runId, "Stop", {})).reply.stdout);
    expect([carried.decision, carried.reason]).toEqual(["block", "norn: carry on"]);
    expect((await hook(h, runId, "Stop", {})).reply.stdout).toBe("");
  });

  test("a report whose receipt the kernel rejected does not let the turn end unreported", async () => {
    const { h, runId } = await running();
    const reported = await reportRun(h.env, UNIT, runId, { verb: "done", outcome: "done" }, "r1");
    if (!reported.ok) throw new Error(reported.refusal.error);
    expect((await hook(h, runId, "Stop", {})).reply.stdout).toBe("");
    // the report.made event stays in the log; the record says the report does not stand
    await h.env.journal.record(UNIT, { id: "reject-r1", data: { kind: "receipt.rejected", seq: reported.value.seq, reason: "test: refused" } });
    expect(JSON.parse((await hook(h, runId, "Stop", {})).reply.stdout).decision).toBe("block");
  });

  test("a hook from a run that is no longer live is never held to a report", async () => {
    const { h } = await running();
    const r = await hook(h, "01JOLDRUN00000000000000000", "Stop", {});
    expect(r.reply.stdout).toBe("");
  });

  test("a session norn did not launch is answered allow and leaves no trace", async () => {
    const { h } = await running();
    const before = h.files.snapshot();
    const r = await ingestHook(deps(h), { harness: "claude", hook: "Stop", payload: { hook_event_name: "Stop" }, env: {} });
    expect(r.reply.stdout).toBe("");
    expect(h.files.snapshot()).toEqual(before);
  });

  test("a run whose story's claim another holder took may end its turn: it owes this machine no report", async () => {
    const { h, runId } = await running();
    const held = await h.env.slots.store.claims.read(UNIT);
    await h.env.slots.store.claims.takeOver?.(UNIT, "machine-b", 60 * 60_000, held.ok && held.value ? held.value.version : null);
    expect(await reportRun(h.env, UNIT, runId, { verb: "done", outcome: "done" }, "r1")).toMatchObject({ ok: false, refusal: { code: "claim_moved", do_instead: expect.stringContaining("end your turn") } });
    const r = await hook(h, runId, "Stop", {}, { claimMoved: async (unit) => (await claimHeldElsewhere(h.env, unit)) !== null });
    expect(r.reply).toEqual({ stdout: "", exit_code: 0 });
  });

  test("a stop it refused is a turn that goes on: the session does not read as a turn ended, so it is not nudged as quiet", async () => {
    const { h, runId } = await running();
    expect(JSON.parse((await hook(h, runId, "Stop", {})).reply.stdout).decision).toBe("block");
    const facts = await new EventLogSessionSource({ ctx: h.ctx, classify: { silentAfterMs: 60_000 } }).facts(UNIT, runId);
    expect(facts?.activity).not.toBe("turn_ended");
  });

  test("a nudge queued before the run reported does not block the stop after it", async () => {
    const { h, runId } = await running();
    await queueInjection(h.ctx, UNIT, runId, { id: "n1", source: "nudge", text: "norn: your turn ended without a report", at: h.ctx.now() });
    expect((await reportRun(h.env, UNIT, runId, { verb: "done", outcome: "done" }, "r1")).ok).toBe(true);
    expect((await hook(h, runId, "Stop", {})).reply).toEqual({ stdout: "", exit_code: 0 });
  });

  test("a queued nudge rides on the stop block and is delivered once", async () => {
    const { h, runId } = await running();
    await queueInjection(h.ctx, UNIT, runId, { id: "n1", source: "nudge", text: "norn: carry on", at: h.ctx.now() });
    const first = JSON.parse((await hook(h, runId, "Stop", {})).reply.stdout);
    expect(first.reason).toContain("norn: carry on");
    const second = JSON.parse((await hook(h, runId, "Stop", {})).reply.stdout);
    expect(second.reason).not.toContain("norn: carry on");
  });
});

describe("guard hook", () => {
  test("a write outside the worktree is denied", async () => {
    const { h, runId } = await running();
    const out = JSON.parse((await hook(h, runId, "PreToolUse", preWrite("/repo/src/x.ts"))).reply.stdout);
    expect(out.hookSpecificOutput).toMatchObject({ permissionDecision: "deny" });
    expect(out.hookSpecificOutput.permissionDecisionReason).toContain("outside this unit's worktree");
  });

  test("a write that climbs out of the worktree with .. is denied", async () => {
    const { h, runId } = await running();
    const out = JSON.parse((await hook(h, runId, "PreToolUse", preWrite("src/../../lt-2/x.ts"))).reply.stdout);
    expect(out.hookSpecificOutput.permissionDecision).toBe("deny");
  });

  test("a write to norn's run state is denied as run state", async () => {
    const { h, runId } = await running();
    const out = JSON.parse((await hook(h, runId, "PreToolUse", preWrite("/machine/repo/store/units/lt-1/state.json"))).reply.stdout);
    expect(out.hookSpecificOutput.permissionDecisionReason).toContain("run state");
  });

  test("a write through a symlink in the worktree that points into run state is denied as run state", async () => {
    const { h, runId } = await running();
    await h.files.symlink("/machine/repo/store", `${WORKTREE}/state-link`);
    for (const p of ["state-link/units/lt-1/state.json", `${WORKTREE}/state-link/units/lt-1/state.json`]) {
      const out = JSON.parse((await hook(h, runId, "PreToolUse", preWrite(p))).reply.stdout);
      expect({ p, decision: out.hookSpecificOutput.permissionDecision, reason: out.hookSpecificOutput.permissionDecisionReason }).toMatchObject({ p, decision: "deny", reason: expect.stringContaining("run state") });
    }
  });

  test("a relative symlink target is followed, and a link that stays in the worktree is allowed", async () => {
    const { h, runId } = await running();
    await h.files.symlink("src", `${WORKTREE}/lib`);
    await h.files.symlink("../../store/units", `${WORKTREE}/up`);
    expect((await hook(h, runId, "PreToolUse", preWrite("lib/x.ts"))).reply.stdout).toBe("");
    const out = JSON.parse((await hook(h, runId, "PreToolUse", preWrite("up/lt-1/state.json"))).reply.stdout);
    expect(out.hookSpecificOutput.permissionDecisionReason).toContain("run state");
  });

  test("a write inside the worktree, relative or absolute, or under a writable root, is allowed", async () => {
    const { h, runId } = await running();
    for (const p of ["src/x.ts", `${WORKTREE}/README.md`, "/tmp/criteria.json"]) expect({ p, out: (await hook(h, runId, "PreToolUse", preWrite(p))).reply.stdout }).toEqual({ p, out: "" });
  });

  test("a shell call is not judged here", async () => {
    const { h, runId } = await running();
    const r = await hook(h, runId, "PreToolUse", { tool_use_id: "b1", tool_name: "Bash", tool_input: { command: "echo hi > /etc/x" } });
    expect(r.reply.stdout).toBe("");
  });
});

describe("guard hook on a docs-only step", () => {
  const docsOnly = () => running(undefined, "reviewed");
  const reasonOf = (r: { reply: { stdout: string } }) => (r.reply.stdout === "" ? null : JSON.parse(r.reply.stdout).hookSpecificOutput);

  test("its run is launched as docs-only, so a launcher can refuse an executor that cannot guard it", async () => {
    const { h } = await docsOnly();
    const start = h.launcher.calls.find((c) => c.op === "start")?.args[0] as AgentRunRequest | undefined;
    expect(start?.writes).toBe("docs");
  });

  test("a write to the story's documents or the run's reports, relative or absolute, or under a writable root, is allowed", async () => {
    const { h, runId } = await docsOnly();
    for (const p of [".agents/specs/lt-1/handoffs/story.md", `${WORKTREE}/.agents/specs/lt-1/spec.md`, ".agents/specs/lt-1/slices/01-a.md", ".agents/run/out/findings.json", `${WORKTREE}/.agents/run/out/evidence/a.txt`, "/tmp/findings.json"])
      expect({ p, out: reasonOf(await hook(h, runId, "PreToolUse", preWrite(p))) }).toEqual({ p, out: null });
  });

  test("a write to code in the worktree is denied: the step is docs-only, and the reason says to hand back findings instead", async () => {
    const { h, runId } = await docsOnly();
    for (const p of ["src/x.ts", `${WORKTREE}/README.md`, ".agents/specs/lt-2/spec.md", ".agents/specs/lt-1/../../../src/x.ts", ".agents/run/in/last_check.md"]) {
      const out = reasonOf(await hook(h, runId, "PreToolUse", preWrite(p)));
      expect({ p, decision: out?.permissionDecision }).toEqual({ p, decision: "deny" });
      expect(out.permissionDecisionReason).toContain("writes: docs");
      expect(out.permissionDecisionReason).toContain("norn done");
      expect(out.permissionDecisionReason).toContain("$NORN_OUT/findings.json");
    }
  });

  test("a link in the spec folder that carries a write into the code is denied", async () => {
    const { h, runId } = await docsOnly();
    await h.files.symlink("../../../src", `${WORKTREE}/.agents/specs/lt-1/code`);
    const out = reasonOf(await hook(h, runId, "PreToolUse", preWrite(".agents/specs/lt-1/code/x.ts")));
    expect(out?.permissionDecision).toBe("deny");
    expect(out.permissionDecisionReason).toContain("writes: docs");
  });

  test("outside the worktree and in run state, the rules of every step still hold", async () => {
    const { h, runId } = await docsOnly();
    expect(reasonOf(await hook(h, runId, "PreToolUse", preWrite("/repo/src/x.ts")))?.permissionDecisionReason).toContain("outside this unit's worktree");
    expect(reasonOf(await hook(h, runId, "PreToolUse", preWrite("/machine/repo/store/units/lt-1/state.json")))?.permissionDecisionReason).toContain("run state");
  });

  test("with the record unreadable or corrupt, the guard holds the step's writes from the launch env: a write to code is still denied", async () => {
    const { h, runId } = await docsOnly();
    const unreadable = { ...h.env.journal, readUnit: async () => ({ ok: false, failure: { code: "unavailable", message: "store down", retryable: true } }) } as unknown as IngestDeps["journal"];
    const corrupt = {
      ...h.env.journal,
      readUnit: async (u: string) => {
        const r = await h.env.journal.readUnit(u);
        return r.ok ? { ok: true, value: { ...r.value, corrupt: "state.json fails its schema" } } : r;
      },
    } as unknown as IngestDeps["journal"];
    for (const journal of [unreadable, corrupt]) {
      const r = await ingestHook(deps(h, { journal }), { harness: "claude", hook: "PreToolUse", payload: { hook_event_name: "PreToolUse", session_id: "s1", ...preWrite("src/x.ts") }, env: { ...env(runId), [WRITES_ENV]: "docs" } });
      await r.delivered();
      expect(reasonOf(r)?.permissionDecision).toBe("deny");
      expect(reasonOf(r).permissionDecisionReason).toContain("writes: docs");
      const doc = await ingestHook(deps(h, { journal }), { harness: "claude", hook: "PreToolUse", payload: { hook_event_name: "PreToolUse", session_id: "s1", ...preWrite(".agents/specs/lt-1/spec.md") }, env: { ...env(runId), [WRITES_ENV]: "docs" } });
      await doc.delivered();
      expect(reasonOf(doc)).toBeNull();
    }
  });

  test("a shell call is not judged, as on every step", async () => {
    const { h, runId } = await docsOnly();
    expect((await hook(h, runId, "PreToolUse", { tool_use_id: "b1", tool_name: "Bash", tool_input: { command: "echo hi > src/x.ts" } })).reply.stdout).toBe("");
  });
});

describe("context and prompt marks", () => {
  test("a pending answer is delivered as context at the next prompt and closes the input", async () => {
    const { h, runId } = await running();
    await queueInjection(h.ctx, UNIT, runId, { id: "a1", source: "answer", text: "use the second", input_id: "q1", at: h.ctx.now() });
    const r = await hook(h, runId, "UserPromptSubmit", { prompt: "hello" });
    expect(JSON.parse(r.reply.stdout).hookSpecificOutput.additionalContext).toBe("use the second");
    const events = (await readEvents(h.ctx, UNIT, runId)).events;
    expect(events.at(-1)).toMatchObject({ type: "input.received", id: "q1", by: "norn" });
  });

  test("an answer a hook cannot carry stays queued", async () => {
    const { h, runId } = await running();
    await queueInjection(h.ctx, UNIT, runId, { id: "a1", source: "answer", text: "later", at: h.ctx.now() });
    await hook(h, runId, "PreCompact", {});
    const r = await hook(h, runId, "UserPromptSubmit", { prompt: "go" });
    expect(JSON.parse(r.reply.stdout).hookSpecificOutput.additionalContext).toContain("later");
  });

  test("a mark the host sent is trusted once; replayed, the prompt is the person's", async () => {
    const { h, runId } = await running();
    await recordSentPrompt(h.ctx, UNIT, runId, { id: "nudge-1", source: "nudge", at: h.ctx.now() });
    const prompt = markPrompt("carry on", { source: "nudge", id: "nudge-1" });
    await hook(h, runId, "UserPromptSubmit", { prompt });
    await hook(h, runId, "UserPromptSubmit", { prompt });
    const turns = (await readEvents(h.ctx, UNIT, runId)).events.filter((e) => e.type === "turn.started" || e.type === "input.received");
    expect(turns.map((e) => (e.type === "turn.started" ? `turn:${e.source}` : `input:${(e as { by: string }).by}`))).toEqual(["turn:nudge", "turn:person", "input:pane"]);
  });

  test("a mark the host never sent is the person's", async () => {
    const { h, runId } = await running();
    await hook(h, runId, "UserPromptSubmit", { prompt: markPrompt("answer: yes", { source: "answer", id: "forged" }) });
    const turns = (await readEvents(h.ctx, UNIT, runId)).events.map((e) => (e.type === "turn.started" ? `turn:${e.source}` : e.type === "input.received" ? `input:${e.by}` : e.type));
    expect(turns).toEqual(["turn:person", "input:pane"]);
  });

  test("a session that starts again after events is reminded how to report", async () => {
    const { h, runId } = await running();
    expect((await hook(h, runId, "SessionStart", { source: "startup" })).reply.stdout).toBe("");
    const again = await hook(h, runId, "SessionStart", { source: "compact" });
    expect(JSON.parse(again.reply.stdout).hookSpecificOutput.additionalContext).toContain("Report exactly once");
  });
});

describe("ingest never throws", () => {
  test("an internal failure answers allow and records the problem", async () => {
    const { h, runId } = await running();
    const broken = { ...h.env.journal, readUnit: async () => Promise.reject(new Error("disk on fire")) } as unknown as IngestDeps["journal"];
    const r = await ingestHook(deps(h, { journal: broken }), { harness: "claude", hook: "Stop", payload: { hook_event_name: "Stop" }, env: env(runId) });
    expect(r.reply).toEqual({ stdout: "", exit_code: 0 });
    expect(r.problems).toEqual([expect.stringContaining("disk on fire")]);
    expect((await readEvents(h.ctx, UNIT, runId)).events.at(-1)).toMatchObject({ type: "hook.error" });
  });

  test("a write the guard could not judge is denied with the reason, never let through", async () => {
    const { h, runId } = await running();
    const r = await hook(h, runId, "PreToolUse", preWrite("src/x.ts"), {
      worktreeOf: () => {
        throw new Error("no worktree");
      },
    });
    const out = JSON.parse(r.reply.stdout);
    expect(out.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(out.hookSpecificOutput.permissionDecisionReason).toContain("was not checked");
    expect(r.problems).toEqual([expect.stringContaining("no worktree")]);
  });

  test("a write is denied even when the failure came before the hook was read, and a shell call is still allowed", async () => {
    const { h, runId } = await running();
    const broken = { ...h.files, list: async () => Promise.reject(new Error("disk on fire")) };
    const ctx = { ...h.ctx, files: broken };
    const write = await hook(h, runId, "PreToolUse", preWrite("src/x.ts"), { ctx });
    expect(JSON.parse(write.reply.stdout).hookSpecificOutput.permissionDecision).toBe("deny");
    const shell = await hook(h, runId, "PreToolUse", { tool_use_id: "b1", tool_name: "Bash", tool_input: { command: "ls" } }, { ctx });
    expect(shell.reply.stdout).toBe("");
    expect(shell.problems).toEqual([expect.stringContaining("disk on fire")]);
  });

  test("an unknown harness answers nothing and says why", async () => {
    const { h, runId } = await running();
    const r = await ingestHook(deps(h), { harness: "nope", hook: "Stop", payload: {}, env: env(runId) });
    expect(r.reply).toEqual({ stdout: "", exit_code: 0 });
    expect(r.problems).toEqual(["no harness named nope"]);
  });

  test("a corrupt event file is a problem, and the hook still answers", async () => {
    const { h, runId } = await running();
    await h.files.write(`${batchesDir(h.ctx, UNIT, runId)}/${batchName(0)}`, "{");
    const r = await hook(h, runId, "Stop", {});
    expect(JSON.parse(r.reply.stdout).decision).toBe("block");
    expect(r.problems).toEqual([expect.stringContaining(batchName(0))]);
  });
});

describe("reporting", () => {
  test("a report writes run.reported for the live run and a report.made event, and the next tick applies it", async () => {
    const { h, runId } = await running();
    const r = await reportRun(h.env, UNIT, runId, { verb: "done", outcome: "done", text: " built " }, "r1");
    expect(r).toMatchObject({ ok: true, value: { replayed: false } });
    const last = (await record(h, UNIT)).receipts.at(-1);
    expect(last).toMatchObject({ id: "report-r1", data: { kind: "run.reported", run_id: runId, verb: "done", outcome: "done", text: "built", step: "build", attempt: 1 } });
    expect((await readEvents(h.ctx, UNIT, runId)).events.at(-1)).toMatchObject({ type: "report.made", verb: "done", outcome: "done" });
    const facts = await new EventLogSessionSource({ ctx: h.ctx, classify: { silentAfterMs: 60_000 } }).facts(UNIT, runId);
    expect(facts?.activity).toBe("reported");
    await tickUntil(h, has("receipts.apply"));
    expect((await record(h, UNIT)).state?.ended).toBe("done");
  });

  test("a report that lands between a tick's read of the record and of the session is applied from its own receipt, text and all, and recorded once", async () => {
    const { h, runId } = await running();
    // the agent's report lands after this tick read the unit's record and before it reads the session
    const read = h.sessions.facts.bind(h.sessions);
    let landed = false;
    h.sessions.facts = async (unit: string) => {
      if (unit === UNIT && !landed) {
        landed = true;
        const r = await reportRun(h.env, UNIT, runId, { verb: "ask", question: "which db?" }, "r1");
        if (!r.ok) throw new Error(r.refusal.error);
        h.sessions.byUnit.set(UNIT, session("reported", { report: { verb: "ask" } }));
      }
      return read(unit);
    };
    const [raced] = await tickUntil(h, () => true, 1);
    expect(landed).toBe(true);
    expect(rulesOf(raced as Report).filter((r) => r.startsWith(UNIT))).toEqual([`${UNIT} agent.reporting`]);
    await tickUntil(h, async () => (await record(h, UNIT)).state?.parked !== undefined);
    const after = await record(h, UNIT);
    expect(after.receipts.filter((x) => x.data.kind === "run.reported").map((x) => x.id)).toEqual(["report-r1"]);
    expect(after.state?.parked).toMatchObject({ text: "which db?" });
  });

  test("a report whose receipt the kernel refused parks the unit with the refusal and writes no report of its own", async () => {
    const { h, runId } = await running();
    // an outcome the step does not route, as a report recorded before its workflow changed would carry
    await h.env.journal.record(UNIT, { id: "report-r1", data: { kind: "run.reported", run_id: runId, verb: "done", outcome: "bogus", text: "built", step: "build", attempt: 1 } });
    h.sessions.byUnit.set(UNIT, session("reported", { report: { verb: "done", outcome: "bogus" } }));
    await tickUntil(h, has("agent.reported.rejected"));
    const after = await record(h, UNIT);
    expect(after.state?.parked?.reason).toBe("agent.reported.rejected");
    expect(after.receipts.filter((x) => x.data.kind === "run.reported").map((x) => x.id)).toEqual(["report-r1"]);
    expect((await tickUntil(h, () => true, 1)).flatMap(rulesOf).filter((r) => r.startsWith(UNIT))).toEqual([`${UNIT} unit.parked`]);
  });

  test("a report is idempotent by its report id", async () => {
    const { h, runId } = await running();
    const first = await reportRun(h.env, UNIT, runId, { verb: "done", outcome: "done" }, "r1");
    const again = await reportRun(h.env, UNIT, runId, { verb: "done", outcome: "done" }, "r1");
    expect(first.ok && again.ok && again.value).toEqual({ seq: first.ok ? first.value.seq : -1, replayed: true });
    expect((await record(h, UNIT)).receipts.filter((x) => x.data.kind === "run.reported")).toHaveLength(1);
    expect((await readEvents(h.ctx, UNIT, runId)).events.filter((e) => e.type === "report.made")).toHaveLength(1);
  });

  test("a second report under another id is refused", async () => {
    const { h, runId } = await running();
    await reportRun(h.env, UNIT, runId, { verb: "done", outcome: "done" }, "r1");
    expect(await reportRun(h.env, UNIT, runId, { verb: "stuck", reason: "x" }, "r2")).toMatchObject({ ok: false, refusal: { code: "reported" } });
  });

  test("a report for a run that is not live is refused", async () => {
    const { h } = await running();
    const r = await reportRun(h.env, UNIT, "01JOLDRUN00000000000000000", { verb: "done", outcome: "done" }, "r1");
    expect(r).toMatchObject({ ok: false, refusal: { code: "stale_run", error: expect.stringContaining("not the live run"), do_instead: expect.any(String) } });
    expect((await record(h, UNIT)).receipts.some((x) => x.data.kind === "run.reported")).toBe(false);
  });

  test("a report from a run whose story's claim another holder took is dropped on this machine, every verb, with why in the run's log", async () => {
    const { h, runId } = await running();
    const takeOver = h.env.slots.store.claims.takeOver;
    if (!takeOver) throw new Error("store-local offers takeovers");
    const held = await h.env.slots.store.claims.read(UNIT);
    await takeOver(UNIT, "machine-b", 60 * 60_000, held.ok && held.value ? held.value.version : null);
    for (const req of [{ verb: "done", outcome: "done" }, { verb: "ask", question: "Why?" }, { verb: "stuck", reason: "lost" }] as const) {
      const r = await reportRun(h.env, UNIT, runId, req, `r-${req.verb}`);
      expect(r).toMatchObject({ ok: false, refusal: { code: "claim_moved", error: expect.stringContaining("moved from machine-a to machine-b"), do_instead: expect.stringContaining("machine-b carries lt-1 on") } });
    }
    expect((await record(h, UNIT)).receipts.some((x) => x.data.kind === "run.reported")).toBe(false);
    const logged = (await readEvents(h.ctx, UNIT, runId)).events.filter((e) => e.type === "hook.error");
    expect(logged).toHaveLength(3);
    expect(logged[0]).toMatchObject({ hook: "report", message: expect.stringContaining(`the report of run ${runId} was dropped`) });
  });

  test("a claim held under a name this machine used before is its own: the report goes through, and the next tick carries the claim to its current name", async () => {
    const { h, runId } = await running(["machine-a.home"]);
    const held = await h.env.slots.store.claims.read(UNIT);
    await h.env.slots.store.claims.takeOver?.(UNIT, "machine-a.home", 60 * 60_000, held.ok && held.value ? held.value.version : null);
    expect(await claimHeldElsewhere(h.env, UNIT)).toBeNull();
    expect(await reportRun(h.env, UNIT, runId, { verb: "done", outcome: "done" }, "r1")).toMatchObject({ ok: true });
    await h.runtime.tick();
    const after = await h.env.slots.store.claims.read(UNIT);
    expect(after.ok && after.value?.holder).toBe("machine-a");
    expect((await record(h, UNIT)).state?.ended).toBe("done");
  });

  test("another machine's claim is never this machine's, whatever names it used before", async () => {
    const { h, runId } = await running(["machine-a.home"]);
    const held = await h.env.slots.store.claims.read(UNIT);
    await h.env.slots.store.claims.takeOver?.(UNIT, "machine-b", 60 * 60_000, held.ok && held.value ? held.value.version : null);
    expect(await claimHeldElsewhere(h.env, UNIT)).toBe("machine-b");
    expect(await reportRun(h.env, UNIT, runId, { verb: "done", outcome: "done" }, "r1")).toMatchObject({ ok: false, refusal: { code: "claim_moved" } });
    await h.runtime.tick();
    const after = await h.env.slots.store.claims.read(UNIT);
    expect(after.ok && after.value?.holder).toBe("machine-b");
  });

  test("an outcome the step does not route is refused, naming the ones it does", async () => {
    const { h, runId } = await running();
    const r = await reportRun(h.env, UNIT, runId, { verb: "done", outcome: "shipped" }, "r1");
    expect(r).toMatchObject({ ok: false, refusal: { code: "outcome", do_instead: expect.stringContaining("`done`") } });
    const classified = await reportRun(h.env, UNIT, runId, { verb: "done", outcome: "died" }, "r2");
    expect(classified.ok).toBe(false);
  });

  test("a done while a merge waits to be concluded in the worktree is refused and records nothing; ask and stuck still go through", async () => {
    const { h, runId } = await running();
    h.stopped[WORKTREE] = { operation: "merge", unmerged: ["a.txt"] };
    const r = await reportRun(h.env, UNIT, runId, { verb: "done", outcome: "done" }, "r1");
    expect(r).toMatchObject({ ok: false, refusal: { code: "merge_unfinished", error: expect.stringContaining("unmerged: a.txt"), do_instead: expect.stringContaining("git commit") } });
    expect((await record(h, UNIT)).receipts.some((x) => x.data.kind === "run.reported")).toBe(false);
    // resolved but not concluded is still unfinished
    h.stopped[WORKTREE] = { operation: "merge", unmerged: [] };
    expect(await reportRun(h.env, UNIT, runId, { verb: "done", outcome: "done" }, "r2")).toMatchObject({ ok: false, refusal: { code: "merge_unfinished" } });
    expect(await reportRun(h.env, UNIT, runId, { verb: "ask", question: "keep both sides of a.txt?" }, "r3")).toMatchObject({ ok: true });
  });

  test("a stuck mid-merge is recorded, and a done after the merge is concluded goes through", async () => {
    const stuck = await running();
    stuck.h.stopped[WORKTREE] = { operation: "merge", unmerged: ["a.txt"] };
    expect(await reportRun(stuck.h.env, UNIT, stuck.runId, { verb: "stuck", reason: "cannot tell which side wins" }, "r1")).toMatchObject({ ok: true });
    const { h, runId } = await running();
    h.stopped[WORKTREE] = { operation: "merge", unmerged: [] };
    expect((await reportRun(h.env, UNIT, runId, { verb: "done", outcome: "done" }, "r1")).ok).toBe(false);
    delete h.stopped[WORKTREE];
    expect(await reportRun(h.env, UNIT, runId, { verb: "done", outcome: "done" }, "r1")).toMatchObject({ ok: true, value: { replayed: false } });
  });

  test("a done while the worktree holds uncommitted work is refused, naming the paths and records nothing; ask and stuck still go through", async () => {
    const { h, runId } = await running();
    h.dirty[WORKTREE] = ["src/a.ts", "src/b.ts"];
    const r = await reportRun(h.env, UNIT, runId, { verb: "done", outcome: "done" }, "r1");
    expect(r).toMatchObject({
      ok: false,
      refusal: { code: "dirty_worktree", error: expect.stringContaining("src/a.ts, src/b.ts"), do_instead: expect.stringMatching(/git status.*commit/) },
    });
    expect((await record(h, UNIT)).receipts.some((x) => x.data.kind === "run.reported")).toBe(false);
    expect(await reportRun(h.env, UNIT, runId, { verb: "ask", question: "keep src/a.ts?" }, "r2")).toMatchObject({ ok: true });
  });

  test("norn's own files in the worktree (the run folder and the story's spec folder) never count as uncommitted work", async () => {
    const { h, runId } = await running();
    h.dirty[WORKTREE] = [".agents/run/in/last_check.md", ".agents/run/out/notes.txt", ".agents/run/.base/specs/lt-1/spec.md", `.agents/specs/${UNIT}/spec.md`, `.agents/specs/${UNIT}/handoffs/${UNIT}.md`];
    expect(await reportRun(h.env, UNIT, runId, { verb: "done", outcome: "done" }, "r1")).toMatchObject({ ok: true, value: { replayed: false } });
  });

  test("the files the run's harness keeps local and norn's skill links never count, even where the repo's own .gitignore leaves them showing; a repo's skill folder of that name does", async () => {
    const { h, runId } = await running();
    h.env.slots = { ...h.env.slots, executors: { claude: claudeHarness }, pack: { ...h.env.slots.pack, skills: { "norn-implement": { "SKILL.md": "x" } } } };
    h.dirty[WORKTREE] = [".claude/settings.local.json", ".claude/skills/norn-implement", ".claude/skills/norn-implement/SKILL.md"];
    expect(await reportRun(h.env, UNIT, runId, { verb: "done", outcome: "done" }, "r1")).toMatchObject({
      ok: false,
      refusal: { code: "dirty_worktree", error: expect.stringMatching(/holds uncommitted work: \.claude\/skills\/norn-implement\/SKILL\.md$/) },
    });
    h.dirty[WORKTREE] = [".claude/settings.local.json", ".claude/skills/norn-implement"];
    expect(await reportRun(h.env, UNIT, runId, { verb: "done", outcome: "done" }, "r1")).toMatchObject({ ok: true, value: { replayed: false } });
  });

  test("a done whose handoff has grown past 8 KB is refused with how to trim it, and records nothing; ask and stuck still go through", async () => {
    const { h, runId } = await running();
    const handoff = `${WORKTREE}/.agents/specs/${UNIT}/handoffs/${UNIT}.md`;
    await h.files.write(handoff, `# Handoff: ${UNIT}\n\n## State\n\n${"a repro line that grew into a log\n".repeat(300)}`);
    const r = await reportRun(h.env, UNIT, runId, { verb: "done", outcome: "done" }, "r1");
    expect(r).toMatchObject({
      ok: false,
      refusal: { code: "handoff_too_large", error: expect.stringMatching(/handoffs\/lt-1\.md is 10 KB; it may hold at most 8 KB$/), do_instead: expect.stringMatching(/current state.*State, Notes.*\$NORN_OUT\/findings\.json.*under \.agents\/specs\/lt-1\/.*report again/) },
    });
    expect((await record(h, UNIT)).receipts.some((x) => x.data.kind === "run.reported")).toBe(false);
    expect(await reportRun(h.env, UNIT, runId, { verb: "ask", question: "may the repro stay?" }, "r2")).toMatchObject({ ok: true });
  });

  test("a handoff of 8 KB or less, counted in bytes once trimmed, is no reason to refuse", async () => {
    const { h, runId } = await running();
    await h.files.write(`${WORKTREE}/.agents/specs/${UNIT}/handoffs/${UNIT}.md`, `\n\n${"é".repeat(4096)}\n\n\n`);
    expect(await reportRun(h.env, UNIT, runId, { verb: "done", outcome: "done" }, "r1")).toMatchObject({ ok: true, value: { replayed: false } });
  });

  test("a refusal names the first ten paths and counts the rest", async () => {
    const { h, runId } = await running();
    h.dirty[WORKTREE] = Array.from({ length: 13 }, (_, i) => `src/f${String(i).padStart(2, "0")}.ts`);
    const r = await reportRun(h.env, UNIT, runId, { verb: "done", outcome: "done" }, "r1");
    if (r.ok) throw new Error("the done was recorded");
    expect(r.refusal.code).toBe("dirty_worktree");
    expect(r.refusal.error).toEndWith("src/f09.ts and 3 more");
    expect(r.refusal.error).not.toContain("src/f10.ts");
  });

  test("a done is refused when the vcs cannot tell whether the worktree holds uncommitted work, and nothing is recorded", async () => {
    const { h, runId } = await running();
    h.env.slots.vcs.uncommitted = async () => ({ ok: false, failure: { code: "unavailable", message: "index file corrupt", retryable: false } });
    expect(await reportRun(h.env, UNIT, runId, { verb: "done", outcome: "done" }, "r1")).toMatchObject({
      ok: false,
      refusal: { code: "unavailable", error: expect.stringContaining("cannot tell whether") },
    });
    expect((await record(h, UNIT)).receipts.some((x) => x.data.kind === "run.reported")).toBe(false);
  });

  test("a done whose commits since the unit's base left a conflict unresolved is refused, naming each file and line, and records nothing; ask still goes through", async () => {
    const { h, runId } = await running();
    Object.assign(h.heads, { main: "m".repeat(40), "norn/lt-1": "s".repeat(40) });
    const asked: [string, string][] = [];
    let found: VcsConflictMarker[] = [
      { path: "src/a.ts", line: 4 },
      { path: "src/b.ts", line: 12 },
    ];
    h.env.slots.vcs.conflictMarkers = async (base, head) => {
      asked.push([base, head]);
      return ok(found);
    };
    const r = await reportRun(h.env, UNIT, runId, { verb: "done", outcome: "done" }, "r1");
    expect(r).toMatchObject({
      ok: false,
      refusal: { code: "conflict_markers", error: expect.stringContaining("src/a.ts:4, src/b.ts:12"), do_instead: expect.stringContaining("commit") },
    });
    expect(asked).toEqual([["main", "norn/lt-1"]]);
    expect((await record(h, UNIT)).receipts.some((x) => x.data.kind === "run.reported")).toBe(false);
    expect(await reportRun(h.env, UNIT, runId, { verb: "ask", question: "which side of src/a.ts wins?" }, "r2")).toMatchObject({ ok: true });
    const fresh = await running();
    Object.assign(fresh.h.heads, { main: "m".repeat(40), "norn/lt-1": "s".repeat(40) });
    fresh.h.env.slots.vcs.conflictMarkers = async () => ok(found);
    found = [];
    expect(await reportRun(fresh.h.env, UNIT, fresh.runId, { verb: "done", outcome: "done" }, "r1")).toMatchObject({ ok: true, value: { replayed: false } });
  });

  test("a unit without a branch of its own (run in the repo's own checkout) has no conflicts to read, and its done goes through", async () => {
    const { h, runId } = await running();
    h.heads.main = "m".repeat(40);
    let read = false;
    h.env.slots.vcs.conflictMarkers = async () => {
      read = true;
      return ok([{ path: "src/a.ts", line: 1 }]);
    };
    expect(await reportRun(h.env, UNIT, runId, { verb: "done", outcome: "done" }, "r1")).toMatchObject({ ok: true, value: { replayed: false } });
    expect(read).toBe(false);
  });

  test("a done is refused when the vcs cannot read the unit's conflicts, and nothing is recorded", async () => {
    const { h, runId } = await running();
    Object.assign(h.heads, { main: "m".repeat(40), "norn/lt-1": "s".repeat(40) });
    h.env.slots.vcs.conflictMarkers = async () => ({ ok: false, failure: { code: "unavailable", message: "bad revision", retryable: false } });
    expect(await reportRun(h.env, UNIT, runId, { verb: "done", outcome: "done" }, "r1")).toMatchObject({
      ok: false,
      refusal: { code: "unavailable", error: expect.stringContaining("bad revision") },
    });
    expect((await record(h, UNIT)).receipts.some((x) => x.data.kind === "run.reported")).toBe(false);
  });

  test("a done in a clean worktree goes through, and one whose work was committed after the refusal too", async () => {
    const { h, runId } = await running();
    h.dirty[WORKTREE] = ["notes.txt", `.agents/specs/${UNIT}/spec.md`];
    expect(await reportRun(h.env, UNIT, runId, { verb: "done", outcome: "done" }, "r1")).toMatchObject({ ok: false, refusal: { code: "dirty_worktree", error: expect.not.stringContaining(".agents/") } });
    h.dirty[WORKTREE] = [];
    expect(await reportRun(h.env, UNIT, runId, { verb: "done", outcome: "done" }, "r1")).toMatchObject({ ok: true, value: { replayed: false } });
  });

  test("a unit with no run in progress is refused", async () => {
    const h = harness({ workflow: "agented" });
    expect(await reportRun(h.env, "lt-9", "r", { verb: "stuck", reason: "x" }, "r1")).toMatchObject({ ok: false, refusal: { code: "no_run" } });
  });

  test("an ask a person answered is no report: it is not read off the session again, and the run reports on", async () => {
    const { h, runId } = await running();
    await reportRun(h.env, UNIT, runId, { verb: "ask", question: "which db?" }, "r1");
    // the session keeps showing the ask until the answer reaches it
    h.sessions.byUnit.set(UNIT, session("reported", { report: { verb: "ask" } }));
    await tickUntil(h, async () => (await record(h, UNIT)).state?.parked !== undefined);
    await h.env.journal.record(UNIT, { id: "answer-1", data: { kind: "answer.sent", input_id: "report-r1", text: "postgres", by: "person", step: "build", attempt: 1 } });
    await tickUntil(h, async () => (await record(h, UNIT)).state?.parked === undefined);
    await tickUntil(h, () => true, 3);
    const asks = (await record(h, UNIT)).receipts.filter((x) => x.data.kind === "run.reported" && x.data.verb === "ask");
    expect([asks.length, (await record(h, UNIT)).state?.parked]).toEqual([1, undefined]);
    expect(await reportRun(h.env, UNIT, runId, { verb: "done", outcome: "done" }, "r2")).toMatchObject({ ok: true, value: { replayed: false } });
  });

  test("ask records the question; stuck its reason", async () => {
    const { h, runId } = await running();
    expect((await reportRun(h.env, UNIT, runId, { verb: "ask", question: "  " }, "r0")).ok).toBe(false);
    await reportRun(h.env, UNIT, runId, { verb: "ask", question: "which db?" }, "r1");
    expect((await record(h, UNIT)).receipts.at(-1)?.data).toMatchObject({ kind: "run.reported", verb: "ask", text: "which db?" });
  });
});

describe("brief", () => {
  test("the live run's brief names the step, its outcomes with their meaning, and how to report", async () => {
    const { h, runId } = await running();
    const r = await briefOf(h.env, UNIT);
    if (!r.ok) throw new Error(r.refusal.error);
    expect(r.value.run_id).toBe(runId);
    const md = r.value.markdown;
    expect(md).toContain("# norn brief — lt-1 · build #1");
    expect(md).toContain("Build the thing.");
    expect(md).toContain("`norn-implement`");
    expect(md).toContain("`norn done done` — the thing is built");
    expect(md).toContain("norn ask");
    expect(md).toContain("norn stuck");
  });

  test("every agent step reads and keeps its handoff, though its workflow lists none, and its brief names where the run's reports go", async () => {
    const { h } = await running();
    const r = await briefOf(h.env, UNIT);
    if (!r.ok) throw new Error(r.refusal.error);
    const md = r.value.markdown;
    expect(md).toContain("- `handoff` — this unit's handoff, which you keep current: `.agents/specs/lt-1/handoffs/lt-1.md`");
    expect(md).toContain("- `handoff` → `.agents/specs/lt-1/handoffs/lt-1.md`, with every outcome");
    expect(await h.files.read(`${WORKTREE}/.agents/specs/lt-1/handoffs/lt-1.md`)).toContain("# Handoff: lt-1");
  });

  test("an agent launched since the last tick gets its brief, is held to its report and may report, before a tick applies its launch", async () => {
    const h = harness({ workflow: "agented" });
    h.items.push(trackerItem(1));
    await tickUntil(h, has("agent.start"));
    const unit = await record(h, UNIT);
    expect(unit.state?.run).toBeNull();
    const launch = unit.unapplied.find((r) => r.data.kind === "run.started");
    const runId = launch?.data.kind === "run.started" ? launch.data.run_id : "";
    expect(runId).not.toBe("");
    const brief = await briefOf(h.env, UNIT);
    expect(brief.ok && brief.value.run_id).toBe(runId);
    expect(JSON.parse((await hook(h, runId, "Stop", {})).reply.stdout).decision).toBe("block");
    expect(await reportRun(h.env, UNIT, runId, { verb: "done", outcome: "done" }, "early")).toMatchObject({ ok: true, value: { replayed: false } });
    await tickUntil(h, has("receipts.apply"));
    expect((await record(h, UNIT)).state?.ended).toBe("done");
  });

  test("the brief of a step a gate's reject sent back to carries the person's reason under Rework", async () => {
    const h = harness({ workflow: "gated" });
    h.items.push(trackerItem(1));
    await tickUntil(h, has("round.start"));
    const st = (await record(h, UNIT)).state;
    await h.env.journal.record(UNIT, { id: "01JD5G0000REJECT0000000000", data: { kind: "gate.decided", outcome: "reject", by: "person", reason: "Make the button blue", step: st?.step, attempt: st?.attempt } });
    await tickUntil(h, has("agent.start"));
    const r = await briefOf(h.env, UNIT);
    if (!r.ok) throw new Error(r.refusal.error);
    expect(r.value.markdown).toContain("## Rework");
    expect(r.value.markdown).toContain("`ready` was decided `reject` by person: Make the button blue");
  });

  test("no brief for a unit with no live agent run", async () => {
    const h = harness({ workflow: "agented" });
    expect(await briefOf(h.env, "lt-9")).toMatchObject({ ok: false, refusal: { code: "no_run" } });
  });
});

describe("the rework of a change's failed checks", () => {
  test("the brief's Rework and last_check name each failed check and its link, never a log", async () => {
    const h = harness({ workflow: "awaited" });
    h.stepAnswers["await-checks"] = [{ outcome: "fail", detail: { change: 7, url: "https://forge.example/7", failed: [{ name: "test", url: "https://forge.example/7/checks/test" }], reason: "checks failed on change 7" } }];
    h.items.push(trackerItem(1));
    await tickUntil(h, has("agent.start"));
    const r = await briefOf(h.env, UNIT);
    if (!r.ok) throw new Error(r.refusal.error);
    expect(r.value.markdown).toContain("## Rework");
    expect(r.value.markdown).toContain("Check `checks` ended `fail`: checks failed on change 7 (https://forge.example/7).");
    expect(r.value.markdown).toContain("- test: https://forge.example/7/checks/test");
    expect(await h.files.read(`${WORKTREE}/.agents/run/in/last_check.md`)).toContain("- test: https://forge.example/7/checks/test");
    // a wait kind keeps nothing between polls: the host tells it when its run started, so it can bound its wait
    const polled = h.stepCalls.filter((c) => c.kind === "await-checks").map((c) => (c.input as { started_at?: string }).started_at);
    expect(polled.length).toBeGreaterThan(0);
    expect(polled.every((at) => at === polled[0] && typeof at === "string")).toBe(true);
  });
});

describe("the resolve of a base update", () => {
  const BASE_SHA = "b".repeat(40);

  /** A story whose base update conflicted, at the resolve step that takes its base_side, with the run started. */
  async function resolving(): Promise<{ h: Harnessed; runId: string }> {
    const h = harness({ workflow: "resolving" });
    h.stepAnswers["update-branch"] = [{ outcome: "conflict", detail: { base: { ref: "main", sha: BASE_SHA }, conflicts: ["a.txt"] } }];
    h.items.push(trackerItem(1));
    await tickUntil(h, has("agent.start"));
    await tickUntil(h, has("receipts.apply"));
    const state = (await record(h, UNIT)).state;
    if (state?.step !== "resolve" || !state.run) throw new Error(`not at resolve: ${state?.step}`);
    return { h, runId: state.run.id };
  }

  test("a done before the base commit is merged into the story branch is refused and records nothing; once it is, the done goes through", async () => {
    const { h, runId } = await resolving();
    const r = await reportRun(h.env, UNIT, runId, { verb: "done", outcome: "done" }, "r1");
    expect(r).toMatchObject({
      ok: false,
      refusal: { code: "merge_unfinished", error: expect.stringContaining(BASE_SHA.slice(0, 12)), do_instead: expect.stringContaining(`git merge ${BASE_SHA}`) },
    });
    expect((await record(h, UNIT)).receipts.some((x) => x.data.kind === "run.reported")).toBe(false);
    expect(await reportRun(h.env, UNIT, runId, { verb: "ask", question: "which side wins?" }, "r2")).toMatchObject({ ok: true });
    const merged = await resolving();
    merged.h.env.slots.vcs.isAncestor = async (a, b) => ok(a === BASE_SHA && b === "norn/lt-1");
    expect(await reportRun(merged.h.env, UNIT, merged.runId, { verb: "done", outcome: "done" }, "r1")).toMatchObject({ ok: true, value: { replayed: false } });
  });

  test("a resolve sent back after its base update ended resolved is not held to the base commit, which an earlier update named", async () => {
    const h = harness({ workflow: "resolving" });
    h.stepAnswers["update-branch"] = [{ outcome: "conflict", detail: { base: { ref: "main", sha: BASE_SHA }, conflicts: ["a.txt"] } }, "resolved"];
    h.env.slots.vcs.isAncestor = async () => ok(true);
    h.items.push(trackerItem(1));
    await tickUntil(h, has("agent.start"));
    await tickUntil(h, has("receipts.apply"));
    const first = (await record(h, UNIT)).state?.run?.id ?? "";
    expect(await reportRun(h.env, UNIT, first, { verb: "done", outcome: "done" }, "r1")).toMatchObject({ ok: true });
    await tickUntil(h, async () => {
      const st = (await record(h, UNIT)).state;
      return st?.step === "resolve" && st.run !== null && st.run.id !== first;
    });
    const again = (await record(h, UNIT)).state;
    expect(again?.step).toBe("resolve");
    h.env.slots.vcs.isAncestor = async () => ok(false);
    expect(await reportRun(h.env, UNIT, again?.run?.id ?? "", { verb: "done", outcome: "done" }, "r2")).toMatchObject({ ok: true, value: { replayed: false } });
  });

  test("a slice's merge step's done after integrate conflicted is refused until the slice branch holds the story branch's commit integrate named", async () => {
    const STORY_SHA = "d".repeat(40);
    const SLICE = "lt-1/01";
    const integrating = async () => {
      const h = harness({ workflow: "sliced", kernel: { sliceWorkflow: "integrating" } });
      h.stepAnswers.integrate = [{ outcome: "conflict", detail: { story_branch: "norn/lt-1", slice_head: "c".repeat(40), base: { ref: "norn/lt-1", sha: STORY_SHA }, conflicts: ["a.txt"] } }];
      h.items.push(trackerItem(1));
      const wrote = await writeStoryDoc(h.env, UNIT, "slices/01-parse.md", ["---", `id: ${SLICE}`, "depends_on: []", "status: planned", "---", "## Goal", ""].join("\n"));
      if (!wrote.ok) throw new Error(wrote.failure.message);
      await tickUntil(
        h,
        async () => {
          const r = await record(h, SLICE);
          return r.state?.step === "merge" && r.state.run !== null && r.unapplied.length === 0;
        },
        40,
      );
      const state = (await record(h, SLICE)).state;
      if (state?.step !== "merge" || !state.run) throw new Error(`not at merge: ${state?.step}`);
      return { h, runId: state.run.id };
    };
    const { h, runId } = await integrating();
    h.env.slots.vcs.isAncestor = async (a, b) => ok(a === STORY_SHA && b === "norn/lt-1");
    expect(await reportRun(h.env, SLICE, runId, { verb: "done", outcome: "done" }, "r1")).toMatchObject({
      ok: false,
      refusal: { code: "merge_unfinished", error: expect.stringContaining("norn/lt-1-01"), do_instead: expect.stringContaining(`git merge ${STORY_SHA}`) },
    });
    const merged = await integrating();
    merged.h.env.slots.vcs.isAncestor = async (a, b) => ok(a === STORY_SHA && b === "norn/lt-1-01");
    expect(await reportRun(merged.h.env, SLICE, merged.runId, { verb: "done", outcome: "done" }, "r1")).toMatchObject({ ok: true, value: { replayed: false } });
  });

  test("a done is refused when the vcs cannot tell whether the base commit is merged", async () => {
    const { h, runId } = await resolving();
    h.env.slots.vcs.isAncestor = async () => ({ ok: false, failure: { code: "unavailable", message: "object store busy", retryable: true } });
    expect(await reportRun(h.env, UNIT, runId, { verb: "done", outcome: "done" }, "r1")).toMatchObject({
      ok: false,
      refusal: { code: "unavailable", error: expect.stringContaining("object store busy") },
    });
  });
});
