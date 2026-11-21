import { describe, expect, test } from "bun:test";
import { INPUTS_DIR, reportReceiptId, SPEC_ARTIFACT, worktreeOf, writeStoryDoc } from "@norn/runtime";
import type { RunState } from "@norn/kernel";
import type { CriterionVerdict } from "@norn/schema";
import { ExitCode, runCli } from "../../src/index.ts";
import { machine, ROOT, type TestMachine } from "./support.ts";
import { AGENT_STEP, configured, envOf, GATE_STEP, RUN, receiptsOf, runEnv, seedUnit, UNIT, withEnv } from "./units.ts";

const json = (stdout: string): unknown => Bun.JSONL.parse(stdout)[0];

/** Claude Code's Stop payload, as recorded from a real session. */
const STOP = JSON.stringify({
  session_id: "abc123",
  transcript_path: "/home/u/.claude/projects/-repo/abc123.jsonl",
  cwd: "/repo/.worktrees/gh-12",
  permission_mode: "default",
  hook_event_name: "Stop",
  stop_hook_active: false,
  last_assistant_message: "All tests pass.",
});

describe("norn hook always answers its harness", () => {
  test("a session norn did not launch is let through without a config, whatever its stdin", async () => {
    const r = await runCli(["hook", "claude", "Stop"], machine({ stdin: "not json{" }).io);
    expect({ exit: r.exit, stdout: r.stdout }).toEqual({ exit: 0, stdout: "" });
  });

  test("a launched session with no config answers nothing, exit 0, and says why on stderr", async () => {
    const r = await runCli(["hook", "claude", "Stop", "--json"], machine({ stdin: STOP, env: runEnv() }).io);
    expect({ exit: r.exit, stdout: r.stdout }).toEqual({ exit: 0, stdout: "" });
    expect(r.stderr).toStartWith("norn hook: ");
  });

  test("bad stdin, an unknown harness or a wrong argument count still answer, exit 0", async () => {
    const m = configured({ env: runEnv(), stdin: "not json{" });
    await seedUnit(m, { step: AGENT_STEP });
    for (const argv of [
      ["hook", "claude", "Stop"],
      ["hook", "nobody", "Stop"],
      ["hook", "claude"],
    ]) {
      const r = await runCli(argv, m.io);
      expect({ argv, exit: r.exit }).toEqual({ argv, exit: 0 });
    }
  });

  test("a live run that has not reported is blocked at Stop; once it reports done, Stop is allowed", async () => {
    const m = configured({ env: runEnv(), stdin: STOP });
    await seedUnit(m, { step: AGENT_STEP });
    const blocked = await runCli(["hook", "claude", "Stop"], m.io);
    expect(blocked.exit).toBe(0);
    expect(json(blocked.stdout)).toMatchObject({ decision: "block" });
    expect((json(blocked.stdout) as { reason: string }).reason).toContain("norn done");
    expect((await runCli(["done", "done"], m.io)).exit).toBe(ExitCode.ok);
    const allowed = await runCli(["hook", "claude", "Stop"], m.io);
    expect({ exit: allowed.exit, stdout: allowed.stdout }).toEqual({ exit: 0, stdout: "" });
  });
});

