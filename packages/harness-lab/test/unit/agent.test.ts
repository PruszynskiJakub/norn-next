import { describe, expect, test } from "bun:test";
import { type ExecCall, memoryFiles, memoryHost, scriptedExec } from "@norn/conformance";
import { LAB_AUTHOR, LAB_HARNESS, type LabBeat, type LabVisit, labHarness, runLabAgent } from "../../src/index.ts";

const CWD = "/repo/.worktrees/lt-1";
const NORN = ["/usr/local/bin/norn"];
const RUN = "01JAAAAAAAAAAAAAAAAAAAAAAA";
const PROMPT = "Run `norn brief`.\n\n<!-- norn-prompt source=brief id=01JAAAAAAAAAAAAAAAAAAAAAAA -->";
const ANSWER = "Say hello, world.\n\n<!-- norn-prompt source=answer id=answer-q1 -->";
const VISIT: LabVisit = { workflow: "quick", step: "implement", attempt: 1 };

const BEATS: LabBeat[] = [
  {
    ...VISIT,
    work: { report: { verb: "ask", question: "hello or hello, world?" } },
    resumed: { files: { "greet.sh": "echo 'hello, world'\n" }, commit: "greet the world", report: { verb: "done", outcome: "done" } },
  },
  { workflow: "quick", step: "implement", attempt: 2, work: { files: { "greet.sh": "echo hi\n", "notes/why.md": "short\n" }, commit: "greet", report: { verb: "done", outcome: "done" } } },
  { workflow: "quick", step: "review", work: { report: { verb: "stuck", reason: "cannot read the diff" } } },
  { workflow: "quick", step: "describe", attempt: 1, work: { report: { verb: "exit", code: 1 } } },
];

/** A norn and a git that answer as the real ones do, the brief naming `visit`. */
function world(visit: LabVisit | null, brief: { code?: number; stdout?: string; unit?: string; retry?: true } = {}, hook: (name: string, input: string) => string = () => "") {
  const exec = scriptedExec((argv, opts) => {
    if (argv[0] === "git") return {};
    const args = argv.slice(NORN.length);
    if (args[0] === "hook") return { stdout: hook(args[2] as string, opts.input ?? "") };
    if (args[0] === "brief") return brief.code !== undefined ? brief : { stdout: JSON.stringify({ unit: brief.unit ?? "lt-1", run_id: RUN, markdown: "# norn brief", ...visit, ...(brief.retry && { retry: true }) }) };
    if (["done", "ask", "stuck"].includes(args[0] as string)) return { stdout: "{}" };
    return undefined;
  });
  const files = memoryFiles();
  return { exec, files, host: memoryHost({ exec, files }) };
}

/** Each call as a line: a hook as `hook <name> <payload>`, a norn verb or git as its words. */
function trail(calls: ExecCall[]): string[] {
  return calls.map(({ argv, opts }) => {
    expect(opts.cwd).toBe(CWD);
    if (argv[0] === "git") return argv.join(" ");
    const args = argv.slice(NORN.length);
    expect(argv.slice(0, NORN.length)).toEqual(NORN);
    return args[0] === "hook" ? `hook ${args[1]} ${args[2]} ${opts.input}` : `norn ${args.join(" ")}`;
  });
}

const run = (extra: { resume?: string; prompt?: string } = {}) => ({ cwd: CWD, norn: NORN, run_id: RUN, prompt: extra.prompt ?? PROMPT, ...(extra.resume !== undefined && { resume: extra.resume }) });

