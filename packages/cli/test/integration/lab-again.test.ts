/** Two `norn lab`s under different TMPDIRs share nothing, `--clean` starts one again, and one executor line swaps its agent. */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_LOCAL_FILE } from "../../src/config/paths.ts";
import { sh } from "./world.ts";
import { calledBeyondVersion, KEY, machine, norn, nornLab, parkedOn, SLOW, snapshot, story, tickUntil } from "./lab-world.ts";

describe("norn lab, side by side and again", () => {
  test(
    "AC11, AC12, AC13: two labs under different TMPDIRs share nothing; --clean starts one again from beat 1; one executor line swaps the stand-in for a real agent",
    async () => {
      const [a, b] = await Promise.all([machine(), machine()]);
      const [la, lb] = await Promise.all([nornLab(a), nornLab(b)]);
      expect(la.root).not.toBe(lb.root);
      expect(la.root.startsWith(a.tmp)).toBe(true);
      expect(lb.root.startsWith(b.tmp)).toBe(true);
      const [ua, ub] = await Promise.all([tickUntil(a, { rules: [], seen: [] }, parkedOn("answer")), tickUntil(b, { rules: [], seen: [] }, parkedOn("answer"))]);
      expect([ua.id, ub.id]).toEqual([KEY, KEY]);
      // each lab's norn home knows its own repo alone
      for (const l of [a, b]) {
        const repos = readdirSync(join(l.home, "repos"));
        expect(repos).toHaveLength(1);
        expect(JSON.stringify(snapshot(join(l.home, "repos", repos[0] as string)))).not.toContain((l === a ? b : a).root);
      }

      const again = await nornLab(a, "--clean");
      expect(again).toMatchObject({ built: true, story: KEY, beat: { n: 1 }, waiting: null });
      expect((await story(a))?.units ?? []).toEqual([]);
      expect(await sh(a.repo, "git", "worktree", "list")).not.toContain(`[norn/${KEY}]`);
      // the other lab is where it was
      expect((await story(b))?.units[0]).toMatchObject({ step: "implement", waiting: { for: "answer" } });

      // the person edits the one line that names the lab's agent
      const file = join(b.repo, REPO_LOCAL_FILE);
      const text = readFileSync(file, "utf8");
      const line = "  lab: { harness: lab, runner: headless }";
      expect(text.split("\n").filter((t) => t.includes("harness"))).toEqual([expect.stringContaining("# the stand-in agent"), line]);
      writeFileSync(file, text.replace(line, "  lab: { harness: claude, runner: headless }"));
      expect((await norn(b, "config", "get", "executors.lab", "--json")).body.value).toEqual({ harness: "claude", runner: "headless" });
      expect(calledBeyondVersion(b)).toEqual([]);
    },
    SLOW,
  );
});
