/** `norn lab`'s break-it switches on the dashboard: each produces the state it names and says the way out. */
import { describe, expect, test } from "bun:test";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { sh } from "./world.ts";
import { alive, calledBeyondVersion, holdCommits, inLab, KEY, machine, norn, SLOW, served, snapshot, statusUntil, story, tickBeside } from "./lab-world.ts";

describe("norn lab's break-it switches", () => {
  test(
    "AC1–AC7: each switch on the dashboard produces the state it names, answers with the command it ran and the way out, and changes nothing beyond the lab",
    async () => {
      const [a, b] = await Promise.all([machine(), machine()]);
      const before = [a, b].map((l) => ({ home: snapshot(l.personHome), sibling: snapshot(l.sibling) }));
      const { hold, held } = holdCommits(a);
      writeFileSync(hold, "");
      const [da, db] = await Promise.all([served(a), served(b)]);
      try {
        const playA = async () => {
          // AC1: kill the agent while implement's agent is running, held at its commit
          await da.until("implement's agent running", (s) => s.graph.live === "implement" && existsSync(held));
          const killed = await da.press("kill");
          const pids = [...killed.command.matchAll(/kill -s KILL -- -(\d+)/g)].map((m) => Number(m[1]));
          expect(pids.length).toBeGreaterThan(0);
          expect(killed.exit).toBe(0);
          expect(killed.way_out).toContain("agent.died.retry");
          for (const end = performance.now() + 10_000; pids.some(alive) && performance.now() < end; ) await Bun.sleep(100);
          expect(pids.filter(alive)).toEqual([]);
          rmSync(hold);
          await da.until("a tick finding the agent died", (s) => s.decisions.some((d) => d.rule === "agent.died.retry"));

          // AC5: expire the claim at the question, where nothing else moves the story
          await da.until("the question", (s) => s.needs_you.some((n) => n.unit === KEY && n.for === "answer"));
          const ours = (await story(a))?.claim?.holder;
          expect(ours).toBeDefined();
          const expired = await da.press("expire-claim");
          expect(expired.exit).toBe(0);
          expect(expired.way_out).toContain(`norn story take ${KEY} --force`);
          const stories = (await norn(a, "status", "--json")).body.stories as { key: string; claim: { holder: string; expires_at: string } | null }[];
          const rewritten = stories.find((s) => s.key === KEY)?.claim;
          expect(rewritten?.holder).not.toBe(ours);
          expect(Date.parse(rewritten?.expires_at ?? "")).toBeLessThan(Date.now());
          const tick = await tickBeside(a);
          expect(tick.code).toBe(0);
          const waits = (tick.body.decisions ?? []) as { rule: string; reason?: string }[];
          expect(waits.find((d) => d.rule === "claim.held_elsewhere")?.reason).toContain("expired");
          const took = await norn(a, "story", "take", KEY, "--force", "--json");
          expect(took).toMatchObject({ code: 0, body: { taken: true, expired: true, holder: ours } });
          expect((await story(a))?.claim?.holder).toBe(ours);

          // AC2: make the check fail, then answer: implement's fix meets a test that fails, and the work loops back
          const failing = await da.press("fail-check");
          expect(failing.exit).toBe(0);
          expect(failing.way_out).toContain("revert");
          expect((await da.press("answer", "Keep the comma.")).exit).toBe(0);
          await statusUntil(a, "a second failed check", (u) => (u?.counters["check.fail"]?.value ?? 0) >= 2);

          // AC4: edit a run-state file: the unit shows corrupt; the way out puts the good copy back
          const corrupt = await da.press("corrupt");
          expect(corrupt.exit).toBe(0);
          expect((await story(a))?.units[0]).toMatchObject({ id: KEY, corrupt: expect.stringContaining("state.json") });
          const restore = /`(cp [^`]+)`/.exec(corrupt.way_out ?? "")?.[1];
          expect(restore).toBeDefined();
          expect((await inLab(a, ["sh", "-c", restore as string])).code).toBe(0);
          expect((await story(a))?.units[0]?.corrupt).toBeUndefined();
        };
        const playB = async () => {
          // AC3: move the base once the story has its worktree; the base update then needs a resolve
          await db.until("implement", (s) => s.graph.live === "implement");
          const moved = await db.press("move-base");
          expect(moved.exit).toBe(0);
          expect(moved.way_out).toContain(`norn run rerun ${KEY} --step update`);
          expect(await sh(b.repo, "git", "ls-remote", "origin", "main")).toContain(await sh(b.repo, "git", "rev-parse", "main"));
          await db.until("the question", (s) => s.needs_you.some((n) => n.unit === KEY && n.for === "answer"));
          expect((await db.press("answer", "Keep the comma.")).exit).toBe(0);
          await statusUntil(b, "the resolve step", (u) => u?.step === "resolve");
        };
        await Promise.all([playA(), playB()]);
      } finally {
        await Promise.all([da.stop(), db.stop()]);
      }
      // AC7: the person's norn home and their repo beside each lab are as they were, and no real tool ran
      for (const [i, l] of [a, b].entries()) {
        expect(snapshot(l.personHome)).toEqual(before[i]?.home ?? {});
        expect(snapshot(l.sibling)).toEqual(before[i]?.sibling ?? {});
        expect(calledBeyondVersion(l)).toEqual([]);
      }
    },
    SLOW,
  );
});
