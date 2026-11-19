/**
 * AgentLauncher by composition: each executor is a harness (how the agent is wired and launched)
 * running in a runner (where its process lives).
 *
 * - start: `harness.install` in the worktree with the hook command, the pack's skills written to
 *   the harness's `skillsDir` (skills.ts), the brief rendered and marked
 *   (prompt id = the run id) and recorded as sent, `harness.launch` (headless when the runner has no
 *   pane), then `runner.start` keyed by the run id, so a replayed start finds the first process. The
 *   launch env carries RUN_ENV (unit and run) and never the per-launch NORN_PROMPT_SOURCE.
 * - nudge / answer: marked with an id derived from the decision (nudgePromptId, answerPromptId) and recorded as sent, then `runner.send` when the runner has pane input
 *   and the harness reads typed prompts; else queued in the run's outbox for the next hook answer
 *   (`injectContext`), or, when the run's process has ended (a headless agent exits as its turn
 *   ends), handed to a resumed launch of its session (launcher-resume.ts). A nudge to a live process
 *   with no hook activity for the silent window is not queued: a hung agent fires no hook, so its
 *   process is stopped and the session resumed with the nudge. With none of these, refused: a nudge
 *   is never dropped silently. A refused nudge still counts against the step's nudges, as its intent
 *   is recorded before the send, which also bounds the nudges spent on a session that cannot take one.
 * - every launch, resumed ones too, puts agent-bin.ts's folder first on the agent's PATH, so the
 *   `norn` the brief tells the agent to run is the build that launched it.
 * - a dialog answer (a permission or trust prompt in the agent's pane): the harness's keys for the
 *   answer pressed through the runner, only for a run this machine launched, only while the run's
 *   events still show that dialog open, and not again once recorded as sent (recorded after the keys
 *   went in: a crash between the two presses them again, which beats never), as keys pressed after
 *   it closed would land in the agent's prompt. A refusal is followed by a prompt saying so.
 * - stop / alive: the runner, on the run's newest process (its latest resume, else the first).
 * The handle is launcher-handle.ts's: executor, unit, run and the runner's own handle.
 */
import { DEFAULT_KERNEL_CONFIG, reduceSession } from "@norn/kernel";
import type { Harness, HostContext, NornPromptSource, PluginResult, Runner, RunnerSplitRequest } from "@norn/plugin-api";
import { fail, markPrompt, ok, RUN_ENV } from "@norn/plugin-api";
import { agentBinEnv, cliOfHookCommand } from "./agent-bin.ts";
import { dialogInputId } from "./dialog.ts";
import { readEvents } from "./events/log.ts";
import { markDelivered, pendingInjections, queueInjection, readSentPrompt, recordSentPrompt } from "./events/outbox.ts";
import { receivedDir } from "./events/paths.ts";
import { decodeLaunchHandle, encodeLaunchHandle, type LaunchHandle } from "./launcher-handle.ts";
import { currentRunnerHandle, keyOf, launchedHere, readLaunch, recordLaunch, resumesOf, resumeWith } from "./launcher-resume.ts";
import { shellQuote } from "./shell.ts";
import { installSkills, type PackSkills } from "./skills.ts";
import type { AgentLauncher, AgentRunRequest, AnswerOptions, ExecutorModes, LauncherModes } from "./types.ts";

/** `no` refuses, as the dialog contract names it for every harness. */
const isRefusal = (answer: string): boolean => /^(no|n)$/i.test(answer.trim());
/** `yes` picks the option that says yes, which only the dialog as shown can place. */
const isYes = (answer: string): boolean => /^(yes|y)$/i.test(answer.trim());

function refusalText(permission: { prompt: string; call?: { tool: string } }): string {
  const what = permission.call ? permission.call.tool : permission.prompt;
  return `The person refused the permission for ${what}. Do not try that call again; go on without it, or ask with norn ask if the step cannot be done without it.`;
}

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
  /**
   * How long a session goes without an event before it reads as silent (`kernel.silent_after`): a
   * live process quiet this long fires no hook to carry a queued nudge. Default: the kernel's.
   */
  silentAfterMs?: number;
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

const HEAD_LINES = 5;
const HEAD_CHARS = 600;

