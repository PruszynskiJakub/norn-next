/**
 * The test harness's agent: started by the headless runner in the unit's worktree, it acts as a
 * coding agent does through its hooks and reports through the `norn` on its PATH, as subprocesses.
 * Each thing it saw is appended as one JSON line to `$TEST_AGENT_NOTES/<run id>.jsonl` for the test.
 *
 * Every launch notes `norn brief` (markdown, and `--json` as `brief.json`), then follows its plan.
 * The plan is TEST_AGENT_PLAN, unless the JSON file TEST_AGENT_PLANS maps the step (`"<step>"`) or
 * one visit of it (`"<step>#<attempt>"`) to another, so one story can mix plans per step.
 *
 * Plans:
 * - work: a write in the worktree and one into norn's machine dir, a commit, a stop before
 *   reporting (blocked), `norn done` with an outcome the step lacks (refused), `norn done done`,
 *   then a stop and an end. The tick applying the report may stop this process at once, so the stop
 *   after the report runs in a process of its own group (TEST_AGENT_ONLY), which that stop never
 *   reaches: its note is always written.
 * - ask: `norn ask`, then a stop and an exit, as `claude -p` does once its stop hook allows; the
 *   resumed launch (TEST_AGENT_RESUME) takes the answer as its prompt and works on as `work` does.
 * - ask-then-stuck: as ask, but the resumed launch reports `norn stuck`.
 * - hang: notes its pid, leaves an untracked file, then stays alive firing no hook and never
 *   reports; a resumed launch hangs the same way.
 * - protocol: the refusals an agent can meet (an outcome the step lacks, verbs without the run's env
 *   or under a made-up run, a handoff over 8 KB), then a handoff of its own, `norn done done` and a
 *   second report. It holds the ticks meanwhile with `$TEST_AGENT_NOTES/hold`, which a test's ticks
 *   wait out, so no tick ends the run between the two reports.
 * - findings: `norn done changes_requested --findings <file>`.
 * - attended: a stop before reporting, then `norn done done`.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { HOOK_FILE } from "./plugin.ts";

const cwd = process.cwd();
const hookCommand = (await Bun.file(join(cwd, HOOK_FILE)).text()).trim();
// a bare `norn`, as the brief tells an agent to run it: the launcher's PATH must make it this build
const norn = "norn";
const notesDir = process.env.TEST_AGENT_NOTES as string;
const runId = process.env.NORN_RUN_ID as string;
const resumed = process.env.TEST_AGENT_RESUME;
const prompt = process.argv[2] ?? "";
/** A run id no launch made: the shape of one, so only the run check refuses it. */
const MADE_UP_RUN = "01ARZ3NDEKTSV4RRFFQ69G5FAV";

const note = (what: string, value: unknown) => appendFileSync(join(notesDir, `${runId}.jsonl`), `${JSON.stringify({ note: what, value })}\n`);

