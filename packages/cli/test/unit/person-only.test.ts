import { describe, expect, test } from "bun:test";
import { RUN_ENV } from "@norn/plugin-api";
import { COMMANDS, NOUNS } from "../../src/commands/index.ts";
import { ExitCode, runCli } from "../../src/index.ts";
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
};

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
    ["brief", ["brief"]],
    ["done", ["done", "done"]],
    ["ask", ["ask", "which way?"]],
    ["stuck", ["stuck", "blocked"]],
    ["status", ["status"]],
    ["story view", ["story", "view", UNIT]],
  ])("%s is not refused as person-only in an agent's session", async (_name, argv) => {
    const m = configured();
    await seedUnit(m, { step: AGENT_STEP, run: RUN });
    const r = await runCli([...argv, "--json"], withEnv(m, runEnv()).io);
    expect(r.stdout === "" ? undefined : json(r.stdout).code).not.toBe("person_only");
  });
});