/** The first non-empty lines of a log, joined with ` | ` and cut to fit a reason; null when there are none. */
export function logHead(text: string): string | null {
  const head = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "")
    .slice(0, HEAD_LINES)
    .join(" | ");
  if (!head) return null;
  return head.length > HEAD_CHARS ? `${head.slice(0, HEAD_CHARS - 1)}…` : head;
}

export class HarnessLauncher implements AgentLauncher {
  constructor(readonly opts: HarnessLauncherOptions) {}

  /** The env every launch adds for the agent beside the run's own: the configured env and agent-bin.ts's PATH. */
  private async agentEnv(): Promise<PluginResult<Record<string, string>>> {
    const bin = await agentBinEnv(this.opts.ctx, cliOfHookCommand(this.opts.hookCommand), this.opts.hostPath);
    return bin.ok ? ok({ ...this.opts.agentEnv, ...bin.value }) : bin;
  }

  /** The harness's hooks and the pack's skills in the worktree; both are ignored by git, so a clean of the worktree takes them away. */
  private async install(harness: Harness, worktree: string): Promise<PluginResult<void>> {
    try {
      await harness.install({ worktree, hookCommand: shellQuote([...this.opts.hookCommand, harness.name]) });
    } catch (err) {
      return fail("unavailable", `${harness.name}: installing hooks in ${worktree} failed: ${message(err)}`);
    }
    if (harness.skillsDir !== undefined && this.opts.skills !== undefined) {
      try {
        await installSkills(this.opts.ctx.files, worktree, harness.skillsDir, this.opts.skills);
      } catch (err) {
        return fail("unavailable", `${harness.name}: writing the pack's skills to ${worktree}/${harness.skillsDir} failed: ${message(err)}`);
      }
    }
    return ok(undefined);
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
    return {
      headless: r.headless,
      attended: r.attended,
      paneInput: r.paneInput && e.harness.capabilities.paneInput,
      dialogKeys: typeof e.runner.keys === "function" && typeof e.harness.dialogKeys === "function",
      focus: typeof e.runner.focus === "function",
    };
  }