describe("the agent verbs act for the run in the launch env", () => {
  test("outside a launched session they refuse, naming the env and what to do instead", async () => {
    const r = await runCli(["done", "done", "--json"], configured().io);
    expect(r.exit).toBe(ExitCode.refused);
    expect(json(r.stdout)).toMatchObject({ code: "no_run_env", error: expect.stringContaining("NORN_UNIT") });
  });

  test("brief prints the live run's brief; a replaced run's session is refused", async () => {
    const m = configured({ env: runEnv() });
    await seedUnit(m, { step: AGENT_STEP });
    const r = await runCli(["brief", "--json"], m.io);
    expect(r.exit).toBe(ExitCode.ok);
    expect(json(r.stdout)).toMatchObject({ unit: UNIT, run_id: RUN, markdown: expect.stringContaining(AGENT_STEP) });
    expect((await runCli(["brief"], m.io)).stdout).toContain(AGENT_STEP);
    const stale = await runCli(["brief", "--json"], withEnv(m, runEnv(UNIT, "01JBBBBBBBBBBBBBBBBBBBBBBB")).io);
    expect({ exit: stale.exit, code: (json(stale.stdout) as { code: string }).code }).toEqual({ exit: ExitCode.refused, code: "stale_run" });
  });

  test("done with an outcome the step does not route refuses, listing the ones it does", async () => {
    const m = configured({ env: runEnv() });
    await seedUnit(m, { step: AGENT_STEP });
    const r = await runCli(["done", "shipped", "--json"], m.io);
    expect(r.exit).toBe(ExitCode.refused);
    expect(json(r.stdout)).toEqual({ error: 'outcome "shipped" is not one step slice routes', do_instead: "report one of `done`, `replan`", code: "outcome" });
    expect(await receiptsOf(m)).toEqual([]);
  });

  test("done while a merge waits to be concluded in the unit's worktree is refused with how to conclude it; stuck still goes through", async () => {
    const env = await envOf(configured());
    const worktree = env.slots.vcs.worktree.path(UNIT);
    const list = `worktree ${ROOT}\nHEAD ${"a".repeat(40)}\nbranch refs/heads/main\n\nworktree ${worktree}\nHEAD ${"a".repeat(40)}\nbranch refs/heads/lt-1-x\n\n`;
    const m = configured({
      env: runEnv(),
      script: (argv) => (argv[1] === "worktree" ? { stdout: list } : argv[1] === "diff" ? { stdout: "a.txt\n" } : undefined),
      revParse: (argv, o) => (o.cwd === worktree ? (argv.at(-1) === "MERGE_HEAD^{commit}" ? { stdout: `${"b".repeat(40)}\n` } : { code: 1 }) : undefined),
    });
    await seedUnit(m, { step: AGENT_STEP });
    const r = await runCli(["done", "done", "--json"], m.io);
    expect(r.exit).toBe(ExitCode.refused);
    expect(json(r.stdout)).toEqual({
      error: `a merge is still in progress in ${worktree} (unmerged: a.txt)`,
      do_instead: "resolve what is left, conclude the merge with `git commit`, then report again; if a person must choose, `norn ask` with the merge kept in progress",
      code: "merge_unfinished",
    });
    expect(await receiptsOf(m)).toEqual([]);
    expect((await runCli(["stuck", "cannot tell which side wins", "--json"], m.io)).exit).toBe(ExitCode.ok);
  });

  test("done while the unit's worktree holds uncommitted work is refused (exit 3) with how to commit it; norn's own files alone are not", async () => {
    const env = await envOf(configured());
    const worktree = env.slots.vcs.worktree.path(UNIT);
    const list = `worktree ${ROOT}\nHEAD ${"a".repeat(40)}\nbranch refs/heads/main\n\nworktree ${worktree}\nHEAD ${"a".repeat(40)}\nbranch refs/heads/lt-1-x\n\n`;
    const norns = [" M .agents/specs/lt-1/spec.md", "?? .agents/run/in/last_check.md"];
    let status = [...norns, " M src/app.ts", "?? notes.txt", ""].join("\0");
    const m = configured({
      env: runEnv(),
      script: (argv) => (argv[1] === "worktree" ? { stdout: list } : argv[1] === "status" ? { stdout: status } : undefined),
      revParse: (_argv, o) => (o.cwd === worktree ? { code: 1 } : undefined),
    });
    await seedUnit(m, { step: AGENT_STEP });
    const r = await runCli(["done", "done", "--json"], m.io);
    expect(r.exit).toBe(ExitCode.refused);
    expect(json(r.stdout)).toEqual({
      error: `${worktree} holds uncommitted work: notes.txt, src/app.ts`,
      do_instead: "run `git status` in the worktree, commit the work this step made, then report again; ask a person about a change you cannot tell whether to commit",
      code: "dirty_worktree",
    });
    expect(await receiptsOf(m)).toEqual([]);
    status = [...norns, ""].join("\0");
    expect((await runCli(["done", "done", "--json"], m.io)).exit).toBe(ExitCode.ok);
  });

  test("done while the unit's commits leave a conflict unresolved is refused (exit 3) naming file and line; once resolved it goes through", async () => {
    const conflicted = ["diff --git a/src/app.ts b/src/app.ts", "--- a/src/app.ts", "+++ b/src/app.ts", "@@ -1,0 +2,3 @@", `+${"<".repeat(7)} HEAD`, `+${"=".repeat(7)}`, `+${">".repeat(7)} main`, ""].join("\n");
    let diff = conflicted;
    const m = configured({ env: runEnv(), script: (argv) => (argv[0] === "git" && argv.includes("-U0") ? { stdout: diff } : undefined) });
    await seedUnit(m, { step: AGENT_STEP });
    const r = await runCli(["done", "done", "--json"], m.io);
    expect(r.exit).toBe(ExitCode.refused);
    expect(json(r.stdout)).toMatchObject({ code: "conflict_markers", error: expect.stringContaining("src/app.ts:2") });
    expect(await receiptsOf(m)).toEqual([]);
    diff = "";
    expect((await runCli(["done", "done", "--json"], m.io)).exit).toBe(ExitCode.ok);
  });

  test("a retried report records once; its id comes from the flag, else NORN_REPORT_ID, else what it reports", async () => {
    const m = configured({ env: runEnv() });
    await seedUnit(m, { step: AGENT_STEP });
    const first = json((await runCli(["done", "done", "--note", "all green", "--json"], m.io)).stdout);
    const again = json((await runCli(["done", "done", "--json"], m.io)).stdout);
    expect(first).toMatchObject({ report_id: `${RUN}.done.done`, replayed: false });
    expect(again).toMatchObject({ report_id: `${RUN}.done.done`, replayed: true, seq: (first as { seq: number }).seq });
    const other = await runCli(["done", "replan", "--json"], m.io);
    expect({ exit: other.exit, code: (json(other.stdout) as { code: string }).code }).toEqual({ exit: ExitCode.refused, code: "reported" });
    const receipts = await receiptsOf(m);
    expect(receipts.map((r) => [r.id, r.data])).toEqual([
      [reportReceiptId(`${RUN}.done.done`), { kind: "run.reported", step: AGENT_STEP, attempt: 1, run_id: RUN, verb: "done", outcome: "done", text: "all green" }],
    ]);

    const env = configured({ env: { ...runEnv(), NORN_REPORT_ID: "from-env" } });
    await seedUnit(env, { step: AGENT_STEP });
    expect(json((await runCli(["stuck", "no", "way", "--json"], env.io)).stdout)).toMatchObject({ report_id: "from-env", replayed: false });
    // the flag wins over the env: another id is another report, which a run that reported may not make
    expect(json((await runCli(["stuck", "no", "way", "--report-id", "from-flag", "--json"], env.io)).stdout)).toMatchObject({ code: "reported" });
    expect(json((await runCli(["stuck", "no", "way", "--report-id", "from-env", "--json"], env.io)).stdout)).toMatchObject({ report_id: "from-env", replayed: true });
    expect((await receiptsOf(env)).map((r) => r.id)).toEqual([reportReceiptId("from-env")]);
  });

  test("ask records the question as one argument; a run at a gate takes no report", async () => {
    const m = configured({ env: runEnv() });
    await seedUnit(m, { step: AGENT_STEP });
    expect((await runCli(["ask", "which", "db?"], m.io)).exit).toBe(ExitCode.ok);
    expect((await receiptsOf(m)).map((r) => r.data)).toEqual([{ kind: "run.reported", step: AGENT_STEP, attempt: 1, run_id: RUN, verb: "ask", text: "which db?" }]);
    const gate = configured({ env: runEnv() });
    await seedUnit(gate, { step: GATE_STEP });
    const r = await runCli(["done", "done", "--json"], gate.io);
    expect({ exit: r.exit, code: (json(r.stdout) as { code: string }).code }).toEqual({ exit: ExitCode.refused, code: "not_agent" });
  });
});

