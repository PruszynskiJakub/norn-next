/** act: git steps — integrate, update, push, open-pr. */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { type Action, type ActionResult, applyReceipts, LIGHT_OUTCOMES, lightAnchor, nornTrailers, type RemotePort, routeOf, type UpdateHistory, type UpdateMerge, type UpdateOutcome, updateOutcome } from "@norn/core";
import { type ReceiptOf, recordRef, ulid, type Workflow } from "@norn/schema";
import { acquireIntegrateLock, appendReceipt, listReceipts, machineDir, pushRecord, readPrFacts, readRecordRef, readText, writePrFacts } from "@norn/store";
import { integrate, type UpdateRegenerate, update as updateStory } from "../integrate.ts";
import { runShell, tailLines } from "../shell.ts";
import type { PushBranchResult } from "../push.ts";
import { type ActEnv, QueueFull } from "./env.ts";
import { recordLinkResolver, rewriteRecordLinks } from "./record-links.ts";

/** The agent's PR body file, if written, with the issue link under it; otherwise the link alone. */
function prBody(text: string, pr: NonNullable<Extract<Action, { kind: "run_git" }>["pr"]>): string {
  return text ? `${text}\n\n---\n\n${pr.body}` : pr.body;
}

/** The agent's PR body file as written, trimmed; "" when there is none. */
function prText(cwd: string, pr: NonNullable<Extract<Action, { kind: "run_git" }>["pr"]>): string {
  return pr.body_file ? (readText(join(cwd, pr.body_file)) ?? "").trim() : "";
}

/**
 * Before the PR is opened or updated, push the story's record to its ref (under
 * `local` too) with a lease on the sha this checkout last saw, its `Norn-Branch-Commit` the branch just
 * pushed; a refused push fails the git step (retried as git steps are), so no PR call is made. Then
 * rewrite `text`'s record links to the files' URLs at that record commit.
 */
async function linkRecord(act: ActEnv, a: Extract<Action, { kind: "run_git" }>, text: string, remote: RemotePort): Promise<{ text: string; record: string | null; missing: string[] }> {
  const story = act.storyLoc(a.unit.story);
  const expected = (await readRecordRef(act.root, story.key))?.sha ?? null;
  const branch_commit = await act.git.revParse(act.root, `refs/heads/${a.branch}`);
  const r = await pushRecord(act.root, act.obs.remote, story, { expected, holder: act.obs.facts.machine.holder, branch_commit, at: act.nowIso() });
  if (!r.ok) throw new Error(`push of ${recordRef(story.key)} failed (${r.reason}), so no PR was opened or updated: ${r.message}`);
  // an empty record (no run state yet) holds no file to link to
  const record = r.sha;
  const resolve = record === null ? () => null : recordLinkResolver(act.root, story);
  const out = await rewriteRecordLinks(text, resolve, (path) => remote.rawFileUrl({ commit: record as string, path }));
  return { text: out.text, record, missing: out.missing };
}

/** Git steps (integrate, push, open-pr, update); the outcome is a `classify` receipt written after the effect. */
export async function runGit(act: ActEnv, a: Extract<Action, { kind: "run_git" }>): Promise<ActionResult> {
  if (a.action !== "integrate" && a.action !== "update") return runGitLocked(act, a);
  // Slice integrations and base updates of one story never interleave, across processes too
  mkdirSync(machineDir(act.root), { recursive: true });
  const lock = await acquireIntegrateLock(act.root, a.unit.story, { now: () => act.nowIso(), note: `${a.unit.key} ${a.action}` });
  if (!lock.ok) throw new QueueFull(`integrate lock of ${a.unit.story} is held (pid ${lock.holder.holder.pid}); retried next tick`);
  try {
    return await runGitLocked(act, a);
  } finally {
    lock.release();
  }
}

/** Push the updated story branch; a refused push is a failed effect, the receipt still stands. */
async function pushUpdated(act: ActEnv, cwd: string, branch: string, heads: boolean): Promise<PushBranchResult> {
  const r = await act.pushBranch(cwd, branch, {}, heads);
  if (r.ok) act.effectsOk.add("push");
  else act.effectErrors.push({ effect: "push", reason: `push of ${branch} failed: ${r.message}` });
  return r;
}

/**
 * The story's first-parent commits from the head at the round's latest `approve` to `head`, with
 * what the light path needs of each merge; null when there is no approval to measure from or its
 * head is not under the branch (rewritten, or unknown here), which takes the full path.
 */
