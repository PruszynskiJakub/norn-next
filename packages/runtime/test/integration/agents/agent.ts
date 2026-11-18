/**
 * The agent of these tests: a bun script started by the headless runner in the unit's worktree. It
 * acts as a coding agent would through its hooks, running the hook command install was given for
 * every hook, and reports with the `norn` stand-in. What it saw is printed as one JSON line per note
 * to stdout, which the runner sends to the run's log, for the test to read.
 *
 * - work: start, the brief as its prompt, a write inside the worktree and one into norn's data dir,
 *   a commit, a stop before reporting (blocked), `norn done`, then a stop and an end, which the
 *   runtime usually cuts short: the tick applying the report stops the run.
 * - die: start, the brief, then exit without a word, as a crashed agent does.
 * - ask: start, the brief, `norn ask`, then end its turn and exit, as `claude -p` does once its stop
 *   hook allows; the person's answer comes as the prompt of a resumed launch (SCRIPTED_RESUME), which
 *   works on as `work` does from the commit.
 */
import { createNodeHost } from "@norn/host-node";
import { parseJson } from "@norn/plugin-api";
import { Type } from "@sinclair/typebox";
import type { AgentPlan } from "./scripted-harness.ts";

const cwd = process.cwd();
const host = createNodeHost({ root: cwd, dataDir: cwd });
const hookCommand = process.env.SCRIPTED_HOOK as string;
const norn = JSON.parse(process.env.SCRIPTED_NORN as string) as string[];
const plan = JSON.parse(process.env.SCRIPTED_PLAN as string) as AgentPlan;
const prompt = process.argv[2] ?? "";
const resumed = process.env.SCRIPTED_RESUME;

const note = (what: string, value: unknown) => process.stdout.write(`${JSON.stringify({ note: what, value })}\n`);

const Answer = Type.Object({ kind: Type.String(), reason: Type.Optional(Type.String()), text: Type.Optional(Type.String()) });

/** Run one hook as a coding agent does: the command line from install, the hook's name last, the payload on stdin. */
async function hook(name: string, payload: Record<string, unknown> = {}): Promise<{ kind: string; reason?: string; text?: string }> {
  const out = await host.exec(["sh", "-c", `${hookCommand} ${name}`], { cwd, input: JSON.stringify(payload), timeoutMs: 30_000 });
  if (out.stderr.trim()) note(`${name}.stderr`, out.stderr.trim());
  if (out.code !== 0) note(`${name}.exit`, out.code);
  if (!out.stdout.trim()) return { kind: "allow" };
  const parsed = parseJson(Answer, out.stdout, `${name} answer`);
  return parsed.ok ? parsed.value : { kind: "unreadable", reason: out.stdout };
}

async function nornRun(...args: string[]): Promise<{ code: number; out: string }> {
  const out = await host.exec([...norn, ...args], { cwd, timeoutMs: 30_000 });
  return { code: out.code, out: out.stdout.trim() };
}

async function git(...args: string[]): Promise<void> {
  const out = await host.exec(["git", ...args], { cwd });
  if (out.code !== 0) throw new Error(`git ${args.join(" ")}: ${out.stderr}`);
}

async function commitAndReport(): Promise<void> {
  const files = plan.commit ?? {};
  for (const [name, text] of Object.entries(files)) await host.files.write(`${cwd}/${name}`, text);
  if (Object.keys(files).length > 0) {
    await git("add", "--", ...Object.keys(files));
    await git("commit", "-q", "-m", `agent: ${Object.keys(files).join(", ")}`);
  }
  await hook("tool-done", { id: "t-inside" });
  if (plan.pauseMs) await Bun.sleep(plan.pauseMs);
  note("stop.before-report", await hook("stop"));
  const runId = process.env.NORN_RUN_ID as string;
  note("done", await nornRun("done", plan.outcome ?? "done", `${runId}-done`));
  // the tick that applies the report stops this process, so what follows may never run
  note("stop.after-report", await hook("stop"));
  await hook("end");
}

note(resumed ? "resume.start" : "start", await hook("start"));
note(resumed ? "resume.prompt" : "prompt", await hook("prompt", { prompt }));

if (resumed) note("answered", { session: resumed, prompt });
else {
  note("brief", (await nornRun("brief")).out);
  if (plan.behavior === "die") process.exit(7);
  if (plan.behavior === "ask") {
    const runId = process.env.NORN_RUN_ID as string;
    note("ask", await nornRun("ask", plan.question ?? "Which one?", `${runId}-ask`));
    // the stop hook allows a run that has asked, and a non-interactive agent exits on that
    note("stop.after-ask", await hook("stop"));
    await hook("end");
    process.exit(0);
  }
}

note("write.inside", await hook("tool", { id: "t-inside", kind: "write", tool: "Write", detail: `${cwd}/feature.txt` }));
note("write.run-state", await hook("tool", { id: "t-state", kind: "write", tool: "Write", detail: `${cwd}/../../runtime/step-runs/x.json` }));
await commitAndReport();
process.exit(0);
