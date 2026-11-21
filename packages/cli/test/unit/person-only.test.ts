import { describe, expect, test } from "bun:test";
import { RUN_ENV } from "@norn/plugin-api";
import { COMMANDS, NOUNS } from "../../src/commands/index.ts";
import { ExitCode, runCli } from "../../src/index.ts";
import type { TestMachine } from "./support.ts";
import { AGENT_STEP, configured, GATE_STEP, RUN, receiptsOf, runEnv, seedUnit, UNIT, withEnv } from "./units.ts";

const json = (stdout: string) => Bun.JSONL.parse(stdout)[0] as { error?: string; do_instead?: string; code?: string };

/** Each person-only command with arguments it accepts, so only the person-only rule can refuse it. */
const PERSON_ONLY: Record<string, string[]> = {
  "story approve": ["story", "approve", UNIT],
  "story reject": ["story", "reject", UNIT, "--reason", "split it"],
  "story answer": ["story", "answer", UNIT, "yes"],
  "story round": ["story", "round", UNIT, "--workflow", "quick"],
  "story take": ["story", "take", UNIT],
  "story update-branch": ["story", "update-branch", UNIT],
  "story close": ["story", "close", UNIT],
  "run start": ["run", "start", UNIT],
  "run stop": ["run", "stop", UNIT],
  "run rerun": ["run", "rerun", UNIT],
  tidy: ["tidy", "--dry-run"],
  "workflow confirm": ["workflow", "confirm", "story"],
  // only for the policy: what the person lets stand in for them is theirs to grant
  "config set": ["config", "set", "policy.stand_in.gates", "[story.ready]", "--user"],
};

type Ancestor = { pid: number; env: Record<string, string> | null };

/** The machine with this process's ancestors as the host reads them, nearest first; `asked` gets the names each read asked for. */
function withAncestry(m: TestMachine, read: () => Promise<Ancestor[]>, asked: string[][] = []): TestMachine {
  return { ...m, io: { ...m.io, hosts: { ...m.io.hosts, ancestry: async (names) => (asked.push([...names]), read()) } } };
}

const all = [...COMMANDS, ...NOUNS.flatMap((n) => n.verbs)];

