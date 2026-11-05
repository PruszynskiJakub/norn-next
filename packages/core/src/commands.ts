/** Exact commands shown to people (O1, S9) and naming conventions shared by decide, inbox and handoff. */
import { sliceDirName, storyDirName, type UnitState, versionMatch } from "@norn/schema";

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
      return unstickCommand(unitKey, state);
    case "parked":
      if (state.park?.kind === "ask") return cmd.storyAnswer(unitKey);
      if (state.park?.kind === "gate") return cmd.storyApprove(unitKey);
      if (state.park?.kind === "attended") return start ?? cmd.brief();
      return unstickCommand(unitKey, state);
    case "ready":
      return start ?? cmd.brief();
    case "running":
      return cmd.runList(unitKey);
  }
}

/**
 * The way out of a stuck or parked unit (O1, W4). A counter that ran out (gh-212) leads to the target of
 * the edge it guards with that counter reset: a plain rerun would restart the same step, and the same
 * outcome would exhaust the counter again. A reserved target (`$done`, `$stuck`) is no step to move to,
 * so the step reruns with the counter reset.
 */
export function unstickCommand(unitKey: string, state: Pick<UnitState, "park">): string {
  const c = state.park?.kind === "exhausted" ? state.park.counter : undefined;
  if (!c) return cmd.runRerun(unitKey);
  return cmd.runRerun(unitKey, { ...(c.to.startsWith("$") ? {} : { step: c.to }), reset: c.name });
}

/**
 * gh-212 (W4): a rerun of a unit stuck on a run-out counter that leaves the counter at its max warns:
 * the edge it guards stays closed, so the same outcome ends stuck again (a plain rerun of the same step
 * on unchanged code most likely does). Null when nothing to warn about.
 */
export function rerunWarning(unitKey: string, state: Pick<UnitState, "park" | "step">, o: { reset: readonly string[] }): string | null {
  const c = state.park?.kind === "exhausted" ? state.park.counter : undefined;
  if (!c || o.reset.includes(c.name)) return null;
  return `${c.name} ran out (${c.max}/${c.max}) at ${state.step}.${c.outcome} and is not reset: if ${state.step} ends ${c.outcome} again, the unit is stuck again. To act on ${c.outcome}: ${unstickCommand(unitKey, state)}`;
}

const norn = (...parts: (string | false | null | undefined)[]) => ["norn", ...parts.filter((p): p is string => !!p)].join(" ");

/**
 * Builders for every norn command printed to a person or an agent (inbox items, decide details,
 * `do_instead` hints, handoff headers, briefs, cockpit actions, next steps). B7: renaming a command
 * is a change here and in its pinned table (`packages/core/test/unit/printed-commands.test.ts`), nowhere else.
 */
