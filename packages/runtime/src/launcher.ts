/**
 * AgentLauncher by composition: each executor is a harness (how the agent is wired and launched)
 * running in a runner (where its process lives).
 *
 * - start: the launch's mount rows (mount.ts): `harness.install` in the worktree with the hook
 *   command, then the pack's skills reachable from the harness's `skillsDir`, the brief rendered and marked
 *   (prompt id = the run id) and recorded as sent, `harness.launch` (headless when the runner has no
 *   pane), then `runner.start` keyed by the run id, so a replayed start finds the first process. The
 *   launch env carries RUN_ENV (unit and run) and never the per-launch NORN_PROMPT_SOURCE.
 * - nudge / answer: marked with an id derived from the decision (nudgePromptId, answerPromptId) and recorded as sent, then `runner.send` when the runner has pane input
 *   and the harness reads typed prompts; else queued in the run's outbox for the next hook answer
 *   (`injectContext`), or, when the run's process has ended (a headless agent exits as its turn
 *   ends), handed to a resumed launch of its session (launcher-resume.ts). With none of these,
 *   refused: a nudge is never dropped silently.
 * - every launch, resumed ones too, puts agent-bin.ts's folder first on the agent's PATH, so the
 *   `norn` the brief tells the agent to run is the build that launched it.
 * - stop / alive: the runner, on the run's newest process (its latest resume, else the first).
 * The handle is launcher-handle.ts's: executor, unit, run and the runner's own handle.
 */
import type { Harness, HostContext, NornPromptSource, PluginResult, Runner } from "@norn/plugin-api";
import { fail, markPrompt, ok, RUN_ENV } from "@norn/plugin-api";
import { agentBinEnv, cliOfHookCommand } from "./agent-bin.ts";
import { markDelivered, pendingInjections, queueInjection, recordSentPrompt } from "./events/outbox.ts";
import { receivedDir } from "./events/paths.ts";
import { decodeLaunchHandle, encodeLaunchHandle, type LaunchHandle } from "./launcher-handle.ts";
import { currentRunnerHandle, recordLaunch, resumesOf, resumeWith } from "./launcher-resume.ts";
import { shellQuote } from "./shell.ts";
import { mountLaunch } from "./mount.ts";
import type { PackSkills } from "./skills.ts";
import type { AgentLauncher, AgentRunRequest, ExecutorModes, LauncherModes } from "./types.ts";

export interface Executor {
  harness: Harness;
  runner: Runner;
  /** the model a launch asks for when the step names none */
  model?: string;
  /** the agent's extra arguments, in place of the harness's own defaults */
  args?: readonly string[];
}

export interface HarnessLauncherOptions {
  ctx: HostContext;
  executors: Readonly<Record<string, Executor>>;
  /**
   * The hook command's argv prefix; the launcher appends the harness's name and hands the harness
   * the shell-quoted line. The CLI passes `["norn", "hook"]`, so hooks run `norn hook claude`.
   */
  hookCommand: readonly string[];
  /**
   * The PATH this host's processes run with. A launched agent gets it with a folder in front that
   * holds a `norn` running this CLI (agent-bin.ts); absent, the agent's PATH is left alone.
   */
  hostPath?: string;
  /**
   * Env every launch adds, resumed ones too (`NORN_HOME_DIR` when the CLI runs on another home): a
   * pane's shell starts from its own env, and the agent's `norn` and hooks must find this home.
   */
  agentEnv?: Readonly<Record<string, string>>;
  /** the pack's skills, written into the harness's `skillsDir` in the worktree before every launch */
  skills?: PackSkills;
  /** the brief for a run, as brief-context.ts renders it */
  renderBrief(run: AgentRunRequest): Promise<PluginResult<string>>;
  /** where a run's output goes when no pane shows it; default `<dataDir>/runtime/sessions/<run>.log` */
  logPath?(run: AgentRunRequest): string;
}

export function sessionLogPath(ctx: HostContext, runId: string): string {
  return `${ctx.repo.dataDir}/runtime/sessions/${runId}.log`;
}

export { shellQuote };

const PROMPT_ID_CHAR = /[^A-Za-z0-9._:-]/g;

