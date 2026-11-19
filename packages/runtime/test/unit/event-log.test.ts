import { describe, expect, test } from "bun:test";
import { manualClock, memoryFiles, memoryHost } from "@norn/conformance";
import type { HarnessEvent } from "@norn/plugin-api";
import {
  appendEvents,
  batchesDir,
  batchName,
  claimReceived,
  EventLogSessionSource,
  markDelivered,
  pendingInjections,
  queueInjection,
  readEvents,
  readSentPrompt,
  recordSentPrompt,
} from "../../src/index.ts";

const AT = "2026-11-17T09:00:00.000Z";
const RUN = "01JRUN0000000000000000000A";

function host() {
  const files = memoryFiles();
  const clock = manualClock(AT);
  return { files, clock, ctx: memoryHost({ files, now: clock.now, repo: { root: "/repo", dataDir: "/m" } }) };
}

const ev = (e: Record<string, unknown>): HarnessEvent => ({ run_id: RUN, seq: 0, at: AT, ...e }) as HarnessEvent;

describe("event log", () => {
  test("batches are restamped from the seq they claim and read back in order", async () => {
    const { ctx } = host();
    const a = await appendEvents(ctx, "gh-12", RUN, [ev({ type: "session.started", harness_session: "s1" }), ev({ type: "turn.started", source: "brief" })]);
    const b = await appendEvents(ctx, "gh-12", RUN, [ev({ type: "turn.ended" })]);
    expect(a.ok && a.value.first_seq).toBe(0);
    expect(b.ok && b.value.first_seq).toBe(2);
    const read = await readEvents(ctx, "gh-12", RUN);
    expect(read.events.map((e) => [e.seq, e.type])).toEqual([
      [0, "session.started"],
      [1, "turn.started"],
      [2, "turn.ended"],
    ]);
    expect(read).toMatchObject({ problems: [], next_seq: 3 });
  });

  test("two concurrent appends never share a seq", async () => {
    const { ctx } = host();
    const writes = Array.from({ length: 8 }, (_, i) => appendEvents(ctx, "gh-12/03", RUN, [ev({ type: "tool.requested", id: `t${i}`, kind: "other", tool: "Read" }), ev({ type: "tool.finished", id: `t${i}`, ok: true })]));
    const results = await Promise.all(writes);
    expect(results.every((r) => r.ok)).toBe(true);
    const read = await readEvents(ctx, "gh-12/03", RUN);
    expect(read.problems).toEqual([]);
    expect(read.events.map((e) => e.seq)).toEqual(Array.from({ length: 16 }, (_, i) => i));
    // each batch's events stay together
    const ids = read.events.filter((e) => e.type === "tool.requested").map((e) => (e as { id: string }).id);
    expect(new Set(ids).size).toBe(8);
  });

  test("a corrupt batch is a problem, the valid ones still read, and the next claim goes past it", async () => {
    const { ctx, files } = host();
    await appendEvents(ctx, "gh-12", RUN, [ev({ type: "turn.started", source: "brief" })]);
    await files.write(`${batchesDir(ctx, "gh-12", RUN)}/${batchName(1)}`, "{not json");
    const read = await readEvents(ctx, "gh-12", RUN);
    expect(read.events.map((e) => e.type)).toEqual(["turn.started"]);
    expect(read.problems).toEqual([expect.stringContaining(batchName(1))]);
    expect(read.next_seq).toBe(2);
    const next = await appendEvents(ctx, "gh-12", RUN, [ev({ type: "turn.ended" })]);
    expect(next.ok && next.value.first_seq).toBe(2);
  });

  test("a batch whose seqs do not match its name is a problem, not a guess", async () => {
    const { ctx, files } = host();
    await files.write(`${batchesDir(ctx, "gh-12", RUN)}/${batchName(0)}`, JSON.stringify({ first_seq: 5, events: [ev({ type: "turn.ended", seq: 5 })] }));
    const read = await readEvents(ctx, "gh-12", RUN);
    expect(read.events).toEqual([]);
    expect(read.problems).toEqual([expect.stringContaining("do not match")]);
  });

  test("an invalid event or one for another run is refused before anything is written", async () => {
    const { ctx, files } = host();
    expect((await appendEvents(ctx, "gh-12", RUN, [ev({ type: "turn.started", source: "robot" })])).ok).toBe(false);
    expect((await appendEvents(ctx, "gh-12", RUN, [{ ...ev({ type: "turn.ended" }), run_id: "other" } as HarnessEvent])).ok).toBe(false);
    expect((await appendEvents(ctx, "gh-12", RUN, [])).ok).toBe(false);
    expect(files.snapshot()).toEqual({});
  });
});

