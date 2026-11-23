/**
 * The stand-in agent: what a coding agent does in a step, scripted. It reports its session, reads its
 * brief, does the beat's work, commits, and reports with the same `norn done`, `norn ask` and `norn
 * stuck` a real agent runs. Every file write, git call and norn call goes through the host it is
 * given, so it runs over an in-memory host as it runs over the real one.
 */
import { type HostContext, parseJson } from "@norn/plugin-api";
import { Type } from "@sinclair/typebox";
import { beatFor, type LabBeat, type LabReport, type LabVisit, type LabWork } from "./beats.ts";

/** The harness's name, which its hooks run under: `norn hook lab <hook>`. */
export const LAB_HARNESS = "lab";

/** Who the lab agent's commits are by. */
export const LAB_AUTHOR = Object.freeze({ name: "norn lab agent", email: "lab-agent@norn.invalid" });

export interface LabAgentRun {
  /** the unit's worktree, where the agent works */
  cwd: string;
  /** the norn the agent reports through and runs its hooks on */
  norn: readonly string[];
  run_id: string;
  /** the prompt norn launched it with, prompt mark and all */
  prompt: string;
  /** the session a resumed launch continues */
  resume?: string;
}

export interface LabAgentResult {
  session: string;
  /** the visit its brief named; absent when it could read no brief */
  visit?: LabVisit;
  /** what it reported, or the exit it died with */
  report?: LabReport;
  /** the code the agent's process exits with */
  exit: number;
  /** why it stopped short of its beat */
  problem?: string;
}

/** The part of `norn brief --json` the agent reads. */
const BriefJson = Type.Object({
  unit: Type.String(),
  run_id: Type.String(),
  markdown: Type.String(),
  workflow: Type.Optional(Type.String({ minLength: 1 })),
  step: Type.Optional(Type.String({ minLength: 1 })),
  attempt: Type.Optional(Type.Integer({ minimum: 1 })),
  /** a fresh session norn started in place of one that ended without reporting */
  retry: Type.Optional(Type.Literal(true)),
});

/** A tool call norn refused before it ran. */
class Denied extends Error {
  constructor(
    readonly what: string,
    readonly reason: string,
  ) {
    super(`${what}: ${reason}`);
  }
}

/** A deny, as the hook answers one; an empty answer, or any other, lets the call run. */
const DenyAnswer = Type.Object({ kind: Type.Literal("deny"), reason: Type.String() });

/** The reason of a deny the hook answered with, else undefined. */
function deniedReason(stdout: string): string | undefined {
  if (stdout.trim() === "") return undefined;
  const answer = parseJson(DenyAnswer, stdout, "the hook's answer");
  return answer.ok ? answer.value.reason || "denied" : undefined;
}

/**
 * A beat's file path for the run's unit: `{story}` is its story (`gh-5`), `{unit}` the unit as its
 * handoff file names it (`gh-5-02`), so one beat script writes into any story's spec folder.
 */
function inUnit(template: string, unit: string): string {
  const story = unit.split("/")[0] as string;
  return template.replaceAll("{story}", story).replaceAll("{unit}", unit.replaceAll("/", "-"));
}

/** A path inside the worktree: never absolute, never climbing out of it. */
const insideWorktree = (path: string): boolean => !path.startsWith("/") && !path.split("/").includes("..");

function reportArgv(r: Exclude<LabReport, { verb: "exit" }>): string[] {
  if (r.verb === "done") return ["done", r.outcome];
  if (r.verb === "ask") return ["ask", r.question];
  return ["stuck", r.reason];
}