describe("done at a step with criteria: required", () => {
  const QA = "qa";
  const SPEC = ["---", 'key: "lt-1"', "criteria:", "  - { id: AC1, verifier: agent }", "  - { id: 01.AC2, verifier: test }", "---", "# The story", ""].join("\n");
  const pass: CriterionVerdict[] = [
    { id: "AC1", verdict: "pass", evidence: "AC1.md" },
    { id: "01.AC2", verdict: "pass", evidence: "test output" },
  ];

  async function atQa(spec: string | null = SPEC): Promise<TestMachine> {
    const m = configured({ env: runEnv() });
    await seedUnit(m, { step: QA });
    if (spec !== null) {
      const wrote = await writeStoryDoc(await envOf(m), UNIT, SPEC_ARTIFACT, spec);
      if (!wrote.ok) throw new Error(wrote.failure.message);
    }
    return m;
  }

  async function done(m: TestMachine, argv: string[], report?: unknown) {
    if (report !== undefined) await m.files.write(`${ROOT}/criteria.json`, typeof report === "string" ? report : JSON.stringify(report));
    const r = await runCli(["done", ...argv, "--json"], m.io);
    return { exit: r.exit, out: json(r.stdout) as Record<string, unknown> };
  }

  test("without --criteria it is refused with the full command, and nothing is recorded", async () => {
    const m = await atQa();
    const r = await done(m, ["pass"]);
    expect(r.exit).toBe(ExitCode.refused);
    expect(r.out).toEqual({
      error: "step qa produces criteria with every outcome: one verdict per criterion",
      do_instead: "write the report (a JSON array of {id, verdict, ...} covering AC1, 01.AC2) and run: norn done pass --criteria <file>",
      code: "criteria_required",
    });
    expect(await receiptsOf(m)).toEqual([]);
  });

  test("a report that is not JSON, or does not validate, is refused before anything is read or recorded", async () => {
    const m = await atQa();
    expect((await done(m, ["pass", "--criteria", "criteria.json"], "not json{")).out).toMatchObject({ code: "invalid_criteria", error: expect.stringContaining("criteria file criteria.json: not JSON") });
    const noEvidence = await done(m, ["pass", "--criteria", "criteria.json"], [{ id: "AC1", verdict: "pass" }]);
    expect(noEvidence.exit).toBe(ExitCode.refused);
    expect(noEvidence.out).toMatchObject({ code: "invalid_criteria", error: expect.stringContaining("criteria file criteria.json: /0"), do_instead: expect.stringContaining("pass needs evidence") });
    expect((await done(m, ["pass", "--criteria", "missing.json"])).out).toMatchObject({ code: "invalid_criteria", error: "criteria file not found: missing.json" });
    expect(await receiptsOf(m)).toEqual([]);
  });

  test("the report covers exactly the spec's frontmatter criteria", async () => {
    const m = await atQa();
    const short = await done(m, ["pass", "--criteria", "criteria.json"], [pass[0]]);
    expect(short).toEqual({
      exit: ExitCode.refused,
      out: {
        error: "the criteria report must cover exactly the unit's criteria (AC1, 01.AC2): missing 01.AC2",
        do_instead: "give one verdict for each of AC1, 01.AC2 and no other ids, then report again",
        code: "invalid_criteria",
      },
    });
    const extra = await done(m, ["pass", "--criteria", "criteria.json"], [...pass, { id: "AC9", verdict: "pass", evidence: "x" }]);
    expect(extra.out).toMatchObject({ code: "invalid_criteria", error: expect.stringContaining("unknown AC9") });
    const twice = await done(m, ["pass", "--criteria", "criteria.json"], [...pass, pass[0]]);
    expect(twice.out).toMatchObject({ code: "invalid_criteria", error: "the criteria report lists AC1 more than once" });
    expect(await receiptsOf(m)).toEqual([]);
  });

  test("an outcome that contradicts the worst verdict is refused, naming the outcome that matches", async () => {
    const m = await atQa();
    const report = [pass[0], { id: "01.AC2", verdict: "fail", repro: "run the test: it is red" }];
    const r = await done(m, ["pass", "--criteria", "criteria.json"], report);
    expect(r).toEqual({
      exit: ExitCode.refused,
      out: {
        error: "outcome 'pass' needs the worst verdict to be 'pass', but it is 'fail' (01.AC2); the matching outcome is 'fail'",
        do_instead: "norn done fail --criteria <file>",
        code: "outcome_contradicts_verdicts",
      },
    });
    expect(await receiptsOf(m)).toEqual([]);
    expect((await done(m, ["fail", "--criteria", "criteria.json", "--note", "01.AC2 is red"])).exit).toBe(ExitCode.ok);
  });

  test("the findings a failing report hands back carry each criterion it did not pass, with its repro", async () => {
    const m = await atQa();
    await done(m, ["fail", "--criteria", "criteria.json"], [pass[0], { id: "01.AC2", verdict: "fail", repro: "run the test: it is red" }]);
    // the unit moved on to implement, as a tick applying the report would leave it
    const env = await envOf(m);
    const read = await env.journal.readUnit(UNIT);
    if (!read.ok || !read.value.state) throw new Error("no record");
    const at = read.value.state;
    const moved: RunState = { ...at, step: "implement", applied_through: read.value.receipts.at(-1)?.seq ?? 0, run: at.run && { ...at.run, id: "01JCCCCCCCCCCCCCCCCCCCCCCC", step: "implement" } };
    const committed = await env.journal.commit(UNIT, moved, read.value.version);
    if (!committed.ok) throw new Error(committed.failure.message);
    const md = (await runCli(["brief"], withEnv(m, runEnv(UNIT, "01JCCCCCCCCCCCCCCCCCCCCCCC")).io)).stdout;
    expect(md).toContain("Criteria not passed:");
    expect(md).toContain("- `01.AC2` fail: run the test: it is red");
    expect(md).not.toContain("- `AC1`");
  });

  test("a matching report is recorded on the receipt, where later steps read it", async () => {
    const m = await atQa();
    const r = await done(m, ["pass", "--criteria", "criteria.json"], pass);
    expect(r.exit).toBe(ExitCode.ok);
    expect(r.out).toMatchObject({ outcome: "pass", replayed: false, criteria: { worst: "pass", coverage: "checked", counts: { pass: 2, fail: 0, person: 0, unverified: 0 } } });
    expect((await receiptsOf(m)).map((x) => x.data)).toEqual([{ kind: "run.reported", step: QA, attempt: 1, run_id: RUN, verb: "done", outcome: "pass", criteria: pass }]);
  });

  test("a retried done replays and prints the same criteria summary", async () => {
    const m = await atQa();
    const first = await done(m, ["pass", "--criteria", "criteria.json", "--report-id", "qa-1"], pass);
    const again = await done(m, ["pass", "--criteria", "criteria.json", "--report-id", "qa-1"]);
    expect(again.out).toMatchObject({ replayed: true, criteria: first.out.criteria as Record<string, unknown> });
    expect(await receiptsOf(m)).toHaveLength(1);
  });

  test("a slice whose worktree has no slice file is checked against the slice file the story keeps", async () => {
    const slice = `${UNIT}/01`;
    const m = configured({ env: runEnv(slice) });
    await seedUnit(m, { unit: slice, step: QA });
    const file = ["---", `id: ${slice}`, "depends_on: []", "criteria:", "  - { id: AC1, verifier: test }", "---", "## Goal", ""].join("\n");
    const wrote = await writeStoryDoc(await envOf(m), slice, "slices/01-parse.md", file);
    if (!wrote.ok) throw new Error(wrote.failure.message);
    const r = await done(m, ["pass", "--criteria", "criteria.json"], [{ id: "AC9", verdict: "pass", evidence: "x" }]);
    expect(r.out).toMatchObject({ code: "invalid_criteria", error: expect.stringContaining("missing AC1") });
    expect(await receiptsOf(m, slice)).toEqual([]);
    expect((await done(m, ["pass", "--criteria", "criteria.json"], [{ id: "AC1", verdict: "pass", evidence: "x" }])).out).toMatchObject({ criteria: { coverage: "checked" } });
  });

  test("a spec that declares no criteria leaves coverage unchecked; a spec whose criteria do not validate is refused", async () => {
    const none = await atQa(null);
    expect((await done(none, ["pass", "--criteria", "criteria.json"], pass)).out).toMatchObject({ criteria: { worst: "pass", coverage: "unchecked" } });
    const bad = await atQa(["---", "criteria:", "  - { id: AC1, verifier: robot }", "---", ""].join("\n"));
    const r = await done(bad, ["pass", "--criteria", "criteria.json"], pass);
    expect(r.out).toMatchObject({ code: "invalid_criteria", error: expect.stringContaining("criteria of .agents/specs/lt-1/spec.md do not validate") });
  });

  test("the brief names --criteria on every outcome and the verdict each one needs", async () => {
    const m = await atQa();
    const md = (await runCli(["brief"], m.io)).stdout;
    expect(md).toContain("- `norn done pass --criteria <file>`");
    expect(md).toContain("- `norn done unverified --criteria <file>`");
    expect(md).toContain("This step requires `--criteria <file>`");
    expect(md).toContain("`partial` only when it is `person`");
  });
});