describe("sent prompts and the outbox", () => {
  test("a sent prompt is recorded once and received once", async () => {
    const { ctx } = host();
    const sent = { id: "p1", source: "nudge" as const, at: AT };
    expect(await recordSentPrompt(ctx, "gh-12", RUN, sent)).toEqual({ ok: true, value: { recorded: true } });
    expect(await recordSentPrompt(ctx, "gh-12", RUN, sent)).toEqual({ ok: true, value: { recorded: false } });
    expect(await readSentPrompt(ctx, "gh-12", RUN, "p1")).toEqual(sent);
    expect(await readSentPrompt(ctx, "gh-12", RUN, "p2")).toBeNull();
    expect(await claimReceived(ctx, "gh-12", RUN, "p1")).toBe(true);
    expect(await claimReceived(ctx, "gh-12", RUN, "p1")).toBe(false);
  });

  test("queued entries stay pending, oldest first, until marked delivered", async () => {
    const { ctx } = host();
    await queueInjection(ctx, "gh-12", RUN, { id: "b", source: "answer", text: "yes", input_id: "q1", at: "2026-11-17T09:02:00.000Z" });
    await queueInjection(ctx, "gh-12", RUN, { id: "a", source: "nudge", text: "go on", at: "2026-11-17T09:01:00.000Z" });
    expect((await queueInjection(ctx, "gh-12", RUN, { id: "a", source: "nudge", text: "go on", at: AT })).ok && "replay").toBe("replay");
    expect((await pendingInjections(ctx, "gh-12", RUN)).injections.map((i) => i.id)).toEqual(["a", "b"]);
    await markDelivered(ctx, "gh-12", RUN, ["a"]);
    expect((await pendingInjections(ctx, "gh-12", RUN)).injections.map((i) => i.id)).toEqual(["b"]);
  });

  test("an id that would walk out of its folder is refused", async () => {
    const { ctx } = host();
    expect((await recordSentPrompt(ctx, "gh-12", RUN, { id: "../x", source: "brief", at: AT })).ok).toBe(false);
  });
});