export const cmd = {
  config: (key?: string) => norn("config", key ? "get" : "list", key),
  ask: () => norn("ask", `"<question>"`),
  brief: () => norn("brief"),
  doctor: (o: { json?: boolean } = {}) => norn("doctor", o.json && "--json"),
  done: (outcome: string, o: { criteria?: boolean } = {}) => norn("done", outcome, o.criteria && "--criteria <file>", `--handoff "…"`),
  help: () => norn("help"),
  init: () => norn("init"),
  upgrade: () => norn("upgrade"),
  status: (o: { notes?: boolean; since?: string } = {}) => norn("status", o.notes && "--notes", o.since && `--history --since ${o.since}`),
  statusWatch: (o: { interval?: string } = {}) => norn("status --watch", o.interval && `--interval ${o.interval}`),
  storyAnswer: (unit: string, text = "…") => norn("story answer", unit, `"${text}"`),
  storyApprove: (unit: string) => norn("story approve", unit),
  storyReject: (unit: string) => norn("story reject", unit, `--reason "…"`),
  storyUpdateBranch: (story?: string) => norn("story update-branch", story),
  storyChat: (story?: string) => norn("story chat", story),
  storyEdit: (unit: string, o: { mode?: "auto" | "manual"; workflow?: string; at?: string; force?: boolean } = {}) =>
    norn("story edit", unit, o.mode && `--${o.mode}`, o.workflow && `--workflow ${o.workflow}`, o.force && "--force", o.at && `--at ${o.at}`),
  storyStart: (unit?: string, o: { print?: boolean } = {}) => norn("story start", unit, o.print && "--print"),
  storyView: (target?: string, o: { web?: boolean } = {}) => norn("story view", target, o.web && "--web"),
  storyWait: (unit: string, until: string, o: { timeout?: string } = {}) => norn("story wait", unit, `--until ${until}`, o.timeout && `--timeout ${o.timeout}`),
  stuck: (reason = "<reason>") => norn("stuck", `"${reason}"`),
  storyCreate: (o: { title?: string; workflow?: string } = {}) => norn("story create", `--title "${o.title ?? "…"}"`, o.workflow && `--workflow ${o.workflow}`),
  storyTake: (story: string) => norn("story take", story),
  storyCheckout: (story: string, o: { force?: boolean } = {}) => norn("story checkout", story, o.force && "--force"),
  storyClose: (story?: string, o: { yes?: boolean } = {}) => norn("story close", story, o.yes && "--yes"),
  storyHandoff: (story?: string) => norn("story handoff", story),
  storyReopen: (story?: string) => norn("story reopen", story),
  storyReset: (story?: string, o: { yes?: boolean; force?: boolean } = {}) => norn("story reset", story, o.yes && "--yes", o.force && "--force"),
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

/** gh-61 B20 (D11): what a session started on drifted skills is told; B19's inbox item names the same fix. */
export const skillsDriftHint = {
  text: (running: string, names: readonly string[]) => `skills differ from norn ${running}: ${names.join(", ")}`,
  fix: (story: string) => `bring the base in with \`${cmd.storyUpdateBranch(story)}\``,
  /** B19: the Unblock item of a unit decide holds (D6) */
  held: (running: string, names: readonly string[], story: string) => `skills differ from norn ${running} (${names.join(", ")}): ${skillsDriftHint.fix(story)}`,
  /** B19: the repo-level item when the main checkout itself drifted */
  repo: (running: string) => `skills differ from norn ${running}: run \`${cmd.upgrade()}\` and commit`,
};

/**
 * gh-195 D16 (B29, B35): what `norn status` and `norn doctor` say while the base's tree still holds
 * run state an older norn left there (never read: only archive refs are), with the stories it is for.
 */
export const baseRunStateHint = {
  text: (base: string, stories: readonly string[]) =>
    `run state is still on ${base} for ${stories.length === 1 ? stories[0] : `${stories.length} stories`}: norn no longer reads it there — run \`${cmd.upgrade()}\` to move it into archive refs and commit the removal`,
  fix: () => `run \`${cmd.upgrade()}\` and commit the removal it stages`,
};

/** B5: the top-level commands this release removed; no printed command names one (B7). */
export const REMOVED_COMMANDS = ["drop", "inbox", "cockpit", "orient", "open", "answer", "approve", "unstick", "update", "mode", "workflow", "take", "release", "trace", "why"] as const;

const REMOVED = new RegExp(`\\bnorn (${REMOVED_COMMANDS.join("|")})(?![\\w-])`);

/** B7: the first removed command (`norn <old>`) a printed text names, or null. */
export function nameRemoved(text: string): string | null {
  const m = REMOVED.exec(text);
  return m ? `norn ${m[1]}` : null;
}

/**
 * gh-61 D3 (B6, B7, B8): what a running binary that does not fit the repo's recorded `X.Y.Z` is told —
 * the refusal's `error` and `do_instead`, and the inbox item. A dev or pre-release build
 * (`0.19.0-dev.3`) is compared by its core. The versions that fit `repo` are its line (`0.19.x` before
 * 1.0, `1.x` from 1.0 on), from `repo` itself up (B2). Null when it fits, or `running` has no `X.Y.Z`.
 */
export function versionMismatch(repo: string, running: string): { match: "older" | "newer"; needs: string; error: string; do_instead: string } | null {
  const core = /^\d+\.\d+\.\d+/.exec(running)?.[0];
  if (!core) return null;
  const match = versionMatch(repo, core);
  if (match === "match") return null;
  const [maj, min, pat] = repo.split(".");
  const line = maj === "0" ? `0.${min}.x` : `${maj}.x`;
  const base = maj === "0" ? pat === "0" : min === "0" && pat === "0";
  const fits = base ? line : `${repo} or a later ${line}`;
  const install = `install norn ${fits}`;
  // B7: a newer binary moves the repo forward with a commit, not a downgrade
  const do_instead = match === "newer" ? `run \`${cmd.upgrade()}\` to move this repo to norn ${running} and commit the change, or ${install}` : install;
  return { match, needs: fits, error: `this repo needs norn ${fits} (you run ${running})`, do_instead };
}

/** gh-61 B17 (D9): `norn upgrade` run by a binary older than the repo's version; no flag overrides it. */
export function upgradeBackward(repo: string, running: string): { error: string; do_instead: string } {
  return { error: `this repo is set up for norn ${repo}; upgrade will not move it back`, do_instead: versionMismatch(repo, running)?.do_instead ?? `install norn ${repo}` };
}

/** gh-61 B11 (D8): the one notification `norn watch` sends when it pauses ticks on a mismatch. */
export const ticksPausedTitle = (needs: string): string => `this repo needs norn ${needs}; ticks paused`;

/** gh-61 B5: the hint when the team file records no `norn_version` (`doctor`, `status`). */
export const NO_VERSION_HINT = `no norn version recorded: run \`${cmd.upgrade()}\``;