  async start(run: AgentRunRequest): Promise<PluginResult<{ handle: string }>> {
    const e = this.opts.executors[run.executor];
    if (!e) return fail("not_found", `no executor ${JSON.stringify(run.executor)} is configured`, false);
    const { ctx } = this.opts;
    const installed = await this.install(e.harness, run.worktree);
    if (!installed.ok) return installed;
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

  async answer(handle: string, inputId: string, text: string, opts: AnswerOptions = {}): Promise<PluginResult<void>> {
    if (opts.dialog === true) return this.pressDialog(handle, inputId, text);
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

  async close(handle: string): Promise<PluginResult<boolean>> {
    const found = this.resolve(handle);
    if (!found.ok) return found;
    const { handle: h, executor } = found.value;
    const runner = executor.runner;
    if (!runner.close) return ok(false);
    const { ctx } = this.opts;
    // a pane id names a pane only on the machine that opened it
    if (!(await launchedHere(ctx, h.unit, h.run_id))) return ok(false);
    const launches = [...(await resumesOf(ctx, h.unit, h.run_id)).map((r) => ({ runner: r.handle, key: keyOf(h.run_id, r.id) })), { runner: h.runner, key: h.run_id }];
    let closed = false;
    for (const l of launches) {
      const done = await runner.close(l.runner, l.key);
      if (!done.ok) return done;
      closed ||= done.value;
    }
    return ok(closed);
  }

  /**
   * Whether the handle's process still runs, for the session source's died detection; null when the
   * runner cannot tell (or the handle is not this launcher's, or its run was launched on another
   * machine, whose pane id may name an unrelated pane here), which is never read as dead.
   */
  async alive(handle: string): Promise<boolean | null> {
    const found = this.resolve(handle);
    if (!found.ok) return null;
    try {
      if (!(await launchedHere(this.opts.ctx, found.value.handle.unit, found.value.handle.run_id))) return null;
      const alive = await found.value.executor.runner.alive(await currentRunnerHandle(this.opts.ctx, found.value.handle));
      return alive.ok ? alive.value : null;
    } catch {
      return null;
    }
  }

  /**
   * The dialog the run's pane shows, for decide to park on at once rather than after the silent
   * window; null when its runner reads no pane, or for a run launched on another machine, whose pane
   * id may name an unrelated pane here.
   */
  async dialog(handle: string): Promise<string | null> {
    const found = this.resolve(handle);
    if (!found.ok) return null;
    const runner = found.value.executor.runner;
    if (!runner.dialog) return null;
    try {
      if (!(await launchedHere(this.opts.ctx, found.value.handle.unit, found.value.handle.run_id))) return null;
      const read = await runner.dialog(await currentRunnerHandle(this.opts.ctx, found.value.handle));
      return read.ok ? read.value : null;
    } catch {
      return null;
    }
  }

  async focus(handle: string): Promise<PluginResult<boolean>> {
    const found = this.resolve(handle);
    if (!found.ok) return found;
    const { handle: h, executor } = found.value;
    const runner = executor.runner;
    if (!runner.focus) return fail("invalid", `${h.unit} run ${h.run_id} runs in ${runner.name}, which has no pane to bring in front`, false);
    // a pane id names a pane only on the machine that opened it
    if (!(await launchedHere(this.opts.ctx, h.unit, h.run_id))) return fail("invalid", `${h.unit} run ${h.run_id} was launched on another machine: its pane is there`, false);
    return runner.focus(await currentRunnerHandle(this.opts.ctx, h));
  }

  async split(req: RunnerSplitRequest): Promise<PluginResult<{ handle: string }>> {
    const runners = Object.values(this.opts.executors).map((e) => e.runner);
    const opens = runners.find((r) => typeof r.split === "function");
    if (!opens?.split) return fail("invalid", `no configured runner opens a pane a person sees (${[...new Set(runners.map((r) => r.name))].join(", ")})`, false);
    return opens.split(req);
  }

  async label(workspace: string, text: string, ttlMs: number): Promise<PluginResult<boolean>> {
    let shown = false;
    for (const runner of new Set(Object.values(this.opts.executors).map((e) => e.runner))) {
      if (!runner.label) continue;
      const r = await runner.label(workspace, text, ttlMs);
      if (!r.ok) return r;
      shown ||= r.value;
    }
    return ok(shown);
  }

  async dialogTakes(handle: string, answer: string): Promise<{ takes: boolean; dialog: string; instead: string } | null> {
    const found = this.resolve(handle);
    if (!found.ok) return null;
    const { runner, harness } = found.value.executor;
    if (!runner.dialog || !harness.dialogKeys) return null;
    try {
      if (!(await launchedHere(this.opts.ctx, found.value.handle.unit, found.value.handle.run_id))) return null;
      const shown = await runner.dialog(await currentRunnerHandle(this.opts.ctx, found.value.handle), { anyStatus: true });
      if (!shown.ok || shown.value === null) return null;
      const dialog = shown.value;
      const takes = (a: string) => harness.dialogKeys?.(a, dialog) != null;
      // no is offered last: it refuses what the agent asked for
      return { takes: takes(answer), dialog, instead: ["yes", "1", "no"].find(takes) ?? "no" };
    } catch {
      return null;
    }
  }

  /**
   * The head of the run's log: its first non-empty lines, joined and cut, so a process that ended
   * before it said anything through a hook can still say why. Null for a run launched elsewhere (its
   * log is on that machine), with no log, or a handle not this launcher's.
   */
  async output(handle: string): Promise<string | null> {
    const found = this.resolve(handle);
    if (!found.ok) return null;
    const { ctx } = this.opts;
    try {
      const launch = await readLaunch(ctx, found.value.handle.unit, found.value.handle.run_id);
      if (!launch.ok) return null;
      const text = await ctx.files.read(launch.value.logPath);
      return text === null ? null : logHead(text);
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
      return resumeWith({
        ctx,
        handle: h,
        harness: executor.harness,
        runner: executor.runner,
        id,
        text: marked,
        env: agentEnv.value,
        prepare: (cwd) => this.install(executor.harness, cwd),
        ...(executor.args !== undefined ? { args: executor.args } : {}),
      });
    };
    const alive = await this.alive(handle);
    if (alive === false) return resume();
    if (source === "nudge" && alive === true && (await this.silent(h))) return this.restartWith(handle, h, executor.harness, id, resume);
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

  private async pressDialog(handle: string, inputId: string, text: string): Promise<PluginResult<void>> {
    const found = this.resolve(handle);
    if (!found.ok) return found;
    const { ctx } = this.opts;
    const { handle: h, executor } = found.value;
    const { runner, harness } = executor;
    if (!runner.keys || !harness.dialogKeys)
      return fail("invalid", `${h.unit} run ${h.run_id} cannot answer a dialog in its pane: ${runner.keys ? `${harness.name} names no keys for its dialogs` : `${runner.name} cannot press keys in a pane`}`, false);
    const keys = harness.dialogKeys(text);
    if (!keys) return fail("invalid", `${harness.name}'s dialog takes no ${JSON.stringify(text)}: answer with an option's number, yes or no`, false);
    if (!(await launchedHere(ctx, h.unit, h.run_id)))
      return fail("not_found", `${h.unit} run ${h.run_id} was not launched on this machine: its pane is not here to take the keys`, false);
    const id = answerPromptId(inputId);
    if ((await readSentPrompt(ctx, h.unit, h.run_id, id)) !== null) return ok(undefined);
    const read = await readEvents(ctx, h.unit, h.run_id);
    const permission = reduceSession(read.events).permission ?? null;
    const open = permission ? dialogInputId(permission, h.run_id) === inputId : read.events.length === 0 && dialogInputId(null, h.run_id) === inputId;
    // answered in the pane meanwhile: nothing waits for the keys
    if (!open) return ok(undefined);
    const pane = await currentRunnerHandle(ctx, h);
    // a menu with no numbers is moved through from where its cursor stands, which only the pane shows;
    // it is read whatever the runner makes of the agent, as a missed dialog still takes these keys
    const shown = runner.dialog ? await runner.dialog(pane, { anyStatus: true }) : null;
    const screen = shown?.ok ? shown.value : null;
    // yes names a different option per menu, and pressed blind on a menu whose cursor starts on its
    // refusal it would confirm the refusal
    if (screen === null && isYes(text))
      return fail("invalid", `${h.unit} run ${h.run_id}'s pane could not be read to find the option that says yes: answer with the option's number as the pane shows it`, false);
    const chosen = screen !== null ? harness.dialogKeys(text, screen) : keys;
    if (!chosen) return fail("invalid", `${harness.name}'s dialog as its pane shows it takes no ${JSON.stringify(text)}: answer with an option's number as the pane shows it, or no`, false);
    const pressed = await runner.keys(pane, chosen);
    if (!pressed.ok) return pressed;
    // a refused call ends the agent's turn with no hook that closes the permission, so the run would
    // park on it again while the agent waits at an empty prompt; the prompt starts a turn, which closes it
    if (permission && isRefusal(text) && this.modesOf(h.executor)?.paneInput === true) {
      const told = await runner.send(pane, markPrompt(refusalText(permission), { source: "answer", id }));
      if (!told.ok) return told;
    }
    const recorded = await recordSentPrompt(ctx, h.unit, h.run_id, { id, source: "answer", at: ctx.now(), input_id: inputId });
    return recorded.ok ? ok(undefined) : recorded;
  }

  /** No event from the run's session (or, before its first, since its launch) for the silent window. */
  private async silent(h: LaunchHandle): Promise<boolean> {
    const { ctx } = this.opts;
    const last = reduceSession((await readEvents(ctx, h.unit, h.run_id)).events).last_event_at ?? (await readSentPrompt(ctx, h.unit, h.run_id, h.run_id))?.at;
    if (last === undefined) return false;
    return Date.parse(ctx.now()) - Date.parse(last) >= (this.opts.silentAfterMs ?? DEFAULT_KERNEL_CONFIG.silentAfterMs);
  }

  /**
   * Stop a live but silent process and resume its session with the nudge. Whether it can resume is
   * settled before the stop: a stopped agent that cannot come back is a death the nudge caused.
   */
  private async restartWith(handle: string, h: LaunchHandle, harness: Harness, id: string, resume: () => Promise<PluginResult<void>>): Promise<PluginResult<void>> {
    const { ctx } = this.opts;
    // a replay after the resume must not stop the resumed process
    if ((await resumesOf(ctx, h.unit, h.run_id)).some((r) => r.id === id)) return ok(undefined);
    const what = `${h.unit} run ${h.run_id} is silent and fires no hook to carry a nudge`;
    if (harness.capabilities.resume !== true) return fail("unavailable", `${what}, and ${harness.name} cannot resume its session`, false);
    if (reduceSession((await readEvents(ctx, h.unit, h.run_id)).events).harness_session === undefined)
      return fail("unavailable", `${what}, and it never reported a harness session to resume`, false);
    const stopped = await this.stop(handle);
    if (!stopped.ok) return stopped;
    return resume();
  }
}
