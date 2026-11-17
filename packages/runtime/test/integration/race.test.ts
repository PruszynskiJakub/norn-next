/**
 * Two machines on one remote, each a clone with its own runtime, sharing run data through the refs
 * store and items through one tracker folder. They race for the same story; the remote decides the
 * claim, and only the machine holding it runs anything for the story.
 */
import { describe, expect, test } from "bun:test";
import { type AgentScript, decideGate, git, type Machine, MINUTE, machine, personMerges, type Report, rulesOf, team, unitRecord } from "./world.ts";

const builder: AgentScript = () => ({ commit: { "thing.txt": "the thing\n" }, outcome: "done" });

/** Kinds of decision that do something for a unit beyond reading or claiming. */
const ACTING = new Set(["start_run", "retry_run", "nudge", "stop_run", "run_check", "run_step", "start_slices", "apply_receipts", "mark_done", "park"]);

/** Both machines tick at once, a minute apart, their agents working between ticks. */
async function race(ms: Machine[], done: () => Promise<boolean>, max = 40): Promise<Report[][]> {
  const reports: Report[][] = ms.map(() => []);
  for (let i = 0; i < max; i++) {
    const round = await Promise.all(ms.map((m) => m.tick()));
    round.forEach((r, j) => reports[j]?.push(r));
    for (const m of ms) {
      await m.agents.work();
      m.advance(MINUTE);
    }
    if (await done()) return reports;
  }
  throw new Error(`no convergence after ${max} rounds:\n${reports.map((rs, j) => `machine ${j}:\n${rs.map((r) => rulesOf(r).join(", ")).join("\n")}`).join("\n")}`);
}

const acted = (rs: Report[], unit: string) => rs.flatMap((r) => r.outcomes).filter((o) => o.ok && o.decision.unit === unit && ACTING.has(o.decision.kind));

describe("two machines racing one story over the refs store", () => {
  test("one wins the claim and carries the story to done; the other never acts on it", async () => {
    const t = await team();
    const a = await machine(t, { name: "a", workflow: "short", store: "refs", script: builder });
    const b = await machine(t, { name: "b", workflow: "short", store: "refs", script: builder });
    await a.env.slots.tracker.perform({ kind: "create", title: "Build it", body: "", labels: ["norn"], assignee: "me" }, { receipt_id: "create-1" });
    const unit = "lt-1";
    const holder = async (): Promise<string | null> => {
      const c = await a.env.slots.store.claims.read(unit);
      return c.ok && c.value ? c.value.holder : null;
    };
    const parkedOn = async () => {
      for (const m of [a, b]) if ((await unitRecord(m, unit)).state?.parked) return true;
      return false;
    };
    const first = await race([a, b], parkedOn);
    const winner = (await holder()) === "a" ? a : b;
    const loser = winner === a ? b : a;
    expect(await holder()).toBe(winner === a ? "a" : "b");

    await decideGate(winner, unit, "approve");
    const second = await race([a, b], async () => (await unitRecord(winner, unit)).state?.step === "merge");
    await personMerges(winner, unit);
    const third = await race([a, b], async () => (await unitRecord(winner, unit)).state?.ended === "done" && (await holder()) === null);

    const of = (m: Machine) => [first, second, third].flatMap((rs) => rs[m === a ? 0 : 1] ?? []);
    expect(winner.agents.starts).toHaveLength(1);
    expect(loser.agents.starts).toHaveLength(0);
    expect(acted(of(winner), unit).length).toBeGreaterThan(5);
    expect(acted(of(loser), unit).map((o) => o.decision.rule)).toEqual([]);
    expect(of(loser).flatMap(rulesOf).filter((r) => r.includes("!"))).toEqual([]);
    // the loser's intake met the winner's claim, so it never made the story a unit or cut its branch
    const intakes = of(loser).flatMap((r) => r.outcomes).filter((o) => o.decision.kind === "intake_story");
    expect(intakes.length).toBeGreaterThan(0);
    expect(intakes.every((o) => o.ok && (o.detail as { held_elsewhere?: boolean; already?: boolean }).held_elsewhere)).toBe(true);
    expect(await git(loser.repo, "branch", "--list", `norn/${unit}`)).toBe("");

    // once the winner released the claim, the loser reads the story as done from the shared run data and takes nothing up
    let n = 0;
    const after = await race([a, b], async () => ++n >= 3);
    expect((await unitRecord(loser, unit)).state?.ended).toBe("done");
    expect(after.flat().flatMap((r) => r.decisions).filter((d) => d.kind !== "noop")).toEqual([]);
    expect(loser.agents.starts).toHaveLength(0);
  }, 60_000);
});
