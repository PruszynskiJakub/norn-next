/** `norn lab --tty` plays the tour in the terminal, a pause at each beat and each decision's command printed. */
import { describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { nodeExec } from "@norn/host-node";
import { MAIN, sh } from "./world.ts";
import { calledBeyondVersion, KEY, type LabSeen, machine, NORN_TIMEOUT_MS, type Out, parsed, SLOW, story } from "./lab-world.ts";

describe("norn lab --tty plays the tour in the terminal", () => {
  test(
    "AC1, AC2, AC3: Enter at each pause plays the eight beats to done with their captions; each decision prints its exact command, Enter runs it, and one run in another shell moves the tour on without it",
    async () => {
      const l = await machine();
      // `norn` on the person's PATH is this build, so a printed command runs as pasted
      const bin = join(l.dir, "norn-bin");
      mkdirSync(bin);
      writeFileSync(join(bin, "norn"), `#!/bin/sh\nexec bun '${MAIN}' "$@"\n`);
      chmodSync(join(bin, "norn"), 0o755);
      const env = { ...l.env, PATH: `${bin}:${l.env.PATH}` };
      const proc = Bun.spawn(["bun", MAIN, "lab", "--tty", "--json"], { cwd: l.sibling, env, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
      const said: string[] = [];
      const printed: string[] = [];
      const elsewhere: Out[] = [];
      let prompts = 0;
      const decoder = new TextDecoder();
      let partial = "";
      for await (const chunk of proc.stderr) {
        partial += decoder.decode(chunk, { stream: true });
        const lines = partial.split("\n");
        partial = lines.pop() ?? "";
        for (const line of lines) {
          said.push(line);
          if (line.startsWith("    (cd ")) printed.push(line.trim());
          if (line === "Press Enter to go on.") {
            proc.stdin.write("\n");
            proc.stdin.flush();
          }
          // the printed command follows its prompt; the first one, the answer, the person runs in a shell of their own
          if (line.startsWith("    (cd ") && prompts++ > 0) {
            proc.stdin.write("\n");
            proc.stdin.flush();
          } else if (line.startsWith("    (cd ")) elsewhere.push(parsed(await nodeExec(["sh", "-c", line.trim()], { cwd: l.dir, env, timeoutMs: NORN_TIMEOUT_MS })));
        }
      }
      const code = await proc.exited;
      const out = await new Response(proc.stdout).text();
      if (code !== 0) throw new Error(`norn lab --tty exited ${code}: ${out}\n${said.join("\n")}`);
      const lab = JSON.parse(out) as LabSeen;

      expect(lab).toMatchObject({ story: KEY, ended: "done", next: null, beat: { n: 8 } });
      expect(said.filter((s) => s.startsWith("## Beat ")).map((s) => s.slice(0, 9))).toEqual([1, 2, 3, 4, 5, 6, 7, 8].map((n) => `## Beat ${n}`));
      expect(said.some((s) => s.includes("ended `done`"))).toBe(true);
      const where = `(cd ${l.repo} && export NORN_HOME_DIR=${l.home} && `;
      expect(printed).toEqual([
        `${where}norn story answer ${KEY} "Keep the comma.")`,
        `${where}norn story reject ${KEY} --reason "Name the greeting in the README too.")`,
        `${where}norn story approve ${KEY})`,
        `${where}git merge --no-ff --no-edit norn/${KEY} && git push -q origin main)`,
      ]);
      expect(elsewhere.map((r) => r.code)).toEqual([0]);
      expect(said.filter((s) => s === "You ran it: the story moved on.")).toHaveLength(1);
      const end = await story(l);
      expect(end?.units[0]).toMatchObject({ ended: "done", counters: { "land.rejected": { value: 1 } } });
      expect(end?.claim).toBeNull();
      expect(await sh(l.repo, "git", "log", "--format=%s", "main")).toContain("Name the greeting in the README");
      expect(calledBeyondVersion(l)).toEqual([]);
    },
    SLOW,
  );
});