async function updateHistory(act: ActEnv, cwd: string, runsDir: string, wf: Workflow, specDir: string, baseSha: string, head: string): Promise<UpdateHistory | null> {
  const anchor = lightAnchor(listReceipts(runsDir).receipts, wf);
  if (!anchor || !(await act.git.isAncestor(cwd, anchor, head).catch(() => false))) return null;
  const commits: UpdateHistory["commits"] = [];
  for (const c of await act.git.commitPaths(cwd, head, anchor)) {
    if (c.parents.length < 2) {
      commits.push(c);
      continue;
    }
    const fromBase = await Promise.all(c.parents.slice(1).map((p) => act.git.isAncestor(cwd, p, baseSha).catch(() => false)));
    commits.push({ ...c, from_base: fromBase.every(Boolean), remerge: await act.git.remergeDiff(cwd, c.sha) });
  }
  return { anchor, spec_dir: specDir, commits };
}

/** Regenerate commands run at the story worktree's root with the checkout's env; how each ended is the last line of its output. */
function regenerateOpts(act: ActEnv, cwd: string, specDir: string): UpdateRegenerate {
  return {
    specDir,
    entries: act.config.regenerate ?? [],
    async run(command, timeoutMs) {
      const r = await runShell(command, { cwd, env: { ...process.env, ...act.ctx.env }, timeoutMs });
      const end = r.timed_out ? `(timed out after ${timeoutMs / 1000}s)` : r.exit_code === 0 ? "" : `(exit ${r.exit_code})`;
      return { ok: !r.timed_out && r.exit_code === 0, output: [tailLines(r.output, 100), end].filter(Boolean).join("\n") };
    },
  };
}

