/**
 * A policy grant that takes a workflow off the floor is the person's policy to narrow, not a broken
 * pack: that workflow starts no new round, every other command goes on, and a unit already pinned to
 * it keeps ticking.
 */
import { describe, expect, test } from "bun:test";
import { configPaths, ExitCode, runCli } from "../../src/index.ts";
import { HOME, ROOT } from "./support.ts";
import { configured, envOf, GATE_STEP, seedUnit, UNIT } from "./units.ts";

const PATHS = configPaths(HOME, ROOT);
const json = (stdout: string): Record<string, unknown> => Bun.JSONL.parse(stdout)[0] as Record<string, unknown>;
const GRANT = "policy: { stand_in: { gates: [story.ready] } }\n";

describe("a grant that breaks the floor", () => {
  test("a unit pinned to the workflow keeps ticking, a new round of it is refused naming the policy key, and doctor says which grant to narrow", async () => {
    const m = configured();
    await seedUnit(m, { step: GATE_STEP, run: null });
    expect((await runCli(["story", "take", UNIT, "--json"], m.io)).exit).toBe(ExitCode.ok);
    await m.files.write(PATHS.user, GRANT);
    expect((await runCli(["story", "approve", UNIT, "--json"], m.io)).exit).toBe(ExitCode.ok);

    const tick = await runCli(["tick", "--json"], m.io);
    expect(json(tick.stdout).code).toBeUndefined();
    const read = await (await envOf(m)).journal.readUnit(UNIT);
    if (!read.ok) throw new Error(read.failure.message);
    expect(read.value.state?.step).not.toBe(GATE_STEP);

    const asked = await runCli(["story", "create", "Do it", "--workflow", "story", "--json"], m.io);
    const body = json(asked.stdout);
    expect({ exit: asked.exit, code: body.code }).toEqual({ exit: ExitCode.refused, code: "workflow_policy_floor" });
    expect(String(body.error)).toContain("the policy grants ready to a stand-in (policy.stand_in.gates)");
    expect(String(body.do_instead)).toContain("policy.stand_in.gates");
    expect(String(body.do_instead)).not.toContain("plugin");

    const checks = json((await runCli(["doctor", "--json"], m.io)).stdout).checks as Array<{ name: string; ok: boolean; warning?: string; do_instead?: string }>;
    const workflows = checks.find((c) => c.name === "workflows");
    expect(workflows?.ok).toBe(true);
    expect(workflows?.warning).toContain("workflow story starts no new round: your policy grants its gate ready to a stand-in");
    expect(workflows?.do_instead).toContain("norn config set policy.stand_in.gates");
  });
});