export async function runLabAgent(host: HostContext, beats: readonly LabBeat[], run: LabAgentRun): Promise<LabAgentResult> {
  const session = run.resume ?? `lab-${run.run_id}`;
  const exec = (argv: string[], input?: string) => host.exec(argv, { cwd: run.cwd, ...(input !== undefined && { input }) });
  const hook = (name: string, payload: Record<string, unknown> = {}) => exec([...run.norn, "hook", LAB_HARNESS, name], JSON.stringify(payload));
  let calls = 0;
  /** One call as a coding agent makes it: requested, run, finished; a call norn denies is never made. */
  const tool = async <T extends { code: number }>(kind: "shell" | "write", detail: string, body: () => Promise<T>): Promise<T> => {
    const id = `t${++calls}`;
    const asked = await hook("tool", { id, kind, tool: kind === "shell" ? "Bash" : "Write", detail });
    const denied = deniedReason(asked.stdout);
    if (denied !== undefined) throw new Denied(kind === "write" ? `writing ${detail}` : `running \`${detail}\``, denied);
    const out = await body();
    await hook("tool-done", { id, ok: out.code === 0 });
    return out;
  };
  const norn = (args: string[]) => tool("shell", `norn ${args.join(" ")}`, () => exec([...run.norn, ...args, "--json"]));
  const finish = async (result: LabAgentResult, last: string): Promise<LabAgentResult> => {
    await hook("stop", { last_message: last });
    await hook("end");
    return result;
  };
  const report = async (r: Exclude<LabReport, { verb: "exit" }>, visit: LabVisit | undefined): Promise<LabAgentResult> => {
    const result = { session, ...(visit !== undefined && { visit }), report: r, exit: 0 };
    let out: Awaited<ReturnType<typeof norn>>;
    try {
      out = await norn(reportArgv(r));
    } catch (e) {
      if (!(e instanceof Denied)) throw e;
      return finish({ ...result, exit: 1, problem: `norn denied ${e.what}: ${e.reason}` }, "Could not report.");
    }
    return finish(out.code === 0 ? result : { ...result, problem: `norn ${r.verb} exited ${out.code}: ${out.stdout.trim() || out.stderr.trim()}` }, `Reported ${r.verb}.`);
  };

  // norn records a resumed session itself; reporting it again would start a second one
  if (run.resume === undefined) await hook("start", { session_id: session });
  await hook("prompt", { prompt: run.prompt });

  let briefOut: Awaited<ReturnType<typeof norn>>;
  try {
    briefOut = await norn(["brief"]);
  } catch (e) {
    if (!(e instanceof Denied)) throw e;
    return finish({ session, exit: 1, problem: `norn denied ${e.what}: ${e.reason}` }, "Could not read my brief.");
  }
  const brief = briefOut.code === 0 ? parseJson(BriefJson, briefOut.stdout, "norn brief --json") : null;
  if (brief === null || !brief.ok) {
    const why = brief === null ? `norn brief exited ${briefOut.code}: ${briefOut.stdout.trim() || briefOut.stderr.trim()}` : brief.failure.message;
    return finish({ session, exit: 1, problem: why }, "Could not read my brief.");
  }
  const { workflow, step, attempt } = brief.value;
  if (workflow === undefined || step === undefined || attempt === undefined) return report({ verb: "stuck", reason: "the lab agent's brief names no workflow step to play" }, undefined);
  const visit = { workflow, step, attempt };
  const beat = beatFor(beats, visit);
  if (beat === undefined) return report({ verb: "stuck", reason: `the lab's beat script has no beat for ${workflow} step ${step} #${attempt}` }, visit);
  // a retry is told what came before as a resumed session is, so both go on where the first left off
  const goesOn = run.resume !== undefined || brief.value.retry === true;
  const work: LabWork = goesOn && beat.resumed !== undefined ? beat.resumed : beat.work;
  try {
    const problem = await play(work, brief.value.unit);
    if (problem !== undefined) return report({ verb: "stuck", reason: `the beat for ${step} #${attempt} ${problem}` }, visit);
  } catch (e) {
    if (!(e instanceof Denied)) throw e;
    return report({ verb: "stuck", reason: `the beat for ${step} #${attempt} was denied ${e.what}: ${e.reason}` }, visit);
  }
  const r = work.report;
  // a crash leaves no stop and no end behind: the host sees only the process gone
  if (r.verb === "exit") return { session, visit, report: r, exit: r.code };
  return report(r, visit);

  /** The beat's files and commit; what kept it from them, if anything. */
  async function play(work: LabWork, unit: string): Promise<string | undefined> {
    for (const [template, text] of Object.entries(work.files ?? {})) {
      const path = inUnit(template, unit);
      if (!insideWorktree(path)) return `writes ${path}, outside the worktree`;
      await tool("write", path, async () => {
        await host.files.write(`${run.cwd}/${path}`, text);
        return { code: 0 };
      });
    }
    if (work.commit !== undefined) {
      const message = work.commit;
      const committed = await tool("shell", `git commit -m ${JSON.stringify(message)}`, async () => {
        const added = await exec(["git", "add", "-A"]);
        if (added.code !== 0) return added;
        return exec(["git", "-c", `user.name=${LAB_AUTHOR.name}`, "-c", `user.email=${LAB_AUTHOR.email}`, "commit", "-q", "-m", message]);
      });
      if (committed.code !== 0) return `could not commit: ${committed.stderr.trim() || committed.stdout.trim()}`;
    }
    return undefined;
  }
}
