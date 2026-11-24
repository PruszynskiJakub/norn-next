/** `norn lab` serving its dashboard: each button runs its real command in the lab, and Reset rebuilds it. */
import { describe, expect, test } from "bun:test";
import { nodeExec } from "@norn/host-node";
import { MAIN, sh } from "./world.ts";
import { calledBeyondVersion, dashboardUrl, KEY, machine, NORN_TIMEOUT_MS, type Pressed, SLOW, type StateSeen, snapshot, story } from "./lab-world.ts";

describe("norn lab serves its dashboard", () => {
  test(
    "AC1, AC2, AC8, AC9, AC10: the dashboard is served on 127.0.0.1, a taken port is refused, each button runs its real command in the lab, Reset rebuilds it, and nothing beyond the lab changes",
    async () => {
      const l = await machine();
      const personBefore = snapshot(l.personHome);
      const siblingBefore = snapshot(l.sibling);
      const said: string[] = [];
      const served = Bun.spawn(["bun", MAIN, "lab"], { cwd: l.sibling, env: { ...process.env, ...l.env }, stdout: "pipe", stderr: "pipe" });
      try {
        const url = await dashboardUrl(served, said);
        expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);

        const port = new URL(url).port;
        const taken = await nodeExec(["bun", MAIN, "lab", "--port", port], { cwd: l.sibling, env: l.env, timeoutMs: NORN_TIMEOUT_MS });
        expect(taken.code).toBe(3);
        expect(taken.stdout).toContain("(port_taken)");
        expect(taken.stdout).toContain(port);

        const page = await fetch(url);
        expect(page.status).toBe(200);
        expect(await page.text()).toContain("/api/state");

        const state = async (): Promise<StateSeen | null> => {
          const res = await fetch(`${url}api/state`);
          return res.ok ? ((await res.json()) as StateSeen) : null;
        };
        const until = async (what: string, done: (s: StateSeen) => boolean, maxMs = 240_000): Promise<StateSeen> => {
          let last: StateSeen | null = null;
          for (const end = performance.now() + maxMs; performance.now() < end; await Bun.sleep(500)) {
            last = await state();
            if (last !== null && done(last)) return last;
          }
          throw new Error(`the dashboard never showed ${what}; last: ${JSON.stringify(last?.lab)} ${JSON.stringify(last?.needs_you)}\n${said.join("")}`);
        };
        const press = async (name: string, text?: string): Promise<Pressed> => {
          const res = await fetch(`${url}api/act/${name}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) });
          expect(res.status).toBe(200);
          return (await res.json()) as Pressed;
        };
        const waits = (what: string) => (s: StateSeen) => s.needs_you.some((n) => n.unit === KEY && n.for === what);

        const asked = await until("the question", waits("answer"));
        expect(asked.graph).toMatchObject({ workflow: "quick", live: "implement" });
        expect(asked.decisions.length).toBeGreaterThan(0);
        expect(asked.session).not.toBeNull();
        expect(await press("answer", "Keep the comma.")).toMatchObject({ action: "answer", command: `norn story answer ${KEY} 'Keep the comma.'`, exit: 0 });

        await until("the ready gate", waits("gate"));
        expect(await press("reject", "Name the greeting in the README too.")).toMatchObject({ command: `norn story reject ${KEY} --reason 'Name the greeting in the README too.'`, exit: 0 });
        // the reject sends the work back through implement; the gate waits again once land.rejected is spent
        for (const end = performance.now() + 240_000; (await story(l))?.units[0]?.counters["land.rejected"]?.value !== 1 && performance.now() < end; ) await Bun.sleep(500);
        const back = await until("the gate again after the reject", waits("gate"));
        expect(back.docs.map((d) => d.path)).toEqual(expect.arrayContaining(["spec.md", "pr.md"]));
        expect(await press("approve")).toMatchObject({ command: `norn story approve ${KEY}`, exit: 0 });

        await until("the merge beat", (s) => s.graph.live === "merge");
        const merged = await press("merge");
        expect(merged).toMatchObject({ command: `git merge --no-ff --no-edit norn/${KEY} && git push -q origin main`, exit: 0 });
        const ended = await until("the story ended", (s) => s.lab.ended === "done");
        expect(ended.receipts.entries.at(-1)?.kind).toBe("state.committed");
        expect(await sh(l.repo, "git", "log", "--format=%s", "main")).toContain("Keep the comma in the greeting");

        // a merged story takes no rerun and no new round: each button still ran its command, and says how it went
        for (const [name, command] of [
          ["rerun", `norn run rerun ${KEY}`],
          ["round", `norn story round ${KEY} --workflow quick`],
        ] as const) {
          const r = await press(name);
          expect(r.command).toBe(command);
          expect(typeof r.exit).toBe("number");
          expect(r.output).not.toBe("");
        }

        expect(snapshot(l.personHome)).toEqual(personBefore);
        expect(snapshot(l.sibling)).toEqual(siblingBefore);
        expect(calledBeyondVersion(l)).toEqual([]);

        const reset = await press("reset");
        expect(reset).toMatchObject({ action: "reset", command: "norn lab --clean", exit: 0 });
        expect(reset.output).toContain("Built a new lab");
        expect(await sh(l.repo, "git", "log", "--format=%s", "main")).not.toContain("Keep the comma in the greeting");
        const again = await until("beat 1 or 2 of the rebuilt lab", (s) => s.lab.story === KEY && s.lab.ended === null && s.lab.beat.n <= 2);
        expect(again.receipts.entries.filter((e) => e.kind === "gate.decided")).toEqual([]);
      } finally {
        served.kill("SIGINT");
        await served.exited;
      }
      expect(served.exitCode).toBe(0);
    },
    SLOW,
  );
});