async function runGitLocked(act: ActEnv, a: Extract<Action, { kind: "run_git" }>): Promise<ActionResult> {
  const loc = act.unitLoc(a.unit);
  const st = loc.state;
  const wf = loc.workflow;
  if (!st || !wf) throw new Error(`${a.unit.key} has no state or pinned workflow`);
  let outcome: UpdateOutcome | "stuck";
  let history: UpdateHistory | null = null;
  let detail: string;
  let base: ReceiptOf<"classify">["base"];
  const extra: Record<string, unknown> = {};
  switch (a.action) {
    case "update": {
      const u = a.update;
      if (!u) throw new Error("update without a base");
      const specDir = act.storyLoc(a.unit.story).spec_dir;
      const res = await updateStory(act.git, { cwd: a.cwd, branch: a.branch, baseSha: u.sha, remote: act.obs.remote, message: u.message, trailers: u.trailers, regenerate: regenerateOpts(act, a.cwd, specDir) });
      if (res.outcome === "stuck") {
        // dirty worktree, diverged story branch → $stuck with the reason
        outcome = "stuck";
        detail = res.reason;
        break;
      }
      if (res.adopted) extra.adopted = res.adopted;
      const merge: UpdateMerge = res.outcome === "conflict" ? { outcome: "conflict", files: res.files } : { outcome: res.merged ? "merged" : "up_to_date" };
      // the light path is measured only where the step routes it: other workflows update as before
      const routed = Object.keys(wf.steps[a.step]?.outcomes ?? {});
      history = res.outcome === "done" && LIGHT_OUTCOMES.some((o) => routed.includes(o)) ? await updateHistory(act, a.cwd, loc.runsDir, wf, specDir, u.sha, res.head) : null;
      // core chooses the outcome; below only records what the merge did
      outcome = updateOutcome({ merge, history, ...(act.config.regenerate ? { regenerate: act.config.regenerate } : {}) }, routed);
      if (res.outcome === "conflict") {
        // the merge was aborted; the resolve step gets the base sha and the paths
        base = { ref: u.ref, sha: u.sha, conflicts: res.files, ...(res.regenerate ? { regenerate: res.regenerate } : {}) };
        detail = `merging ${u.branch} (${u.sha.slice(0, 12)}) into ${a.branch} conflicts in ${res.files.join(", ") || "?"}${res.regenerate ? "; regenerating them did not finish the merge" : ""}`;
        // an adopted fast-forward is still the record: publish it
        if (res.adopted) extra.story_push = await pushUpdated(act, a.cwd, a.branch, a.heads === true);
        break;
      }
      // The merge commit (or the head found up to date) goes into the record, for status and why
      const taken = res.regenerated ?? res.base_side;
      base = { ref: u.ref, sha: u.sha, conflicts: [], head: res.head, merged: res.merged, ...(taken ? { regenerated: taken } : {}) };
      detail = res.merged ? `merged ${u.branch} (${u.sha.slice(0, 12)}) into ${a.branch} at ${res.head.slice(0, 12)}` : `${a.branch} is up to date with ${u.branch} (${u.sha.slice(0, 12)})`;
      if (res.regenerated) detail += `; regenerated ${res.regenerated.join(", ")} (base side, then the team's regenerate commands)`;
      if (res.base_side) detail += `; took the base side of ${res.base_side.join(", ")} (the branch holds only its spec folder)`;
      // pushed at the step boundary, as integrate does
      if (res.merged || res.adopted) extra.story_push = await pushUpdated(act, a.cwd, a.branch, a.heads === true);
      break;
    }
    case "integrate": {
      if (!a.onto) throw new Error("integrate without a story branch");
      const res = await integrate(act.git, { sliceCwd: a.cwd, storyBranch: a.onto, trailers: nornTrailers(act.tick, a.unit.story, a.unit.slice, a.step) });
      if (res.outcome === "conflict") {
        outcome = "conflict";
        detail = `rebase onto ${a.onto} conflicts in ${res.files.join(", ") || "?"}`;
      } else {
        outcome = "done";
        detail = `${a.branch} integrated into ${a.onto} at ${res.head.slice(0, 12)}`;
        extra.story_push = await act.pushBranch(a.cwd, a.onto, {}, a.heads === true);
      }
      break;
    }
    case "push": {
      const r = await act.pushBranch(a.cwd, a.branch);
      if (!r.ok) throw new Error(`push failed: ${r.message}`);
      outcome = "done";
      detail = act.obs.remote ? `pushed ${a.branch}` : `no git remote; nothing to push`;
      break;
    }
    case "open-pr": {
      const remote = act.obs.ports.remote;
      if (!remote) throw new Error("no remote provider configured");
      if (!a.pr) throw new Error("open-pr without PR details");
      let pr = await remote.findPullRequest(a.branch);
      // The story's work already landed: a second PR for it would deliver it twice; the next sync ends the story through the merge path
      if (pr?.state === "merged") throw new Error(`PR #${pr.number} of ${a.branch} is already merged; no new PR opened, the next sync ends the story`);
      const pushed = await act.pushBranch(a.cwd, a.branch);
      if (!pushed.ok) throw new Error(`push failed: ${pushed.message}`);
      const linked = await linkRecord(act, a, prText(a.cwd, a.pr), remote);
      const body = prBody(linked.text, a.pr);
      if (pr && pr.state === "open") {
        // The open PR describes the branch as it is now
        await remote.editPullRequestBody(pr.number, body);
        detail = `PR #${pr.number} body updated ${pr.url}`;
      } else {
        pr = await remote.openDraftPullRequest({ head: a.branch, base: a.pr.base, title: a.pr.title, body });
        detail = `draft PR #${pr.number} ${pr.url}`;
      }
      // A link to a file the record does not hold is left as written, and named here
      if (linked.missing.length) detail += `; left as written, not in the record ${linked.record?.slice(0, 12) ?? "(empty)"}: ${linked.missing.join(", ")}`;
      outcome = "done";
      extra.pr = pr;
      extra.record = linked.record;
      if (linked.missing.length) extra.unlinked = linked.missing;
      // The PR open-pr opened (or found) is what this checkout last saw of it, so the
      // finished round shows its merge item before a sync fetches the PR (never "round done, no PR")
      writePrFacts(act.root, { ...readPrFacts(act.root), [a.unit.story]: { pr, observed_at: act.ctx.clock.now() } });
      break;
    }
  }
  const receipt: ReceiptOf<"classify"> = {
    kind: "classify",
    receipt_id: ulid(act.ctx.clock.now()),
    run_id: a.run_id,
    step: a.step,
    attempt: st.attempt,
    at: act.nowIso(),
    by: "norn",
    who: act.obs.facts.machine.holder,
    tick_id: act.tick,
    outcome,
    rule: a.rule,
    detail,
    route: "$stuck", // set below from the in-memory apply
    ...(base ? { base } : {}),
    ...(history ? { history } : {}),
  };
  // The route is where applying this receipt sends the unit — an exhausted counter
  // (e.g. integrate.conflict past conflict_loop's max) records `$stuck`, not the edge's target.
  // A receipt apply would refuse moves nothing; it keeps `$stuck`.
  const applied = applyReceipts(st, [{ n: st.applied_through + 1, file: "", receipt }], { workflow: wf, now: receipt.at, tick_id: act.tick });
  receipt.route = routeOf(applied) ?? "$stuck";
  const written = appendReceipt(loc.runsDir, receipt);
  return { ok: true, detail: { outcome, detail, receipt: written.n, ...extra } };
}