/**
 * The prompt id an answer goes under: derived from the input it answers, so a replayed answer is the
 * same prompt and the outbox and sent records keep it once.
 */
export function answerPromptId(inputId: string): string {
  return `answer-${inputId.replace(PROMPT_ID_CHAR, "_")}`.slice(0, 128);
}

/**
 * The prompt id a nudge goes under: derived from the decision's intent, so a nudge the act protocol
 * replays after a crash is the same prompt, which the sent records and the outbox keep once.
 */
export function nudgePromptId(intentId: string): string {
  return `nudge-${intentId.replace(PROMPT_ID_CHAR, "_")}`.slice(0, 128);
}

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export class HarnessLauncher implements AgentLauncher {
  constructor(readonly opts: HarnessLauncherOptions) {}

  /** The env every launch adds for the agent beside the run's own: the configured env and agent-bin.ts's PATH. */
  private async agentEnv(): Promise<PluginResult<Record<string, string>>> {
    const bin = await agentBinEnv(this.opts.ctx, cliOfHookCommand(this.opts.hookCommand), this.opts.hostPath);
    return bin.ok ? ok({ ...this.opts.agentEnv, ...bin.value }) : bin;
  }

  /** Any executor that can run headless or attended makes the launcher able to. */
  get modes(): LauncherModes {
    const runners = Object.values(this.opts.executors).map((e) => e.runner.capabilities);
    return { headless: runners.some((c) => c.headless), attended: runners.some((c) => c.attended) };
  }

  modesOf(executor: string): ExecutorModes | null {
    const e = this.opts.executors[executor];
    if (!e) return null;
    const r = e.runner.capabilities;
    return { headless: r.headless, attended: r.attended, paneInput: r.paneInput && e.harness.capabilities.paneInput };
  }

  async start(run: AgentRunRequest): Promise<PluginResult<{ handle: string }>> {
    const e = this.opts.executors[run.executor];
    if (!e) return fail("not_found", `no executor ${JSON.stringify(run.executor)} is configured`, false);
    const { ctx } = this.opts;
    const mounted = await mountLaunch(ctx.files, e.harness, run.worktree, shellQuote([...this.opts.hookCommand, e.harness.name]), this.opts.skills);
    if (!mounted.ok) return mounted;
    const brief = await this.opts.renderBrief(run);
    if (!brief.ok) return brief;
    // the brief's id is the run's own: a replayed start records and sends the same prompt
    const recorded = await recordSentPrompt(ctx, run.unit, run.run_id, { id: run.run_id, source: "brief", at: ctx.now() });
    if (!recorded.ok) return recorded;
    const headless = !e.runner.capabilities.attended;
    const model = run.brief.model ?? e.model;
    const agentEnv = await this.agentEnv();
    if (!agentEnv.ok) return agentEnv;
    const env = { ...agentEnv.value, [RUN_ENV.unit]: run.unit, [RUN_ENV.run]: run.run_id };
    let spec: ReturnType<Harness["launch"]>;
    try {
      spec = e.harness.launch({
        cwd: run.worktree,
        prompt: markPrompt(brief.value, { source: "brief", id: run.run_id }),
        run_id: run.run_id,
        env: { ...env },
        ...(model !== undefined ? { model } : {}),
        ...(e.args !== undefined ? { args: [...e.args] } : {}),
        ...(run.resume !== undefined ? { resume: run.resume } : {}),
        ...(headless ? { headless: true } : {}),
      });
    } catch (err) {
      return fail("invalid", `${e.harness.name}: launch could not be built: ${message(err)}`, false);
    }
    const where = {
      cwd: run.worktree,
      title: `${run.unit} ${run.step}`,
      workspace: run.unit.split("/")[0] as string,
      logPath: this.opts.logPath?.(run) ?? sessionLogPath(ctx, run.run_id),
    };
    const launched = await recordLaunch(ctx, run.unit, run.run_id, { executor: run.executor, ...where, ...(model !== undefined ? { model } : {}) });
    if (!launched.ok) return launched;
    const started = await e.runner.start({ key: run.run_id, argv: spec.argv, env: { ...spec.env, ...env }, ...where });
    if (!started.ok) return started;
    return ok({ handle: encodeLaunchHandle({ executor: run.executor, unit: run.unit, run_id: run.run_id, runner: started.value.handle }) });
  }

  async nudge(handle: string, text: string, promptId: string): Promise<PluginResult<void>> {
    return this.deliver(handle, "nudge", promptId, text);
  }

  async answer(handle: string, inputId: string, text: string): Promise<PluginResult<void>> {
    return this.deliver(handle, "answer", answerPromptId(inputId), text, inputId);
  }

  async stop(handle: string): Promise<PluginResult<void>> {
    const found = this.resolve(handle);
    if (!found.ok) return found;
    const { handle: h, executor } = found.value;
    // newest first: the live process goes before the ones that ended on their own
    const resumed = (await resumesOf(this.opts.ctx, h.unit, h.run_id)).map((r) => r.handle).reverse();
    for (const runner of [...resumed, h.runner]) {
      const stopped = await executor.runner.stop(runner);
      if (!stopped.ok) return stopped;
    }
    return ok(undefined);
  }

  /**
   * Whether the handle's process still runs, for the session source's died detection; null when the
   * runner cannot tell (or the handle is not this launcher's), which is never read as dead.
   */
  async alive(handle: string): Promise<boolean | null> {
    const found = this.resolve(handle);
    if (!found.ok) return null;
    try {
      const alive = await found.value.executor.runner.alive(await currentRunnerHandle(this.opts.ctx, found.value.handle));
      return alive.ok ? alive.value : null;
    } catch {
      return null;
    }
  }

  private resolve(handle: string): PluginResult<{ handle: LaunchHandle; executor: Executor }> {
    const h = decodeLaunchHandle(handle);
    if (!h) return fail("invalid", `${JSON.stringify(handle)} is not a handle this launcher made`, false);
    const executor = this.opts.executors[h.executor];
    if (!executor) return fail("not_found", `no executor ${JSON.stringify(h.executor)} is configured for ${h.unit} run ${h.run_id}`, false);
    return ok({ handle: h, executor });
  }

  private async deliver(handle: string, source: Exclude<NornPromptSource, "brief">, id: string, text: string, inputId?: string): Promise<PluginResult<void>> {
    const found = this.resolve(handle);
    if (!found.ok) return found;
    const { ctx } = this.opts;
    const { handle: h, executor } = found.value;
    const marked = markPrompt(text, { source, id });
    const at = ctx.now();
    const extra = inputId !== undefined ? { input_id: inputId } : {};
    const pane = this.modesOf(h.executor)?.paneInput === true;
    if (!pane && !executor.harness.capabilities.injectContext)
      return fail("invalid", `${h.unit} run ${h.run_id} cannot take a ${source}: ${executor.runner.name} has no pane input and ${executor.harness.name} cannot add context`, false);
    const recorded = await recordSentPrompt(ctx, h.unit, h.run_id, { id, source, at, ...extra });
    if (!recorded.ok) return recorded;
    if (pane) {
      // a replay types the prompt again unless the hook already saw it arrive: twice beats never
      if (!recorded.value.recorded && (await ctx.files.read(`${receivedDir(ctx, h.unit, h.run_id)}/${id}`)) !== null) return ok(undefined);
      return executor.runner.send(h.runner, marked);
    }
    const resume = async (): Promise<PluginResult<void>> => {
      const agentEnv = await this.agentEnv();
      if (!agentEnv.ok) return agentEnv;
      return resumeWith({ ctx, handle: h, harness: executor.harness, runner: executor.runner, id, text: marked, env: agentEnv.value, ...(executor.args !== undefined ? { args: executor.args } : {}) });
    };
    if ((await this.alive(handle)) === false) return resume();
    const queued = await queueInjection(ctx, h.unit, h.run_id, { id, source, text: marked, at, ...extra });
    if (!queued.ok) return queued;
    // the process may have ended between the probe and the queue, leaving no hook to carry the entry
    if ((await this.alive(handle)) !== false) return ok(undefined);
    if (!(await pendingInjections(ctx, h.unit, h.run_id)).injections.some((p) => p.id === id)) return ok(undefined);
    const resumed = await resume();
    if (!resumed.ok) return resumed;
    // the resumed prompt carries it; a later hook of the resumed session must not deliver it again
    return markDelivered(ctx, h.unit, h.run_id, [id]);
  }
}
