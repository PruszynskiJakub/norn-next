import { describe, expect, test } from "bun:test";
import { labPaths } from "../../src/lab/paths.ts";
import { labScript, type LabUnit } from "../../src/lab/script.ts";
import { type LabState, lineInput, playTour, youLine } from "../../src/lab/tty.ts";

const script = labScript();
const paths = labPaths("/tmp/t");
const KEY = "lt-1";
const gate = { for: "gate", text: "Ready to merge?", next: `norn story approve ${KEY}` };
const spent = (...names: string[]) => Object.fromEntries(names.map((n) => [n, { value: 1, max: 5 }]));

/** One state of the lab's story, and the person's command that moves it on, when it waits for one. */
interface Stop {
  unit: LabUnit | null;
  /** the person's command (printed form) that moves it on: a norn decision leaves a receipt the next tick applies */
  needs?: { command: string; receipt: boolean };
  /** the story's claim is still held: it is given up on a tick after the unit ended */
  claimed?: boolean;
}

const u = (over: Partial<LabUnit>): LabUnit => ({ id: KEY, step: "sync", waiting: null, counters: {}, ...over });

/** The story through `quick` as `norn status --json` shows it tick by tick, with the person's four decisions. */
const STORY: Stop[] = [
  { unit: null },
  { unit: u({ step: "sync" }) },
  { unit: u({ step: "implement" }) },
  { unit: u({ step: "check" }) },
  { unit: u({ step: "implement", counters: spent("check.fail") }) },
  { unit: u({ step: "implement", counters: spent("check.fail"), waiting: { for: "answer", text: "Keep the comma?", next: `norn story answer ${KEY} "<answer>"` } }), needs: { command: youLine(paths, `norn story answer ${KEY} "Keep the comma."`), receipt: true } },
  { unit: u({ step: "check", counters: spent("check.fail") }) },
  { unit: u({ step: "review", counters: spent("check.fail") }) },
  { unit: u({ step: "implement", counters: spent("check.fail", "review.changes_requested") }) },
  { unit: u({ step: "describe", counters: spent("check.fail", "review.changes_requested") }) },
  { unit: u({ step: "open-pr", counters: spent("check.fail", "review.changes_requested") }) },
  { unit: u({ step: "ready", waiting: gate }), needs: { command: youLine(paths, `norn story reject ${KEY} --reason "Name the greeting in the README too."`), receipt: true } },
  { unit: u({ step: "implement", counters: spent("land.rejected") }) },
  { unit: u({ step: "ready", waiting: gate, counters: spent("land.rejected") }), needs: { command: youLine(paths, `norn story approve ${KEY}`), receipt: true } },
  { unit: u({ step: "merge", counters: spent("land.rejected") }), needs: { command: youLine(paths, `git merge --no-ff --no-edit norn/${KEY} && git push -q origin main`), receipt: false } },
  { unit: u({ step: "merge", ended: "done", counters: spent("land.rejected") }), claimed: true },
  { unit: u({ step: "merge", ended: "done", counters: spent("land.rejected") }) },
];

/**
 * A lab over the story above: a tick moves it one stop on unless it waits on the person, and the
 * person's command, run by the lab or in another shell, lets the next tick move it on.
 */
function world(stops: Stop[] = STORY, at = 0) {
  let i = at;
  let decided = false;
  const ran: string[] = [];
  const elsewhere: string[] = [];
  const decide = (command: string): number => {
    const needs = stops[i]?.needs;
    if (needs?.command !== command) return 1;
    decided = true;
    return 0;
  };
  return {
    ran,
    elsewhere,
    state: async (): Promise<LabState> => {
      const unit = stops[i]?.unit ?? null;
      const pending = decided && stops[i]?.needs?.receipt === true ? 1 : 0;
      return { key: KEY, unit: unit === null ? null : { ...unit, pending_receipts: pending }, claimed: stops[i]?.claimed ?? false };
    },
    tick: async () => {
      if (stops[i]?.needs !== undefined && !decided) return;
      decided = false;
      if (i < stops.length - 1) i++;
    },
    run: async (command: string) => {
      ran.push(command);
      const code = decide(command);
      return { code, output: code === 0 ? "ok" : "no" };
    },
    /** the person runs a command in a shell of their own */
    runElsewhere: (command: string) => {
      elsewhere.push(command);
      return decide(command);
    },
  };
}

