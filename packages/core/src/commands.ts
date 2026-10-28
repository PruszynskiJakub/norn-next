/** Exact commands shown to people (O1, S9) and naming conventions shared by decide, inbox and handoff. */
import { sliceDirName, storyDirName, type UnitState } from "@norn/schema";

/** B5: the whole first prompt of an auto-mode agent session. */
export const AUTO_PROMPT = "Use the norn skill, then run `norn brief`.";

/** Text typed into a silent/timed-out/stalled session (C1). */
export const NUDGE_TEXT =
  "You ended your turn without reporting. Finish the step and report exactly once: `norn done <outcome> --handoff \"…\"`, `norn ask \"…\"` or `norn stuck \"…\"`. Run `norn brief` to see the outcomes.";

const q = (s: string) => (/^[\w./@:-]+$/.test(s) ? s : `'${s.replaceAll("'", "'\\''")}'`);

/** Worktree path conventions (GR3, K5): story worktrees sit beside the repo; slice worktrees beside their story's. */
export const storyWorktreePath = (repoRoot: string, story: string, slug: string) =>
  `${repoRoot.replace(/\/+$/, "")}-worktrees/${storyDirName(story, slug)}`;
export const sliceWorktreePath = (storyWorktree: string, nn: string, slug: string) =>
  `${storyWorktree.replace(/\/+$/, "")}--${sliceDirName(nn, slug)}`;

/**
 * Command that starts an agent in a worktree for a person (manual mode, attended steps), with the
 * agent's configured args. B3: `--` ends them, so a variadic flag cannot swallow the prompt.
 * `prompt` is the first prompt (default: start the step).
 */
export function startAgentCommand(worktree: string | null, agentCommand: string, args: string[] = [], prompt = AUTO_PROMPT): string {
  const opts = args.length ? `${args.map(q).join(" ")} -- ` : "";
  const run = `${agentCommand} ${opts}${q(prompt)}`;
  return worktree ? `cd ${q(worktree)} && ${run}` : run;
}

/**
 * The next command for a unit, by its state (S9 header, O1 inbox). `start` is the
 * command that starts an agent in the worktree, used for ready/attended agent steps.
 */
export function nextCommand(unitKey: string, state: UnitState | null, start?: string): string | null {
  if (!state) return null;
  switch (state.status) {
    case "done":
      return null;
    case "corrupt":
      return cmd.why(unitKey);
    case "stuck":
      return cmd.unstick(unitKey);
    case "parked":
      if (state.park?.kind === "ask") return cmd.answer(unitKey);
      if (state.park?.kind === "gate") return cmd.approve(unitKey);
      if (state.park?.kind === "attended") return start ?? cmd.brief();
      return cmd.unstick(unitKey);
    case "ready":
      return start ?? cmd.brief();
    case "running":
      return cmd.trace(unitKey);
  }
}

const norn = (...parts: (string | false | null | undefined)[]) => ["norn", ...parts.filter((p): p is string => !!p)].join(" ");

/**
 * Builders for every norn command printed to a person or an agent (inbox items, decide details,
 * `do_instead` hints, handoff headers, briefs, cockpit actions, next steps). B7: renaming a command
 * is a change here and in its pinned table (`packages/core/test/printed-commands.test.ts`), nowhere else.
 */
export const cmd = {
  config: (key?: string) => norn("config", key),
  answer: (unit: string, text = "…") => norn("answer", unit, `"${text}"`),
  approve: (unit: string, o: { reject?: boolean } = {}) => norn("approve", unit, o.reject && `--reject --reason "…"`),
  ask: () => norn("ask", `"<question>"`),
  brief: () => norn("brief"),
  cockpit: (o: { interval?: string } = {}) => norn("cockpit", o.interval && `--interval ${o.interval}`),
  doctor: (o: { json?: boolean } = {}) => norn("doctor", o.json && "--json"),
  done: (outcome: string, o: { criteria?: boolean } = {}) => norn("done", outcome, o.criteria && "--criteria <file>", `--handoff "…"`),
  drop: (story?: string) => norn("drop", story),
  help: () => norn("help"),
  inbox: (o: { notes?: boolean; since?: string } = {}) => norn("inbox", o.notes && "--notes", o.since && `--history --since ${o.since}`),
  init: () => norn("init"),
  mode: (story: string, mode: string) => norn("mode", story, mode),
  orient: (story: string) => norn("orient", story),
  open: (unit?: string) => norn("open", unit),
  release: (story: string) => norn("release", story),
  status: (target?: string) => norn("status", target),
  stuck: (reason = "<reason>") => norn("stuck", `"${reason}"`),
  storyCreate: (o: { title?: string; workflow?: string } = {}) => norn("story create", `--title "${o.title ?? "…"}"`, o.workflow && `--workflow ${o.workflow}`),
  runList: (unit: string, o: { limit?: number } = {}) => norn("run list", unit, o.limit !== undefined && `--limit ${o.limit}`),
  runView: (unit = "<unit>", o: { why?: boolean } = {}) => norn("run view", unit, o.why && "--why"),
  sync: () => norn("sync"),
  take: (story: string, o: { force?: boolean } = {}) => norn("take", story, o.force && "--force"),
  tick: () => norn("tick"),
  tidy: (o: { dryRun?: boolean } = {}) => norn("tidy", o.dryRun && "--dry-run"),
  trace: (unit: string, o: { limit?: number } = {}) => norn("trace", unit, o.limit !== undefined && `--limit ${o.limit}`),
  unstick: (unit?: string, o: { to?: string; reset?: string } = {}) => norn("unstick", unit, o.to && `--to ${o.to}`, o.reset && `--reset ${o.reset}`),
  update: (story?: string) => norn("update", story),
  watch: (o: { interval?: string; maxTicks?: number } = {}) => norn("watch", o.interval && `--interval ${o.interval}`, o.maxTicks !== undefined && `--max-ticks ${o.maxTicks}`),
  why: (unit: string, o: { tick?: string; receipt?: string } = {}) => norn("why", unit, o.tick && `--tick ${o.tick}`, o.receipt && `--receipt ${o.receipt}`),
  workflow: (unit: string, name = "<name>", o: { to?: string } = {}) => norn("workflow", unit, name, o.to && `--to ${o.to}`),
};