describe("the lab agent plays its beat over the host it is given", () => {
  test("it reports its session, reads its brief, writes the beat's files, commits and reports done", async () => {
    const w = world({ ...VISIT, attempt: 2 });
    const result = await runLabAgent(w.host, BEATS, run());
    expect(result).toEqual({ session: `lab-${RUN}`, visit: { ...VISIT, attempt: 2 }, report: { verb: "done", outcome: "done" }, exit: 0 });
    expect(trail(w.exec.calls)).toEqual([
      `hook ${LAB_HARNESS} start {"session_id":"lab-${RUN}"}`,
      `hook ${LAB_HARNESS} prompt ${JSON.stringify({ prompt: PROMPT })}`,
      `hook ${LAB_HARNESS} tool {"id":"t1","kind":"shell","tool":"Bash","detail":"norn brief"}`,
      "norn brief --json",
      `hook ${LAB_HARNESS} tool-done {"id":"t1","ok":true}`,
      `hook ${LAB_HARNESS} tool {"id":"t2","kind":"write","tool":"Write","detail":"greet.sh"}`,
      `hook ${LAB_HARNESS} tool-done {"id":"t2","ok":true}`,
      `hook ${LAB_HARNESS} tool {"id":"t3","kind":"write","tool":"Write","detail":"notes/why.md"}`,
      `hook ${LAB_HARNESS} tool-done {"id":"t3","ok":true}`,
      `hook ${LAB_HARNESS} tool {"id":"t4","kind":"shell","tool":"Bash","detail":"git commit -m \\"greet\\""}`,
      "git add -A",
      `git -c user.name=${LAB_AUTHOR.name} -c user.email=${LAB_AUTHOR.email} commit -q -m greet`,
      `hook ${LAB_HARNESS} tool-done {"id":"t4","ok":true}`,
      `hook ${LAB_HARNESS} tool {"id":"t5","kind":"shell","tool":"Bash","detail":"norn done done"}`,
      "norn done done --json",
      `hook ${LAB_HARNESS} tool-done {"id":"t5","ok":true}`,
      `hook ${LAB_HARNESS} stop {"last_message":"Reported done."}`,
      `hook ${LAB_HARNESS} end {}`,
    ]);
    expect(await w.files.read(`${CWD}/greet.sh`)).toBe("echo hi\n");
    expect(await w.files.read(`${CWD}/notes/why.md`)).toBe("short\n");
  });

  test("it asks with norn ask; resumed, it continues the same session without reporting a new one, and plays the beat's resumed work", async () => {
    const asked = world(VISIT);
    expect(await runLabAgent(asked.host, BEATS, run())).toEqual({ session: `lab-${RUN}`, visit: VISIT, report: { verb: "ask", question: "hello or hello, world?" }, exit: 0 });
    expect(trail(asked.exec.calls).filter((l) => l.startsWith("norn "))).toEqual(["norn brief --json", "norn ask hello or hello, world? --json"]);
    expect(asked.exec.calls.find((c) => c.argv.includes("ask"))?.argv.slice(-2)).toEqual(["hello or hello, world?", "--json"]);

    const resumed = world(VISIT);
    const result = await runLabAgent(resumed.host, BEATS, run({ resume: `lab-${RUN}`, prompt: ANSWER }));
    expect(result).toEqual({ session: `lab-${RUN}`, visit: VISIT, report: { verb: "done", outcome: "done" }, exit: 0 });
    const lines = trail(resumed.exec.calls);
    expect(lines.filter((l) => l.includes(" start "))).toEqual([]);
    expect(lines[0]).toBe(`hook ${LAB_HARNESS} prompt ${JSON.stringify({ prompt: ANSWER })}`);
    expect(lines.filter((l) => !l.startsWith("hook "))).toEqual([
      "norn brief --json",
      "git add -A",
      `git -c user.name=${LAB_AUTHOR.name} -c user.email=${LAB_AUTHOR.email} commit -q -m greet the world`,
      "norn done done --json",
    ]);
    expect(await resumed.files.read(`${CWD}/greet.sh`)).toBe("echo 'hello, world'\n");
  });

  test("a step's beat without an attempt plays at every visit, and reports stuck with norn stuck", async () => {
    const w = world({ workflow: "quick", step: "review", attempt: 3 });
    expect(await runLabAgent(w.host, BEATS, run())).toMatchObject({ report: { verb: "stuck", reason: "cannot read the diff" }, exit: 0 });
    expect(w.exec.calls.at(-4)?.argv.slice(NORN.length)).toEqual(["stuck", "cannot read the diff", "--json"]);
  });

  test("a beat that exits dies without a report, a stop or an end, as a crashed session does", async () => {
    const w = world({ workflow: "quick", step: "describe", attempt: 1 });
    expect(await runLabAgent(w.host, BEATS, run())).toEqual({ session: `lab-${RUN}`, visit: { workflow: "quick", step: "describe", attempt: 1 }, report: { verb: "exit", code: 1 }, exit: 1 });
    expect(trail(w.exec.calls).filter((l) => / (stop|end) /.test(l) || /^norn (done|ask|stuck)/.test(l))).toEqual([]);
  });

  test("a fresh session that norn's brief calls a retry of a dead one plays the beat's resumed work, reporting its own session", async () => {
    const visit = { workflow: "quick", step: "describe", attempt: 1 };
    const beats: LabBeat[] = [{ ...visit, work: { report: { verb: "exit", code: 1 } }, resumed: { files: { "pr.md": "## Summary\n" }, report: { verb: "done", outcome: "done" } } }];
    const w = world(visit, { retry: true });
    expect(await runLabAgent(w.host, beats, run())).toEqual({ session: `lab-${RUN}`, visit, report: { verb: "done", outcome: "done" }, exit: 0 });
    expect(trail(w.exec.calls)[0]).toBe(`hook ${LAB_HARNESS} start {"session_id":"lab-${RUN}"}`);
    expect(await w.files.read(`${CWD}/pr.md`)).toBe("## Summary\n");
  });

  test("a visit the beat script has no beat for reports stuck, naming it", async () => {
    const w = world({ workflow: "quick", step: "land", attempt: 1 });
    expect(await runLabAgent(w.host, BEATS, run())).toMatchObject({ report: { verb: "stuck", reason: "the lab's beat script has no beat for quick step land #1" } });
  });

  test("a beat that writes outside the worktree is refused with a stuck, and nothing is written", async () => {
    const w = world(VISIT);
    const beats: LabBeat[] = [{ ...VISIT, work: { files: { "../escape.txt": "x" }, report: { verb: "done", outcome: "done" } } }];
    expect(await runLabAgent(w.host, beats, run())).toMatchObject({ report: { verb: "stuck", reason: "the beat for implement #1 writes ../escape.txt, outside the worktree" } });
    expect(w.files.snapshot()).toEqual({});
  });

  test("a brief it cannot read ends the session with a stop and an end, reporting nothing", async () => {
    const w = world(null, { code: 3, stdout: '{"error":"no run","do_instead":"end your turn"}' });
    const result = await runLabAgent(w.host, BEATS, run());
    expect(result).toMatchObject({ exit: 1, problem: expect.stringContaining("norn brief exited 3") });
    expect(trail(w.exec.calls).slice(-2).map((l) => l.split(" ")[2])).toEqual(["stop", "end"]);
    expect(trail(w.exec.calls).filter((l) => /^norn (done|ask|stuck)/.test(l))).toEqual([]);
  });

  test("a tool call norn denies is not made: nothing is written, and the agent reports stuck with norn's reason", async () => {
    const reason = "norn: step `review` is docs-only (`writes: docs`): never `greet.sh`.";
    const w = world(VISIT, {}, (name, input) => (name === "tool" && input.includes('"kind":"write"') ? `${JSON.stringify({ kind: "deny", reason })}\n` : ""));
    const beats: LabBeat[] = [{ ...VISIT, work: { files: { "greet.sh": "echo hi\n" }, commit: "greet", report: { verb: "done", outcome: "done" } } }];
    expect(await runLabAgent(w.host, beats, run())).toMatchObject({ report: { verb: "stuck", reason: `the beat for implement #1 was denied writing greet.sh: ${reason}` }, exit: 0 });
    expect(w.files.snapshot()).toEqual({});
    expect(trail(w.exec.calls).filter((l) => l.startsWith("git ") || /^norn (done|ask)/.test(l))).toEqual([]);
  });

  test("{story} and {unit} in a beat's file path are the run's story and unit, so a beat writes into the story's spec folder", async () => {
    const w = world(VISIT, { unit: "gh-5/02" });
    const beats: LabBeat[] = [{ ...VISIT, work: { files: { ".agents/specs/{story}/handoffs/{unit}.md": "# handoff\n" }, report: { verb: "done", outcome: "done" } } }];
    expect(await runLabAgent(w.host, beats, run())).toMatchObject({ report: { verb: "done" }, exit: 0 });
    expect(w.files.snapshot()).toEqual({ [`${CWD}/.agents/specs/gh-5/handoffs/gh-5-02.md`]: "# handoff\n" });
    expect(trail(w.exec.calls)).toContain(`hook ${LAB_HARNESS} tool {"id":"t2","kind":"write","tool":"Write","detail":".agents/specs/gh-5/handoffs/gh-5-02.md"}`);
  });
});

describe("the lab harness", () => {
  test("can deny a tool, as the lab agent makes no call norn denies, so docs-only steps run on it", () => {
    expect(labHarness.capabilities.denyTool).toBe(true);
  });
});