/** A terminal: what the tour said, and what the person does at each prompt: Enter, unless `onLine` does otherwise. */
function terminal(onLine: (line: string, enter: () => void) => void = (_l, enter) => enter()) {
  const said: string[] = [];
  const waiting: ((line: string | null) => void)[] = [];
  const queued: (string | null)[] = [];
  const press = (line: string | null) => {
    const w = waiting.shift();
    if (w) w(line);
    else queued.push(line);
  };
  async function* keys(): AsyncGenerator<string> {
    for (;;) {
      const line = queued.length ? queued.shift() : await new Promise<string | null>((r) => waiting.push(r));
      if (line === null || line === undefined) return;
      yield line;
    }
  }
  return {
    said,
    input: lineInput(keys()),
    say: (line: string) => {
      said.push(line);
      if (line.startsWith("Press Enter") || line.startsWith("Run it in another shell")) onLine(line, () => press(""));
    },
    end: () => press(null),
  };
}

const tick0 = () => new Promise<void>((r) => setTimeout(r, 0));

describe("norn lab --tty", () => {
  test("AC1: with Enter pressed at every pause it plays the eight beats in order, saying each caption once, and ends with the story done", async () => {
    const w = world();
    const t = terminal();
    const end = await playTour(script, paths, { ...w, say: t.say, input: t.input, sleep: tick0 }, 0);
    expect(end.unit?.ended).toBe("done");
    const titles = t.said.filter((l) => l.startsWith("## Beat "));
    expect(titles).toEqual(script.beats.map((b) => `## Beat ${b.n} of 8: ${b.title}`));
    for (const b of script.beats) expect(t.said.filter((l) => l === b.caption.replaceAll("{key}", KEY))).toHaveLength(1);
    expect(t.said.at(-1)).toContain("ended `done`");
  });

  test("AC4: a beat is told only once what it narrates shows in the story's state, which holds while the tour pauses on it", async () => {
    const w = world();
    let ticks = 0;
    const tick = async () => {
      ticks++;
      await w.tick();
    };
    const told: { n: number; unit: LabUnit | null }[] = [];
    const held: boolean[] = [];
    const t = terminal((line, enter) => {
      if (!line.startsWith("Press Enter")) return enter();
      // a pause holds the story where its caption put it: no tick, no change, until Enter
      void w.state().then((before) => {
        const n = ticks;
        setTimeout(() => {
          void w.state().then((after) => {
            held.push(ticks === n && JSON.stringify(after.unit) === JSON.stringify(before.unit));
            enter();
          });
        }, 5);
      });
    });
    const say = (line: string) => {
      const m = /^## Beat (\d+) of/.exec(line);
      if (m) void w.state().then((s) => told.push({ n: Number(m[1]), unit: s.unit }));
      t.say(line);
    };
    await playTour(script, paths, { ...w, tick, say, input: t.input, sleep: tick0 }, 0);
    const at = (n: number) => told.find((b) => b.n === n)?.unit;
    // beat 1 says the story was claimed and synced: the unit is past sync
    expect(at(1)?.step).toBe("implement");
    // beat 2 says the check failed and the work went back to implement, where check.fail is 1
    expect(at(2)).toMatchObject({ step: "implement", counters: { "check.fail": { value: 1 } } });
    // beat 3 says the agent asked: the unit waits for an answer
    expect(at(3)?.waiting?.for).toBe("answer");
    // beat 4 says review approved on the rework: the unit is past review
    expect(at(4)?.step).toBe("describe");
    expect(at(4)?.counters["review.changes_requested"]?.value).toBe(1);
    // beat 5 says the describe agent's retry reported done: the unit is past describe
    expect(at(5)?.step).toBe("open-pr");
    expect(at(6)?.step).toBe("ready");
    expect(at(7)?.waiting?.for).toBe("gate");
    expect(at(8)?.step).toBe("merge");
    expect(held.length).toBeGreaterThan(0);
    expect(held.every(Boolean)).toBe(true);
  });

  test("AC9: once the story ended it ticks on until the story's claim is given up, and says the end once", async () => {
    const w = world();
    const t = terminal();
    const end = await playTour(script, paths, { ...w, say: t.say, input: t.input, sleep: tick0 }, 0);
    expect(end).toMatchObject({ unit: { ended: "done" }, claimed: false });
    expect(t.said.filter((l) => l.includes("ended `done`"))).toHaveLength(1);
  });

  test("AC2: at each beat that needs the person it prints the exact command with the lab's norn home and repo, and Enter runs that command", async () => {
    const w = world();
    const t = terminal();
    await playTour(script, paths, { ...w, say: t.say, input: t.input, sleep: tick0 }, 0);
    const wanted = STORY.flatMap((s) => (s.needs ? [s.needs.command] : []));
    expect(w.ran).toEqual(wanted);
    for (const c of wanted) {
      expect(c).toContain(`cd ${paths.repo} && export NORN_HOME_DIR=${paths.home} && `);
      expect(t.said).toContain(`    ${c}`);
    }
    // the decision comes before its pause: a beat that needs the person waits on its command alone
    const reject = t.said.indexOf(`    ${wanted[1]}`);
    const beat7 = t.said.indexOf("## Beat 7 of 8: The gate waits for you");
    expect(beat7).toBeGreaterThan(-1);
    expect(t.said.slice(beat7, reject).filter((l) => l.startsWith("Press Enter"))).toEqual([]);
  });

  test("AC3: a command run in another shell while it waits moves the tour on without Enter, and the lab runs nothing for it", async () => {
    const w = world();
    const answer = STORY[5]?.needs?.command as string;
    const t = terminal((line, enter) => {
      if (line.startsWith("Run it in another shell") && w.ran.length === 0 && w.elsewhere.length === 0) setTimeout(() => w.runElsewhere(answer), 5);
      else enter();
    });
    const end = await playTour(script, paths, { ...w, say: t.say, input: t.input, sleep: tick0 }, 0);
    expect(end.unit?.ended).toBe("done");
    expect(w.elsewhere).toEqual([answer]);
    expect(w.ran).not.toContain(answer);
    expect(w.ran).toHaveLength(3);
  });

  test("with its input ended it goes on at every pause and runs each command itself", async () => {
    const w = world();
    const t = terminal(() => {});
    t.end();
    const end = await playTour(script, paths, { ...w, say: t.say, input: t.input, sleep: tick0 }, 0);
    expect(end.unit?.ended).toBe("done");
    expect(w.ran).toHaveLength(4);
  });

  test("resumed mid-story it starts at the beat the story is at, saying no earlier caption", async () => {
    const w = world(STORY, 11);
    const t = terminal();
    await playTour(script, paths, { ...w, say: t.say, input: t.input, sleep: tick0 }, 6);
    expect(t.said.filter((l) => l.startsWith("## Beat ")).map((l) => l.slice(0, 9))).toEqual(["## Beat 7", "## Beat 8"]);
  });

  test("a command the lab runs that fails is refused with its output", async () => {
    const w = world();
    const t = terminal();
    const failing = { ...w, run: async (c: string) => (w.ran.push(c), { code: 2, output: "merge conflict" }) };
    const r = playTour(script, paths, { ...failing, say: t.say, input: t.input, sleep: tick0 }, 0);
    await expect(r).rejects.toMatchObject({ body: { code: "lab_failed" } });
  });

  test("the printed command is a subshell, so pasting it leaves the person's shell where it was", () => {
    expect(youLine(paths, "norn story approve lt-1")).toBe(`(cd ${paths.repo} && export NORN_HOME_DIR=${paths.home} && norn story approve lt-1)`);
    expect(youLine(labPaths("/tmp/a b"), "x")).toBe("(cd '/tmp/a b/norn-lab/repo' && export NORN_HOME_DIR='/tmp/a b/norn-lab/home' && x)");
  });
});