describe("person-only commands", () => {
  test("the commands marked person-only are exactly a person's decisions and moves", () => {
    expect(all.filter((c) => c.personOnly).map((c) => c.name).sort()).toEqual(Object.keys(PERSON_ONLY).sort());
  });

  test.each(Object.entries(PERSON_ONLY))("%s is refused inside an agent's session, telling the agent to ask the person", async (name, argv) => {
    const m = configured();
    await seedUnit(m, { step: GATE_STEP, run: null });
    const r = await runCli([...argv, "--json"], withEnv(m, runEnv()).io);
    expect(r.exit).toBe(ExitCode.refused);
    const body = json(r.stdout);
    expect(body.code).toBe("person_only");
    expect(body.error).toContain(`norn ${name}`);
    expect(body.error).toContain(RUN);
    expect(body.do_instead).toContain('norn ask "');
    expect(body.do_instead).toContain("own shell");
    expect(await receiptsOf(m)).toEqual([]);
  });

  test("either half of the launch env marks an agent's session; an empty one does not", async () => {
    const m = configured();
    await seedUnit(m, { step: GATE_STEP, run: null });
    const unitOnly = await runCli(["story", "approve", UNIT, "--json"], withEnv(m, { [RUN_ENV.unit]: UNIT }).io);
    expect(json(unitOnly.stdout).code).toBe("person_only");
    const runOnly = await runCli(["story", "approve", UNIT, "--json"], withEnv(m, { [RUN_ENV.run]: RUN }).io);
    expect(json(runOnly.stdout).code).toBe("person_only");
    const blank = await runCli(["story", "approve", UNIT, "--json"], withEnv(m, { [RUN_ENV.unit]: " ", [RUN_ENV.run]: "" }).io);
    expect(blank.exit).toBe(ExitCode.ok);
  });

  test("without --json the refusal prints as markdown with the same exit", async () => {
    const m = configured();
    const r = await runCli(["story", "approve", UNIT], withEnv(m, runEnv()).io);
    expect(r.exit).toBe(ExitCode.refused);
    expect(r.stdout).toContain("norn ask");
    expect(r.stdout).not.toStartWith("{");
  });

  test("config set is a person's command only for a policy key: any other key an agent may set", async () => {
    const m = configured();
    const policy = await runCli(["config", "set", "policy", "{stand_in: {gates: []}}", "--json"], withEnv(m, runEnv()).io);
    expect(json(policy.stdout)).toMatchObject({ code: "person_only" });
    expect(json(policy.stdout).error).toContain("norn config set policy");
    expect((await runCli(["config", "set", "base", "dev", "--json"], withEnv(m, runEnv()).io)).exit).toBe(ExitCode.ok);
  });

  test("the refusal comes before argument checks, so no flag gets an agent past it", async () => {
    const r = await runCli(["story", "approve", UNIT, "--force", "--json"], withEnv(configured(), runEnv()).io);
    expect(r.exit).toBe(ExitCode.refused);
    expect(json(r.stdout).code).toBe("person_only");
  });

  test("outside an agent's session a person-only command runs", async () => {
    const m = configured();
    await seedUnit(m, { step: GATE_STEP, run: null });
    expect((await runCli(["story", "approve", UNIT, "--json"], m.io)).exit).toBe(ExitCode.ok);
    expect((await receiptsOf(m)).map((r) => r.data.kind)).toEqual(["gate.decided"]);
    expect((await runCli(["tidy", "--dry-run", "--json"], m.io)).exit).toBe(ExitCode.ok);
  });

  test.each([
    ["brief", ["brief"], null],
    ["done", ["done", "done"], "done"],
    ["ask", ["ask", "which way?"], "ask"],
    ["stuck", ["stuck", "blocked"], "stuck"],
    ["status", ["status"], null],
    ["story view", ["story", "view", UNIT], null],
  ] as const)("%s works in an agent's session as it does anywhere", async (_name, argv, verb) => {
    const m = configured();
    await seedUnit(m, { step: AGENT_STEP, run: RUN });
    const r = await runCli([...argv, "--json"], withEnv(m, runEnv()).io);
    expect(r.exit).toBe(ExitCode.ok);
    expect(json(r.stdout).error).toBeUndefined();
    // a report reaches the record, as the agent's own commands are what the session is for
    const reported = (await receiptsOf(m)).flatMap((x) => (x.data.kind === "run.reported" ? [x.data.verb] : []));
    expect(reported).toEqual(verb === null ? [] : [verb]);
  });

  describe("an agent that clears the launch env", () => {
    test("is still refused when an ancestor process was started with it, as clearing a shell's env cannot reach its parents'", async () => {
      const m = configured();
      await seedUnit(m, { step: GATE_STEP, run: null });
      const asked: string[][] = [];
      const ancestors: Ancestor[] = [
        { pid: 300, env: {} },
        { pid: 200, env: { [RUN_ENV.unit]: UNIT, [RUN_ENV.run]: RUN } },
        { pid: 100, env: null },
      ];
      const r = await runCli(["story", "approve", UNIT, "--json"], withAncestry(m, async () => ancestors, asked).io);
      expect(r.exit).toBe(ExitCode.refused);
      const body = json(r.stdout);
      expect(body.code).toBe("person_only");
      expect(body.error).toContain("norn story approve");
      expect(body.error).toContain(RUN);
      expect(body.error).toContain("200");
      expect(body.do_instead).toContain('norn ask "');
      expect(asked).toEqual([[RUN_ENV.unit, RUN_ENV.run]]);
      expect(await receiptsOf(m)).toEqual([]);
    });

    test("an ancestry with no launch env, or a blank one, or one the OS would not show, lets a person run the command", async () => {
      const m = configured();
      await seedUnit(m, { step: GATE_STEP, run: null });
      const ancestors: Ancestor[] = [
        { pid: 300, env: {} },
        { pid: 200, env: { [RUN_ENV.unit]: " ", [RUN_ENV.run]: "" } },
        { pid: 100, env: null },
      ];
      const r = await runCli(["story", "approve", UNIT, "--json"], withAncestry(m, async () => ancestors).io);
      expect(r.exit).toBe(ExitCode.ok);
      expect((await receiptsOf(m)).map((x) => x.data.kind)).toEqual(["gate.decided"]);
    });

    test("an ancestry the host cannot read refuses the command rather than guessing it is a person's", async () => {
      const m = configured();
      await seedUnit(m, { step: GATE_STEP, run: null });
      const r = await runCli(
        ["story", "approve", UNIT, "--json"],
        withAncestry(m, async () => {
          throw new Error("ps: not found");
        }).io,
      );
      expect(r.exit).toBe(ExitCode.refused);
      const body = json(r.stdout);
      expect(body.code).toBe("person_only");
      expect(body.error).toContain("ps: not found");
      expect(await receiptsOf(m)).toEqual([]);
    });

    test("a command anyone may run never reads the ancestry", async () => {
      const m = configured();
      await seedUnit(m, { step: AGENT_STEP, run: RUN });
      const asked: string[][] = [];
      const r = await runCli(["status", "--json"], withAncestry(m, async () => [{ pid: 200, env: { [RUN_ENV.run]: RUN } }], asked).io);
      expect(r.exit).toBe(ExitCode.ok);
      expect(asked).toEqual([]);
    });
  });
});
