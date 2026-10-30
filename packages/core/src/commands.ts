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
      return cmd.runView(unitKey, { why: true });
    case "stuck":
      return cmd.runRerun(unitKey);
    case "parked":
      if (state.park?.kind === "ask") return cmd.storyAnswer(unitKey);
      if (state.park?.kind === "gate") return cmd.storyApprove(unitKey);
      if (state.park?.kind === "attended") return start ?? cmd.brief();
      return cmd.runRerun(unitKey);
    case "ready":
      return start ?? cmd.brief();
    case "running":
      return cmd.runList(unitKey);
  }
}

const norn = (...parts: (string | false | null | undefined)[]) => ["norn", ...parts.filter((p): p is string => !!p)].join(" ");

/**
 * Builders for every norn command printed to a person or an agent (inbox items, decide details,
 * `do_instead` hints, handoff headers, briefs, cockpit actions, next steps). B7: renaming a command
 * is a change here and in its pinned table (`packages/core/test/printed-commands.test.ts`), nowhere else.
 */
export const cmd = {
  config: (key?: string) => norn("config", key ? "get" : "list", key),
  ask: () => norn("ask", `"<question>"`),
  brief: () => norn("brief"),
  doctor: (o: { json?: boolean } = {}) => norn("doctor", o.json && "--json"),
  done: (outcome: string, o: { criteria?: boolean } = {}) => norn("done", outcome, o.criteria && "--criteria <file>", `--handoff "…"`),
  help: () => norn("help"),
  init: () => norn("init"),
  migrate: () => norn("migrate"),
  status: (o: { notes?: boolean; since?: string } = {}) => norn("status", o.notes && "--notes", o.since && `--history --since ${o.since}`),
  statusWatch: (o: { interval?: string } = {}) => norn("status --watch", o.interval && `--interval ${o.interval}`),
  storyAnswer: (unit: string, text = "…") => norn("story answer", unit, `"${text}"`),
  storyApprove: (unit: string) => norn("story approve", unit),
  storyReject: (unit: string) => norn("story reject", unit, `--reason "…"`),
  storyUpdateBranch: (story?: string) => norn("story update-branch", story),
  storyChat: (story?: string) => norn("story chat", story),
  storyEdit: (unit: string, o: { mode?: "auto" | "manual"; workflow?: string; at?: string } = {}) =>
    norn("story edit", unit, o.mode && `--${o.mode}`, o.workflow && `--workflow ${o.workflow}`, o.at && `--at ${o.at}`),
  storyStart: (unit?: string, o: { print?: boolean } = {}) => norn("story start", unit, o.print && "--print"),
  storyView: (target?: string, o: { web?: boolean } = {}) => norn("story view", target, o.web && "--web"),
  stuck: (reason = "<reason>") => norn("stuck", `"${reason}"`),
  storyCreate: (o: { title?: string; workflow?: string } = {}) => norn("story create", `--title "${o.title ?? "…"}"`, o.workflow && `--workflow ${o.workflow}`),
  storyCheckout: (story: string, o: { force?: boolean } = {}) => norn("story checkout", story, o.force && "--force"),
  storyClose: (story?: string, o: { yes?: boolean } = {}) => norn("story close", story, o.yes && "--yes"),
  storyHandoff: (story?: string) => norn("story handoff", story),
  storyReopen: (story?: string) => norn("story reopen", story),
  runList: (unit: string, o: { limit?: number } = {}) => norn("run list", unit, o.limit !== undefined && `--limit ${o.limit}`),
  runAttach: (unit?: string, o: { next?: boolean } = {}) => norn("run attach", unit, o.next && "--next"),
  runView: (unit = "<unit>", o: { why?: boolean; tick?: string; receipt?: string } = {}) =>
    norn("run view", unit, o.why && "--why", o.tick && `--tick ${o.tick}`, o.receipt && `--receipt ${o.receipt}`),
  runRerun: (unit?: string, o: { step?: string; reset?: string } = {}) => norn("run rerun", unit, o.step && `--step ${o.step}`, o.reset && `--reset ${o.reset}`),
  runCancel: (unit?: string) => norn("run cancel", unit),
  sync: () => norn("sync"),
  tick: () => norn("tick"),
  tidy: (o: { dryRun?: boolean } = {}) => norn("tidy", o.dryRun && "--dry-run"),
  watch: (o: { interval?: string; maxTicks?: number } = {}) => norn("watch", o.interval && `--interval ${o.interval}`, o.maxTicks !== undefined && `--max-ticks ${o.maxTicks}`),
};

/** B5: the top-level commands this release removed; no printed command names one (B7). */
export const REMOVED_COMMANDS = ["drop", "inbox", "cockpit", "orient", "open", "answer", "approve", "unstick", "update", "mode", "workflow", "take", "release", "trace", "why"] as const;

const REMOVED = new RegExp(`\\bnorn (${REMOVED_COMMANDS.join("|")})(?![\\w-])`);

/** B7: the first removed command (`norn <old>`) a printed text names, or null. */
export function nameRemoved(text: string): string | null {
  const m = REMOVED.exec(text);
  return m ? `norn ${m[1]}` : null;
}
