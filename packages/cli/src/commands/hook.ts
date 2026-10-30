/**
 * `norn hook <event> [--agent <name>]` (A2–A4, MO4): called by the agent tool's hooks with the
 * native payload on stdin. Normalizes it through the agent adapter, appends the hook fact to
 * the trace, and on turn end of an UNATTENDED step whose run has no report yet answers with the
 * adapter's block response telling the agent to report (A4). Attended steps never block (MO4).
 *
 * Must be fast and must never break the agent: outside a `.norn-unit` worktree it is a no-op
 * (A3), and any failure is swallowed into the adapter's "allow" answer (`{}`), exit 0.
 * The event argument is what the adapters install (`norn hook stop --agent claude`,
 * `norn hook pre-tool-use --agent codex`, …; native names like `Stop` work too). The agent is
 * `--agent` (a configured agent name or an adapter name; `norn init` always installs it), else
 * NORN_AGENT, else the first configured adapter (claude first) that recognizes the event.
 */
import { cmd, type AgentAdapter, currentRun, cursorStep, type HookDecision, type HookResponse, reportableOutcomes, standingReport } from "@norn/core";
import { DEFAULT_CONFIG, type ExitCode, type HookFact, type ResolvedConfig, ulid } from "@norn/schema";
import { appendTrace, blockedHookCount, loadConfig } from "@norn/store";
import { defineCommand, opt } from "../command.ts";
import { type Context, findUnitMarker, safeRealpath } from "../context.ts";
import { withExit } from "../output.ts";
import { loadUnitSession, ORIENT_ENV, type UnitSession } from "../runtime/agent-unit.ts";

/** P5: turn ends refused per run before norn lets the tick classify `silent` and nudge instead. */
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
    const f = ctx.registry.agents[config.agents[name]?.adapter ?? name];
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
 * A4: a fact the adapter can refuse is a turn end raised by the adapter's own turn-end hook —
 * its native event maps to `turn_end` in `adapter.hookEvents` (Claude/Codex `Stop`, Gemini
 * `AfterAgent`). A turn end derived from another event (Claude's `Notification` idle_prompt)
 * cannot be refused, so it is never traced `blocked` nor counted toward MAX_STOP_BLOCKS.
 */
const refusableTurnEnd = (adapter: AgentAdapter, fact: HookFact): boolean =>
  adapter.tier === "blocking" && fact.event === "turn_end" && fact.agent === adapter.name && Object.hasOwn(adapter.hookEvents, fact.native) && adapter.hookEvents[fact.native] === "turn_end";

/** A4 / MO4: block turn end only in an unattended agent step whose live run has not reported. */
function decideBlock(root: string, s: UnitSession | null, fact: HookFact, adapter: AgentAdapter): HookDecision {
  if (!refusableTurnEnd(adapter, fact) || !s) return { block: false };
  const step = cursorStep(s);
  if (!step || step.type !== "agent" || step.attended) return { block: false };
  if (s.state.status !== "running" && s.state.status !== "ready") return { block: false };
  const run = currentRun(s);
  if (!run || (fact.run_id && fact.run_id !== run.run_id)) return { block: false };
  if (standingReport(s, run.run_id)) return { block: false };
  if (blockedHookCount(root, run.run_id) >= MAX_STOP_BLOCKS) return { block: false };
  const outcomes = reportableOutcomes(step);
  return {
    block: true,
    reason:
      `norn: step ${s.state.step} of ${s.unit.key} has no report for this run. Before ending your turn, report exactly once: ` +
      `\`${cmd.done(`<${outcomes.join("|")}>`)}\`, \`${cmd.ask()}\` or \`${cmd.stuck()}\`. ` +
      `Run \`${cmd.brief()}\` to see what each outcome means.`,
  };
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
  summary: "Agent hook entry point: record a lifecycle fact; refuse an unreported turn end (A2–A4)",
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
      if (!found) return {}; // A3: no-op outside unit worktrees
      const root = safeRealpath(found.marker.repo);
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
        if (run) fact.run_id = run.run_id;
      }
      const decision = decideBlock(root, session, fact, adapter);
      appendTrace(root, { type: "hook", id: ulid(ctx.clock.now()), fact, ...(decision.block ? { blocked: true, reason: decision.reason } : {}) });
      return answer(adapter.hookResponse(fact, decision));
    } catch {
      return {}; // never break the agent
    }
  },
});