describe("EventLogSessionSource", () => {
  const classify = { silentAfterMs: 5 * 60_000 };

  async function seeded(events: Record<string, unknown>[]) {
    const h = host();
    await appendEvents(h.ctx, "gh-12", RUN, events.map(ev));
    return h;
  }

  test("a run with no events has no session yet", async () => {
    const { ctx } = host();
    expect(await new EventLogSessionSource({ ctx, classify }).facts("gh-12", RUN)).toBeNull();
  });

  test("a turn in progress classifies working", async () => {
    const { ctx } = await seeded([{ type: "session.started", harness_session: "s" }, { type: "turn.started", source: "brief" }]);
    expect(await new EventLogSessionSource({ ctx, classify }).facts("gh-12", RUN, "h")).toMatchObject({ activity: "working", silent: false });
  });

  test("an open question classifies asking", async () => {
    const { ctx } = await seeded([{ type: "turn.started", source: "brief" }, { type: "input.requested", id: "q", question: "which one?" }]);
    expect(await new EventLogSessionSource({ ctx, classify }).facts("gh-12", RUN)).toMatchObject({ activity: "asking", ask: { id: "q", question: "which one?" } });
  });

  test("a session that ended on its own classifies ended", async () => {
    const { ctx } = await seeded([{ type: "turn.started", source: "brief" }, { type: "session.ended", reason: "exit" }]);
    const alive = async () => false;
    expect(await new EventLogSessionSource({ ctx, classify, alive }).facts("gh-12", RUN, "h")).toMatchObject({ activity: "ended" });
  });

  test("a session the runner reports dead without an end of its own reads ended (died), and only in the read", async () => {
    const { ctx } = await seeded([{ type: "turn.started", source: "brief" }]);
    const probed: string[] = [];
    const alive = async (h: string) => {
      probed.push(h);
      return false;
    };
    expect(await new EventLogSessionSource({ ctx, classify, alive }).facts("gh-12", RUN, "h-1")).toMatchObject({ activity: "ended" });
    expect(probed).toEqual(["h-1"]);
    expect((await readEvents(ctx, "gh-12", RUN)).events.map((e) => e.type)).toEqual(["turn.started"]);
  });

  test("a process that ended before its first event reads ended, with the head of its log as the error", async () => {
    const { ctx } = host();
    const asked: string[] = [];
    const output = async (h: string) => {
      asked.push(h);
      return "Error: invalid API key | run claude login";
    };
    const facts = await new EventLogSessionSource({ ctx, classify, alive: async () => false, output }).facts("gh-12", RUN, "h-1");
    expect(facts).toMatchObject({ activity: "ended", silent: false, error: "the agent exited before its first event: Error: invalid API key | run claude login" });
    expect(asked).toEqual(["h-1"]);
    expect((await readEvents(ctx, "gh-12", RUN)).events).toEqual([]);
  });

  test("a process that ended before its first event and left no log still reads ended, saying so", async () => {
    const { ctx } = host();
    const facts = await new EventLogSessionSource({ ctx, classify, alive: async () => false, output: async () => null }).facts("gh-12", RUN, "h-1");
    expect(facts).toMatchObject({ activity: "ended", error: "the agent exited before its first event and left no output" });
  });

  test("before its first event, a process alive or one the probe cannot tell about has no session yet", async () => {
    const { ctx } = host();
    expect(await new EventLogSessionSource({ ctx, classify, alive: async () => true }).facts("gh-12", RUN, "h")).toBeNull();
    expect(await new EventLogSessionSource({ ctx, classify, alive: async () => null }).facts("gh-12", RUN, "h")).toBeNull();
    expect(await new EventLogSessionSource({ ctx, classify, alive: async () => false }).facts("gh-12", RUN)).toBeNull();
  });

  test("a probe that cannot answer, or throws, never reads as dead", async () => {
    const { ctx } = await seeded([{ type: "turn.started", source: "brief" }]);
    expect(await new EventLogSessionSource({ ctx, classify, alive: async () => null }).facts("gh-12", RUN, "h")).toMatchObject({ activity: "working" });
    const throwing = async (): Promise<boolean | null> => {
      throw new Error("ps gone");
    };
    expect(await new EventLogSessionSource({ ctx, classify, alive: throwing }).facts("gh-12", RUN, "h")).toMatchObject({ activity: "working" });
  });

  test("a quiet working session turns silent by the host's clock", async () => {
    const { ctx, clock } = await seeded([{ type: "turn.started", source: "brief" }]);
    clock.advance(6 * 60_000);
    expect(await new EventLogSessionSource({ ctx, classify }).facts("gh-12", RUN)).toMatchObject({ activity: "working", silent: true });
  });

  test("a corrupt batch travels with the facts as an error and to onProblem", async () => {
    const { ctx, files } = await seeded([{ type: "turn.started", source: "brief" }]);
    await files.write(`${batchesDir(ctx, "gh-12", RUN)}/${batchName(1)}`, "garbage");
    const seen: string[] = [];
    const facts = await new EventLogSessionSource({ ctx, classify, onProblem: (_u, _r, p) => seen.push(p) }).facts("gh-12", RUN);
    expect(facts?.activity).toBe("working");
    expect(facts?.errors).toEqual([expect.stringContaining(batchName(1))]);
    expect(seen).toHaveLength(1);
  });
});