describe("done at a step whose outcome hands back findings", () => {
  const REVIEW = "review";
  const IMPLEMENT_RUN = "01JCCCCCCCCCCCCCCCCCCCCCCC";

  async function atReview(): Promise<TestMachine> {
    const m = configured({ env: runEnv() });
    await seedUnit(m, { step: REVIEW });
    return m;
  }

  async function done(m: TestMachine, argv: string[], findings?: unknown) {
    if (findings !== undefined) await m.files.write(`${ROOT}/findings.json`, typeof findings === "string" ? findings : JSON.stringify(findings));
    const r = await runCli(["done", ...argv, "--json"], m.io);
    return { exit: r.exit, out: json(r.stdout) as Record<string, unknown> };
  }

  /** The unit moved on to implement, as a tick applying the report would leave it, sent back by the report. */
  async function reworked(m: TestMachine): Promise<string> {
    const env = await envOf(m);
    const read = await env.journal.readUnit(UNIT);
    if (!read.ok || !read.value.state) throw new Error("no record");
    const at = read.value.state;
    const seq = read.value.receipts.at(-1)?.seq ?? 0;
    const moved: RunState = { ...at, step: "implement", applied_through: seq, rework_from: seq, run: at.run && { ...at.run, id: IMPLEMENT_RUN, step: "implement" } };
    const committed = await env.journal.commit(UNIT, moved, read.value.version);
    if (!committed.ok) throw new Error(committed.failure.message);
    return (await runCli(["brief"], withEnv(m, runEnv(UNIT, IMPLEMENT_RUN)).io)).stdout;
  }

  const REVIEW_FILE = {
    summary: "2 findings, 1 blocking.",
    findings: [
      { id: "F1", axis: "spec", severity: "blocking", criterion: "AC2", file: "src/invites.ts", line: 42, title: "Expired invites are accepted", detail: "the expiry is never read", suggestion: "compare expires_at" },
      { id: "F2", axis: "standards", severity: "nit", file: "src/invites.ts", line: 7, title: "A comment says what, not why" },
    ],
  };

  test("an outcome that hands back findings, reported with none and no note, is refused naming --findings; nothing is recorded", async () => {
    const m = await atReview();
    const r = await done(m, ["changes_requested"]);
    expect(r).toEqual({
      exit: ExitCode.refused,
      out: {
        error: "step review hands back findings with outcome changes_requested (hand_back), and this report has none",
        do_instead:
          'write a JSON file {"findings": [{"severity": "blocking" | "major" | "minor" | "nit", "title": "...", "detail"?, "file"?, "line"?, "criterion"?, "repro"?}]} with at least one finding, then run: norn done changes_requested --findings <file>',
        code: "hand_back_required",
      },
    });
    const empty = await done(m, ["changes_requested", "--findings", "findings.json"], { findings: [] });
    expect(empty.out).toMatchObject({ code: "hand_back_required" });
    expect(await receiptsOf(m)).toEqual([]);
  });

  test("a findings file is validated: JSON, an array or {findings}, each with a title and a severity", async () => {
    const m = await atReview();
    expect((await done(m, ["changes_requested", "--findings", "findings.json"], "not json{")).out).toMatchObject({ code: "invalid_findings", error: expect.stringContaining("findings file findings.json") });
    expect((await done(m, ["changes_requested", "--findings", "findings.json"], { summary: "x" })).out).toMatchObject({ code: "invalid_findings" });
    expect((await done(m, ["changes_requested", "--findings", "findings.json"], [{ title: "no severity" }])).out).toMatchObject({
      code: "invalid_findings",
      error: "finding 1 in findings.json needs a title and a severity (blocking | major | minor | nit)",
    });
    expect((await done(m, ["changes_requested", "--findings", "missing.json"])).out).toMatchObject({ code: "invalid_findings", error: "findings file not found: missing.json" });
    expect(await receiptsOf(m)).toEqual([]);
  });

  test("the findings are copied into the receipt, the review's extra keys folded into the detail", async () => {
    const m = await atReview();
    expect((await done(m, ["changes_requested", "--findings", "findings.json"], REVIEW_FILE)).exit).toBe(ExitCode.ok);
    expect((await receiptsOf(m)).map((x) => x.data)).toEqual([
      {
        kind: "run.reported",
        step: REVIEW,
        attempt: 1,
        run_id: RUN,
        verb: "done",
        outcome: "changes_requested",
        findings: [
          { id: "F1", severity: "blocking", criterion: "AC2", file: "src/invites.ts", line: 42, title: "Expired invites are accepted", detail: "the expiry is never read\nAxis: spec\nSuggestion: compare expires_at" },
          { id: "F2", severity: "nit", file: "src/invites.ts", line: 7, title: "A comment says what, not why", detail: "Axis: standards" },
        ],
      },
    ]);
  });

  test("a note alone still hands the work back", async () => {
    const m = await atReview();
    expect((await done(m, ["changes_requested", "--note", "F1: expired invites are accepted (src/invites.ts:42)"])).exit).toBe(ExitCode.ok);
  });

  test("the rework's brief lists the findings, blocking first, under Rework and in last_findings", async () => {
    const m = await atReview();
    await done(m, ["changes_requested", "--findings", "findings.json"], REVIEW_FILE);
    const md = await reworked(m);
    expect(md).toContain("## Rework");
    expect(md).toContain("Blocking findings:");
    expect(md).toContain("- `F1` Expired invites are accepted (src/invites.ts:42, AC2)");
    expect(md).toContain("Other findings, notes for the person rather than rework:");
    expect(md).toContain("- `F2` nit: A comment says what, not why (src/invites.ts:7)");
    expect(md.indexOf("Blocking findings:")).toBeLessThan(md.indexOf("Other findings"));
    expect(md).not.toContain("no findings sent this work back");
  });

  test("a findings-only report is the review of the rework's last_findings, written as the input file", async () => {
    const m = await atReview();
    await done(m, ["changes_requested", "--findings", "findings.json"], REVIEW_FILE);
    const env = await envOf(m);
    const read = await env.journal.readUnit(UNIT);
    if (!read.ok || !read.value.state) throw new Error("no record");
    // the rework is done and the story is back at review, which no rework_from names: last_findings is the round's latest findings
    const implemented = await env.journal.record(UNIT, { id: "report-implement", data: { kind: "run.reported", step: "implement", attempt: 1, run_id: IMPLEMENT_RUN, verb: "done", outcome: "done" } });
    if (!implemented.ok) throw new Error(implemented.failure.message);
    const at = read.value.state;
    const REVIEW_RUN = "01JDDDDDDDDDDDDDDDDDDDDDDD";
    const back: RunState = { ...at, step: REVIEW, attempt: 2, applied_through: implemented.value.seq, run: at.run && { ...at.run, id: REVIEW_RUN, step: REVIEW, attempt: 2 } };
    const committed = await env.journal.commit(UNIT, back, read.value.version);
    if (!committed.ok) throw new Error(committed.failure.message);
    expect((await runCli(["brief"], withEnv(m, runEnv(UNIT, REVIEW_RUN)).io)).exit).toBe(ExitCode.ok);
    const file = (await m.files.read(`${worktreeOf(env, UNIT)}/${INPUTS_DIR}/last_findings.md`)) ?? "";
    expect(file).toContain("`review` reported `done changes_requested`.");
    expect(file).toContain("Blocking findings:");
    expect(file).toContain("- `F1` Expired invites are accepted (src/invites.ts:42, AC2)");
  });

  test("an empty findings file at an outcome that hands nothing back is recorded without findings", async () => {
    const m = await atReview();
    expect((await done(m, ["approve", "--findings", "findings.json"], { findings: [] })).exit).toBe(ExitCode.ok);
    expect((await receiptsOf(m)).map((x) => x.data)).toEqual([{ kind: "run.reported", step: REVIEW, attempt: 1, run_id: RUN, verb: "done", outcome: "approve" }]);
  });

  test("the brief names --findings on the outcome that hands findings back", async () => {
    const m = await atReview();
    const md = (await runCli(["brief"], m.io)).stdout;
    expect(md).toContain("- `norn done changes_requested --findings <file>`");
    expect(md).toContain("- `norn done approve` —");
    expect(md).toContain('`--findings <file>` is a JSON file, `{"findings": [...]}` or an array');
  });
});

