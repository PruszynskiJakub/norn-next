/**
 * `norn tidy [--dry-run]`: remove the worktrees and local branches of stories whose every unit ended
 * and that no live claim holds, which no tick removes (a stuck unit keeps its worktree for a person to
 * look into), and close what their runs left open on this machine (a herdr pane per run). Whatever holds unique work is kept and listed with the reason. Under this machine's tick
 * lock, so no tick makes a worktree again while it goes.
 */
import { acquireTickLock, newTickId, tidy } from "@norn/runtime";
import { defineCommand, opt } from "../command.ts";
import { busyError, failure, rendered } from "../output.ts";
import { syncStore } from "./person-support.ts";

export const tidyCommand = defineCommand({
  name: "tidy",
  acts: true,
  personOnly: true,
  summary: "Remove the worktrees and local branches of ended stories that no live claim holds, and close their runs' panes",
  usage: "norn tidy [--dry-run]",
  options: { "dry-run": { type: "boolean" } },
  optionHelp: { "--dry-run": "list what would be removed and change nothing" },
  async run(ctx, args) {
    const dryRun = opt.bool(args, "dry-run");
    const env = await ctx.runtimeEnv();
    await syncStore(env, "the store", "norn tidy");
    const lock = await acquireTickLock(env.ctx, newTickId(env.ctx.now()), env.config.lockStaleMs);
    if (!lock) throw busyError("a tick is running in this repo", "norn tidy again once it ends", "tick_running");
    let report: Awaited<ReturnType<typeof tidy>>;
    try {
      report = await tidy(env, { dryRun });
    } finally {
      await lock.release();
    }
    if (!report.ok) throw failure(`tidy stopped: ${report.failure.message}`, "norn tidy again", report.failure.code);
    const { removed, kept, closed } = report.value;
    const verb = dryRun ? "Would remove" : "Removed";
    const lines = removed.map((r) => `- ${r.unit}: ${[r.worktree ? "worktree" : "", r.branch ? `branch ${r.branch}` : ""].filter(Boolean).join(" and ")}`);
    const closedLines = closed.map((c) => `- ${c.unit}: what ${c.runs} run${c.runs === 1 ? "" : "s"} left open (a pane each)`);
    const keptLines = kept.map((k) => `- ${k.unit ?? k.story}: ${k.reason}`);
    const md = [
      removed.length ? `${verb}:\n\n${lines.join("\n")}` : closed.length ? "" : `Nothing to ${dryRun ? "remove" : "tidy"}.`,
      ...(closedLines.length ? [`Closed:\n\n${closedLines.join("\n")}`] : []),
      ...(keptLines.length ? [`Kept:\n\n${keptLines.join("\n")}`] : []),
    ]
      .filter(Boolean)
      .join("\n\n");
    return rendered(report.value, md);
  },
});
