/** act: git steps — integrate, update, push, open-pr (W2, K6, BS3, GR9). */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { type Action, type ActionResult, applyReceipts, nornTrailers, routeOf } from "@norn/core";
import { type ReceiptOf, ulid } from "@norn/schema";
import { acquireIntegrateLock, appendReceipt, machineDir, readText } from "@norn/store";
import { integrate, update as updateStory } from "../integrate.ts";
import { type ActEnv, QueueFull } from "./env.ts";

/** GR9: the agent's PR body file, if written, with the issue link under it; otherwise the link alone. */
function prBody(cwd: string, pr: NonNullable<Extract<Action, { kind: "run_git" }>["pr"]>): string {
  const path = pr.body_file ? join(cwd, pr.body_file) : null;
  const text = path ? (readText(path) ?? "").trim() : "";
  return text ? `${text}\n\n---\n\n${pr.body}` : pr.body;
}

/** W2 git steps (K6, open-pr, BS3 update); the outcome is a `classify` receipt written after the effect. */
export async function runGit(act: ActEnv, a: Extract<Action, { kind: "run_git" }>): Promise<ActionResult> {
  if (a.action !== "integrate" && a.action !== "update") return runGitLocked(act, a);
  // K6/BS3: slice integrations and base updates of one story never interleave, across processes too
  mkdirSync(machineDir(act.root), { recursive: true });
  const lock = await acquireIntegrateLock(act.root, a.unit.story, { now: () => act.nowIso(), note: `${a.unit.key} ${a.action}` });
  if (!lock.ok) throw new QueueFull(`integrate lock of ${a.unit.story} is held (pid ${lock.holder.holder.pid}); retried next tick (K6)`);
  try {
    return await runGitLocked(act, a);
  } finally {
    lock.release();
  }
}

/** BS3: push the updated story branch; a refused push is a failed effect (R4.3), the receipt still stands. */
async function pushUpdated(act: ActEnv, cwd: string, branch: string): Promise<{ ok: true } | { ok: false; message: string }> {
  const r = await act.pushBranch(cwd, branch);
  if (r.ok) act.effectsOk.add("push");
  else act.effectErrors.push({ effect: "push", reason: `push of ${branch} failed: ${r.message}` });
  return r;
}

async function runGitLocked(act: ActEnv, a: Extract<Action, { kind: "run_git" }>): Promise<ActionResult> {
  const loc = act.unitLoc(a.unit);
  const st = loc.state;
  const wf = loc.workflow;
  if (!st || !wf) throw new Error(`${a.unit.key} has no state or pinned workflow`);
  let outcome: "done" | "conflict" | "stuck";
  let detail: string;
  let base: ReceiptOf<"classify">["base"];
  const extra: Record<string, unknown> = {};
  switch (a.action) {
    case "update": {
      const u = a.update;
      if (!u) throw new Error("update without a base");
      const res = await updateStory(act.git, { cwd: a.cwd, branch: a.branch, baseSha: u.sha, remote: act.obs.remote, message: u.message, trailers: u.trailers });
      if (res.outcome === "stuck") {
        // BS3 step 1/3: dirty worktree, diverged story branch → $stuck with the reason
        outcome = "stuck";
        detail = res.reason;
        break;
      }
      if (res.adopted) extra.adopted = res.adopted;
      if (res.outcome === "conflict") {
        // BS3 step 6: the merge was aborted; the resolve step gets the base sha and the paths
        outcome = "conflict";
        base = { ref: u.ref, sha: u.sha, conflicts: res.files };
        detail = `merging ${u.branch} (${u.sha.slice(0, 12)}) into ${a.branch} conflicts in ${res.files.join(", ") || "?"}`;
        // an adopted fast-forward is still the record: publish it (S8)
        if (res.adopted) extra.story_push = await pushUpdated(act, a.cwd, a.branch);
        break;
      }
      outcome = "done";
      // BS3: the merge commit (or the head found up to date) goes into the record, for status and why
      base = { ref: u.ref, sha: u.sha, conflicts: [], head: res.head, merged: res.merged };
      detail = res.merged ? `merged ${u.branch} (${u.sha.slice(0, 12)}) into ${a.branch} at ${res.head.slice(0, 12)}` : `${a.branch} is up to date with ${u.branch} (${u.sha.slice(0, 12)})`;
      // BS3 step 5: pushed at the step boundary (S8, T7), as integrate does
      if (res.merged || res.adopted) extra.story_push = await pushUpdated(act, a.cwd, a.branch);
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
        extra.story_push = await act.pushBranch(a.cwd, a.onto);
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
      const pushed = await act.pushBranch(a.cwd, a.branch);
      if (!pushed.ok) throw new Error(`push failed: ${pushed.message}`);
      const body = prBody(a.cwd, a.pr);
      let pr = await remote.findPullRequest(a.branch);
      if (pr && pr.state === "open") {
        // GR9: the open PR describes the branch as it is now
        await remote.editPullRequestBody(pr.number, body);
        detail = `PR #${pr.number} body updated ${pr.url}`;
      } else {
        pr = await remote.openDraftPullRequest({ head: a.branch, base: a.pr.base, title: a.pr.title, body });
        detail = `draft PR #${pr.number} ${pr.url}`;
      }
      outcome = "done";
      extra.pr = pr;
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
  };
  // §10, W4: the route is where applying this receipt sends the unit — an exhausted counter
  // (e.g. integrate.conflict past conflict_loop's max) records `$stuck`, not the edge's target.
  // A receipt apply would refuse moves nothing; it keeps `$stuck`.
  const applied = applyReceipts(st, [{ n: st.applied_through + 1, file: "", receipt }], { workflow: wf, now: receipt.at, limits: act.config.limits, tick_id: act.tick });
  receipt.route = routeOf(applied) ?? "$stuck";
  const written = appendReceipt(loc.runsDir, receipt);
  return { ok: true, detail: { outcome, detail, receipt: written.n, ...extra } };
}