describe("a criteria report's notes for a person", () => {
  test("a verdict's note is kept on the receipt's notes, naming its criterion", async () => {
    const m = configured({ env: runEnv() });
    await seedUnit(m, { step: "qa" });
    const report: CriterionVerdict[] = [{ id: "AC1", verdict: "pass", evidence: "AC1.md", note: "the copy reads oddly on mobile; worth a look" }];
    await m.files.write(`${ROOT}/criteria.json`, JSON.stringify(report));
    expect((await runCli(["done", "pass", "--criteria", "criteria.json", "--json"], m.io)).exit).toBe(ExitCode.ok);
    expect((await receiptsOf(m)).map((x) => x.data)).toEqual([
      { kind: "run.reported", step: "qa", attempt: 1, run_id: RUN, verb: "done", outcome: "pass", criteria: report, notes: [{ text: "the copy reads oddly on mobile; worth a look", criterion: "AC1" }] },
    ]);
  });
});

describe("an attended step's brief follows how its run was started", () => {
  test("a run started headless is told no person reads the session and to ask through norn ask", async () => {
    const m = configured({ env: runEnv() });
    await seedUnit(m, { workflow: "refinement", step: "refine", attended: false });
    const md = (await runCli(["brief"], m.io)).stdout;
    expect(md).toContain("You run unattended: no person reads this session. A question goes through `norn ask`");
    expect(md).toContain('- `norn ask "<one self-contained question>"`');
    expect(md).not.toContain("never through `norn ask`");
  });

  test("a launch not yet applied is briefed from its start receipt: headless asks through norn ask", async () => {
    const m = configured({ env: runEnv() });
    // the launch's brief renders after the start receipt is written and before a tick applies it
    await seedUnit(m, { workflow: "refinement", step: "refine", run: null });
    const env = await envOf(m);
    const started = await env.journal.record(UNIT, { id: "launch", data: { kind: "run.started", step: "refine", attempt: 1, run_id: RUN, run_kind: "agent", executor: "claude", attended: false } });
    if (!started.ok) throw new Error(started.failure.message);
    const md = (await runCli(["brief"], m.io)).stdout;
    expect(md).toContain("You run unattended: no person reads this session. A question goes through `norn ask`");
    expect(md).not.toContain("never through `norn ask`");
  });

  test("a run started attended keeps the person in the session", async () => {
    const m = configured({ env: runEnv() });
    await seedUnit(m, { workflow: "refinement", step: "refine", attended: true });
    const md = (await runCli(["brief"], m.io)).stdout;
    expect(md).toContain("A person works with you in this session");
    expect(md).toContain("never through `norn ask`");
  });
});

describe("done at a step that produces a file", () => {
  test("describe's done is refused while pr.md is missing, naming the file, and recorded once it is written; the brief asks for it", async () => {
    const m = configured({ env: runEnv() });
    await seedUnit(m, { step: "describe" });
    expect((await runCli(["brief"], m.io)).stdout).toContain("- Before `norn done done`, write `pr_body` to `.agents/specs/lt-1/pr.md`: a report without it, or with it empty, is refused.");
    const missing = await runCli(["done", "done", "--json"], m.io);
    expect(missing.exit).toBe(ExitCode.refused);
    expect(json(missing.stdout)).toEqual({
      error: "step describe produces `pr_body` with outcome done, and .agents/specs/lt-1/pr.md is missing",
      do_instead: "write .agents/specs/lt-1/pr.md (`pr_body`, which later steps read) in the worktree, then report again",
      code: "produced_missing",
    });
    expect(await receiptsOf(m)).toEqual([]);
    await m.files.write(`${worktreeOf(await envOf(m), UNIT)}/.agents/specs/lt-1/pr.md`, "# Fix the help\n\nWhat changed.\n");
    expect((await runCli(["done", "done", "--json"], m.io)).exit).toBe(0);
  });
});