async function sh(command: string, input = ""): Promise<{ code: number; stdout: string; stderr: string }> {
  const p = Bun.spawn(["sh", "-c", command], { cwd, stdin: new Blob([input]), stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  return { code, stdout, stderr };
}

const quote = (s: string) => `'${s.replaceAll("'", `'\\''`)}'`;

/** One hook as a coding agent runs it: the installed command, the hook's name last, the payload on stdin. */
async function hook(name: string, payload: Record<string, unknown> = {}): Promise<unknown> {
  const out = await sh(`${hookCommand} ${name}`, JSON.stringify(payload));
  if (out.stderr.trim()) note(`${name}.stderr`, out.stderr.trim());
  if (out.code !== 0) note(`${name}.exit`, out.code);
  if (!out.stdout.trim()) return { kind: "allow" };
  try {
    return JSON.parse(out.stdout);
  } catch {
    return { kind: "unreadable", text: out.stdout };
  }
}

/** A `norn` verb with `--json`, behind an optional env prefix: its exit code and its one JSON value. */
async function nornJson(args: string[], prefix = ""): Promise<{ code: number; body: unknown }> {
  const out = await sh(`${prefix}${norn} ${args.map(quote).join(" ")} --json`);
  let body: unknown = out.stdout;
  try {
    body = JSON.parse(out.stdout);
  } catch {
    // kept as text: the test shows what came out instead of a JSON value
  }
  return { code: out.code, body };
}

async function git(...args: string[]): Promise<void> {
  const out = await sh(`git ${args.map(quote).join(" ")}`);
  if (out.code !== 0) throw new Error(`git ${args.join(" ")}: ${out.stderr}`);
}

/** `TEST_AGENT_ONLY=<note>` in a detached process: outlives a stop sent to the agent's group. */
function detached(what: string): Promise<void> {
  const child = spawn(process.execPath, [import.meta.path], { cwd, env: { ...process.env, TEST_AGENT_ONLY: what }, detached: true, stdio: "ignore" });
  return new Promise((resolve) => {
    child.on("exit", () => resolve());
    child.on("error", (e) => {
      note(`${what}.error`, String(e));
      resolve();
    });
  });
}

/** The plan for this visit: the plans file's entry for the visit, then for the step, then TEST_AGENT_PLAN. */
function planFor(step: string | undefined, attempt: number | undefined): string {
  const fallback = process.env.TEST_AGENT_PLAN ?? "work";
  const file = process.env.TEST_AGENT_PLANS;
  if (!file || !existsSync(file) || step === undefined) return fallback;
  const plans = JSON.parse(readFileSync(file, "utf8")) as Record<string, string>;
  return plans[`${step}#${attempt}`] ?? plans[step] ?? fallback;
}

async function work(): Promise<void> {
  note("write.inside", await hook("tool", { id: "t-inside", kind: "write", tool: "Write", detail: join(cwd, "feature.txt") }));
  note("write.machine", await hook("tool", { id: "t-machine", kind: "write", tool: "Write", detail: join(cwd, "..", "..", "runtime", "x.json") }));
  await Bun.write(join(cwd, "feature.txt"), `the feature, by run ${runId}\n`);
  // everything the step left, as an agent commits its work: a rerun finds what an earlier visit left
  await git("add", "-A");
  await git("-c", "user.email=agent@test", "-c", "user.name=agent", "commit", "-q", "-m", "agent: feature.txt");
  await hook("tool-done", { id: "t-inside" });
  note("stop.before-report", await hook("stop"));
  note("done.bad", await nornJson(["done", "shipped"]));
  note("done", await nornJson(["done", "done"]));
  await detached("stop.after-report");
  // the tick that applies the report stops this process, so what follows may never run
  await hook("end");
}

/** Alive, firing no hook and never reporting, until something stops it. */
async function hang(): Promise<never> {
  note("pid", process.pid);
  if (!resumed) await Bun.write(join(cwd, "wip.txt"), "work in progress\n");
  setInterval(() => undefined, 1 << 30);
  return new Promise<never>(() => undefined);
}

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

/** Where the unit's handoff lives, when the brief names one. */
function handoffNamed(briefText: string): string | undefined {
  const named = briefText.match(/`(\.agents\/specs\/[^`]*handoffs\/[^`]*\.md)`/);
  return named ? join(cwd, named[1] as string) : undefined;
}

async function protocol(briefText: string): Promise<void> {
  // ticks wait while this file exists: a tick applying the done would end the run before the second report
  const hold = join(notesDir, "hold");
  await Bun.write(hold, runId);
  note("done.nope.md", await sh(`${norn} done nope`));
  note("done.nope.json", await nornJson(["done", "nope"]));
  const bare = "env -u NORN_RUN_ID -u NORN_UNIT ";
  note("no_run_env", {
    brief: await nornJson(["brief"], bare),
    done: await nornJson(["done", "done"], bare),
    ask: await nornJson(["ask", "Why?"], bare),
    stuck: await nornJson(["stuck", "lost"], bare),
  });
  const madeUp = `NORN_RUN_ID=${MADE_UP_RUN} `;
  note("stale_run", { brief: await nornJson(["brief"], madeUp), done: await nornJson(["done", "done"], madeUp) });
  const handoff = handoffNamed(briefText);
  if (handoff === undefined) throw new Error("the protocol plan needs a step whose brief names a handoff");
  note("handoff.path", handoff);
  await Bun.write(handoff, `## State\n\n${"a diary of every attempt. ".repeat(400)}\n`);
  note("done.big-handoff", await nornJson(["done", "done"]));
  const kept = "## State\n\nThe protocol step left this for the next step: the handoff marker 7f3a.\n\n## Notes\n\n- nothing else\n";
  await Bun.write(handoff, kept);
  note("handoff.sha", sha256(readFileSync(handoff, "utf8")));
  note("git.status", (await sh("git status --porcelain")).stdout);
  note("done", await nornJson(["done", "done"]));
  note("second-report", await nornJson(["stuck", "a second report"]));
  rmSync(hold, { force: true });
  await hook("end");
}

if (process.env.TEST_AGENT_ONLY === "stop.after-report") {
  note("stop.after-report", await hook("stop"));
  process.exit(0);
}

note(resumed ? "resume.start" : "start", await hook("start"));
note(resumed ? "resume.prompt" : "prompt", await hook("prompt", { prompt }));
note("norn", (await sh("command -v norn")).stdout.trim());
const brief = await sh(`${norn} brief`);
note("brief", { code: brief.code, text: brief.stdout });
note("brief.json", await nornJson(["brief"]));
// the brief's title names the visit: `# norn brief — <unit> · <step> #<attempt>`
const visit = brief.stdout.match(/· (\S+) #(\d+)/);
const plan = planFor(visit?.[1], visit ? Number(visit[2]) : undefined);
note("plan", plan);
const named = handoffNamed(brief.stdout);
if (named !== undefined) note("handoff.read", existsSync(named) ? readFileSync(named, "utf8") : null);

if (resumed) {
  note("answered", { session: resumed, prompt });
  if (plan === "hang") await hang();
  else if (plan === "ask-then-stuck") {
    note("stuck", await nornJson(["stuck", "The answer leaves nothing to build."]));
    await hook("end");
  } else await work();
} else if (plan === "ask" || plan === "ask-then-stuck") {
  note("ask", await nornJson(["ask", "Which colour should the button be?"]));
  // the stop hook allows a run that has asked, and a non-interactive agent exits on that
  note("stop.after-ask", await hook("stop"));
  await hook("end");
} else if (plan === "hang") await hang();
else if (plan === "protocol") await protocol(brief.stdout);
else if (plan === "findings") {
  const file = join(notesDir, `findings-${runId}.json`);
  await Bun.write(file, JSON.stringify([{ severity: "blocking", title: "The button is the wrong colour", detail: "It should be blue." }]));
  note("done", await nornJson(["done", "changes_requested", "--findings", file]));
  await hook("end");
} else if (plan === "attended") {
  note("stop.before-report", await hook("stop"));
  note("done", await nornJson(["done", "done"]));
  await hook("end");
} else await work();
process.exit(0);
