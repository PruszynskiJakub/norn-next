/**
 * `norn hook <event> [--agent <name>]`: called by the agent tool's hooks with the
 * native payload on stdin. Normalizes it through the agent adapter, appends the hook fact to
 * the unit's hook file and the trace, and answers with what core's `hookAnswer` decides, encoded
 * by the adapter: a block on turn end of an UNATTENDED step whose run has no report yet (attended
 * steps never block), a re-orientation note on a session start that is not start-up, a reminder on
 * each prompt of an attended step, and in any step a denial of a tool call that pushes, switches
 * branch or worktree, changes the remote or writes norn's run state, with the rule's reason.
 *
 * Must be fast and must never break the agent: outside a `.norn-unit` worktree it is a no-op,
 * and any failure is swallowed into the adapter's "allow" answer (`{}`), exit 0.
 * The event argument is what the adapters install (`norn hook stop --agent claude`,
 * `norn hook pre-tool-use --agent codex`, …; native names like `Stop` work too). The agent is
 * `--agent` (a configured agent name or an adapter name; `norn init` always installs it), else
 * NORN_AGENT, else the first configured adapter (claude first) that recognizes the event.
 */
import { existsSync, realpathSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { type AgentAdapter, checkoutNames, currentRun, foreignFact, type HookAnswer, hookAnswer, type HookAnswerInput, type HookResponse, type ToolCall } from "@norn/core";
import { DEFAULT_CONFIG, type ExitCode, type HookFact, type ResolvedConfig, ulid } from "@norn/schema";
import { appendHookTrace, bindNornHome, blockedHookCount, claimStopBlock, loadConfig, machineRunsDir, spawnSyncCaptured } from "@norn/store";
import { defineCommand, opt } from "../command.ts";
import { type Context, findUnitMarker, safeRealpath } from "../context.ts";
import { withExit } from "../output.ts";
import { loadUnitSession, ORIENT_ENV, type UnitSession } from "../runtime/agent-unit.ts";

/** Turn ends refused per run before norn lets the tick classify `silent` and nudge instead. */
export const MAX_STOP_BLOCKS = 3;

async function readStdin(ctx: Context): Promise<string> {
  if (ctx.deps.stdin !== undefined) return ctx.deps.stdin;
  if (process.stdin.isTTY) return "";
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<string>((r) => {
    timer = setTimeout(() => r(""), 2000);
    (timer as { unref?: () => void }).unref?.();
  });
  try {
    return await Promise.race([Bun.stdin.text(), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function parsePayload(text: string): unknown {
  if (!text.trim()) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

const field = (payload: unknown, key: string): string | undefined => {
  const v = typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>)[key] : undefined;
  return typeof v === "string" && v ? v : undefined;
};

function pickAdapter(ctx: Context, root: string, config: ResolvedConfig, flag: string | undefined, event: string, payload: unknown, at: string): AgentAdapter | null {
  const actx = ctx.adapterContext(root, config);
  const make = (name: string): AgentAdapter | null => {
    const f = ctx.registry.agents[name];
    return f ? f(actx) : null;
  };
  const named = flag ?? ctx.env.NORN_AGENT;
  if (named) return make(named);
  for (const name of new Set(["claude", ...Object.keys(config.agents)])) {
    const a = make(name);
    if (a?.parseHookEvent(event, payload, ctx.env, at)) return a;
  }
  return null;
}

/**
 * Take one of the run's refusals. The traced count is read before this hook's line is appended, so
 * it alone lets hooks that fire together each refuse past the cap; the exclusive refusal file holds
 * it. A failed write refuses nothing, so the hook fact is still traced and the agent never breaks.
 */
function takeRefusal(root: string, s: UnitSession, runId: string): boolean {
  try {
    const traced = blockedHookCount(root, { story: s.unit.story, slice: s.unit.slice }, runId);
    return traced < MAX_STOP_BLOCKS && claimStopBlock(root, runId, traced, MAX_STOP_BLOCKS);
  } catch {
    return false;
  }
}

/**
 * The bare `git checkout <name>` names of a shell call that resolve to a commit in the worktree,
 * the one fact core needs to tell a branch switch from a path checkout. Asked only for those
 * commands, so other tool calls stay fast; a git that cannot answer throws, and the hook allows.
 */
function resolvedCommits(worktree: string, env: Record<string, string | undefined>, call: ToolCall | null): string[] {
  if (call?.kind !== "shell") return [];
  return checkoutNames(call.command).filter((name) => {
    const r = spawnSyncCaptured(["git", "rev-parse", "--verify", "--quiet", `${name}^{commit}`], { cwd: worktree, env, timeoutMs: 2000 });
    if (r.exitedDueToTimeout || r.exitCode === null) throw new Error("git rev-parse did not answer");
    return r.exitCode === 0;
  });
}

/**
 * Where a path written now would land: relative to `cwd`, its nearest existing parent through
 * realpath and the rest appended, so a symlink or a file not there yet resolves as the write would.
 */
function resolveWrite(cwd: string, path: string): string {
  let at = resolve(cwd, path);
  const rest: string[] = [];
  while (!existsSync(at) && dirname(at) !== at) {
    rest.unshift(basename(at));
    at = dirname(at);
  }
  return join(realpathSync(at), ...rest);
}

/** Resolved only for a file write: realpath runs on every such call, so nothing else pays for it. */
function fileWriteFacts(root: string, cwd: string, call: ToolCall | null): HookAnswerInput["fileWrite"] {
  if (call?.kind !== "file_write") return null;
  return { paths: call.paths.map((p) => resolveWrite(cwd, p)), runStateDir: resolveWrite(cwd, machineRunsDir(root)) };
}

/**
 * Core decides; a turn-end block still has to take one of the run's MAX_STOP_BLOCKS refusals.
 * Taking one stays the last gate, so a refusal is spent only when this hook blocks.
 */
function gatedAnswer(ctx: Context, root: string, cwd: string, worktree: string, s: UnitSession | null, fact: HookFact, adapter: AgentAdapter, payload: unknown): HookAnswer {
  const toolCall = adapter.toolCall(fact.native, payload);
  const decided = hookAnswer({ session: s, fact, toolCall, adapter, commits: s ? resolvedCommits(worktree, ctx.env, toolCall) : [], fileWrite: fileWriteFacts(root, cwd, toolCall) });
  if (decided.kind !== "block") return decided;
  const run = s && currentRun(s);
  return run && takeRefusal(root, s, run.run_id) ? decided : { kind: "allow" };
}

function answer(r: HookResponse): unknown {
  let value: unknown = {};
  if (r.stdout.trim()) {
    try {
      value = JSON.parse(r.stdout);
    } catch {
      value = {};
    }
  }
  return r.exit_code === 0 ? value : withExit(value, r.exit_code as ExitCode);
}

export const hookEventCommand = defineCommand({
  name: "hook",
  version: "exempt",
  summary: "Agent hook entry point: record a lifecycle fact; refuse an unreported turn end or a tool call that breaks a hard rule",
  usage: "norn hook <event> [--agent claude]  (payload JSON on stdin)",
  options: { agent: { type: "string" } },
  positionals: { min: 0, max: 8 },
  repo: false,
  async run(ctx, args) {
    try {
      if (ctx.env[ORIENT_ENV] === "1") return {}; // an orient agent sits in the worktree but is no run of it
      const payload = parsePayload(await readStdin(ctx));
      const event = args.positionals[0] ?? field(payload, "hook_event_name") ?? "";
      const cwd = field(payload, "cwd") ?? ctx.cwd;
      const found = findUnitMarker(safeRealpath(cwd)) ?? findUnitMarker(safeRealpath(ctx.cwd));
      if (!found) return {}; // No-op outside unit worktrees
      const root = safeRealpath(found.marker.repo);
      bindNornHome(root, ctx.home); // repo: false, so no locate() bound this command's home
      const loaded = loadConfig({ repoRoot: root, home: ctx.home, env: ctx.env });
      const config = loaded.ok ? loaded.config : DEFAULT_CONFIG;
      const at = ctx.clock.iso();
      const adapter = pickAdapter(ctx, root, config, opt.str(args, "agent"), event, payload, at);
      const parsed = adapter?.parseHookEvent(event, payload, ctx.env, at) ?? null;
      if (!adapter || !parsed) return {};

      let session: UnitSession | null = null;
      try {
        session = loadUnitSession(ctx, "hook", found);
      } catch {
        session = null; // not started, corrupt: record the fact, never block
      }
      const fact: HookFact = { ...parsed };
      fact.story ??= found.marker.story;
      if (found.marker.slice) fact.slice ??= found.marker.slice;
      if (!fact.run_id && session) {
        const run = currentRun(session);
        // Another agent session's fact is not the run's (no silent, nudge or snapshot from it)
        if (run && !foreignFact(session, run.run_id, fact)) fact.run_id = run.run_id;
      }
      const decided = gatedAnswer(ctx, root, cwd, found.worktree, session, fact, adapter, payload);
      // The unit is the worktree's, whether the fact names a run or not
      const unit = { story: found.marker.story, slice: found.marker.slice ?? null };
      appendHookTrace(root, unit, { type: "hook", id: ulid(ctx.clock.now()), fact, ...(decided.kind === "block" || decided.kind === "deny" ? { blocked: true, reason: decided.reason } : {}) });
      return answer(adapter.hookResponse(fact, decided));
    } catch {
      return {}; // never break the agent
    }
  },
});
