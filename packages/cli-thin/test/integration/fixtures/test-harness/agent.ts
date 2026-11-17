/**
 * The test harness's agent: started by the headless runner in the unit's worktree, it acts as a
 * coding agent does through its hooks and reports through the real `norn` binary, as subprocesses.
 * Each thing it saw is appended as one JSON line to `$TEST_AGENT_NOTES/<run id>.jsonl` for the test.
 *
 * Plans (TEST_AGENT_PLAN):
 * - work: start, prompt, `norn brief`, a write in the worktree and one into norn's machine dir, a
 *   commit, a stop before reporting (blocked), `norn done` with an outcome the step lacks (refused),
 *   `norn done done`, then a stop and an end. The tick applying the report may stop this process at
 *   once, so the stop after the report runs in a process of its own group (TEST_AGENT_ONLY), which
 *   that stop never reaches: its note is always written.
 * - ask: start, prompt, `norn brief`, `norn ask`, then a stop and an exit, as `claude -p` does once
 *   its stop hook allows; the resumed launch (TEST_AGENT_RESUME) takes the answer as its prompt and
 *   works on as `work` does from the write.
 */
import { spawn } from "node:child_process";
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { HOOK_FILE } from "./plugin.ts";

const cwd = process.cwd();
const hookCommand = (await Bun.file(join(cwd, HOOK_FILE)).text()).trim();
// the hook command is `<norn> hook test`: the same binary answers the agent's reports
const norn = hookCommand.replace(/ hook test$/, "");
const plan = process.env.TEST_AGENT_PLAN ?? "work";
const notesDir = process.env.TEST_AGENT_NOTES as string;
const runId = process.env.NORN_RUN_ID as string;
const resumed = process.env.TEST_AGENT_RESUME;
const prompt = process.argv[2] ?? "";

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

/** A `norn` verb with `--json`: its exit code and its one JSON value. */
async function nornJson(...args: string[]): Promise<{ code: number; body: unknown }> {
  const out = await sh(`${norn} ${args.map(quote).join(" ")} --json`);
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

async function work(): Promise<void> {
  note("write.inside", await hook("tool", { id: "t-inside", kind: "write", tool: "Write", detail: join(cwd, "feature.txt") }));
  note("write.machine", await hook("tool", { id: "t-machine", kind: "write", tool: "Write", detail: join(cwd, "..", "..", "runtime", "x.json") }));
  await Bun.write(join(cwd, "feature.txt"), "the feature\n");
  await git("add", "--", "feature.txt");
  await git("-c", "user.email=agent@test", "-c", "user.name=agent", "commit", "-q", "-m", "agent: feature.txt");
  await hook("tool-done", { id: "t-inside" });
  note("stop.before-report", await hook("stop"));
  note("done.bad", await nornJson("done", "shipped"));
  note("done", await nornJson("done", "done"));
  await detached("stop.after-report");
  // the tick that applies the report stops this process, so what follows may never run
  await hook("end");
}

if (process.env.TEST_AGENT_ONLY === "stop.after-report") {
  note("stop.after-report", await hook("stop"));
  process.exit(0);
}

note(resumed ? "resume.start" : "start", await hook("start"));
note(resumed ? "resume.prompt" : "prompt", await hook("prompt", { prompt }));

if (resumed) {
  note("answered", { session: resumed, prompt });
  await work();
} else {
  const brief = await sh(`${norn} brief`);
  note("brief", { code: brief.code, text: brief.stdout });
  if (plan === "ask") {
    note("ask", await nornJson("ask", "Which colour should the button be?"));
    // the stop hook allows a run that has asked, and a non-interactive agent exits on that
    note("stop.after-ask", await hook("stop"));
    await hook("end");
  } else await work();
}
process.exit(0);
