/**
 * `norn workflow <unit> <name> [--to <step>]` (W9, S7). Before the unit starts: set `workflow:`
 * in its story/slice frontmatter. After start: only with `--to`; journals a `workflow` receipt
 * (from/to hash) and re-pins `runs/<unit>/workflow.yaml` to the new workflow, which the next tick
 * applies by entering `--to`. Runs under the tick lock so no tick sees the pin without its receipt.
 */
import { join } from "node:path";
import { cmd, checkWorkflowLevel, sha256, stepOf } from "@norn/core";
import { acquireTickLock, patchSliceFile, patchStoryFile, pinWorkflow, storyFile } from "@norn/store";
import { defineCommand, opt } from "../command.ts";
import { busyError, claimHeld, failure, refuse } from "../output.ts";
import { parseUnitKey } from "../runtime/args.ts";
import { humanReceipt, resolveTarget, runHumanVerb } from "../runtime/human.ts";

export const workflowCommand = defineCommand({
  name: "workflow",
  summary: "Choose a unit's workflow before start, or switch it with --to after start (W9, S7)",
  usage: "norn workflow <unit> <name> [--to <step>]",
  options: { to: { type: "string" } },
  positionals: { min: 2, max: 2 },
  async run(ctx, args) {
    const [raw, name] = args.positionals as [string, string];
    const to = opt.str(args, "to");
    const key = parseUnitKey(raw);
    const lock = await acquireTickLock(ctx.root, { note: "norn workflow", now: () => ctx.clock.iso() });
    if (!lock.ok) throw busyError("a tick is running", "retry when it finishes", "tick_locked");
    try {
      const t = await resolveTarget(ctx, key.key);
      const obs = t.obs;
      const sf = t.story_facts;
      if (!obs || !sf) throw refuse(`${t.story} is not in this checkout`, cmd.storyCheckout(t.story), "story_not_local");
      const listed = Object.keys(obs.workflows).sort();
      const loaded = obs.workflows[name];
      if (!loaded) throw refuse(`no workflow '${name}' in .agents/norn/workflows/`, cmd.workflow(t.key, `<${listed.join("|")}>`), "unknown_workflow");
      const level = t.slice ? "slice" : "story";
      const issues = loaded.workflow ? [...loaded.issues, ...checkWorkflowLevel(loaded.workflow, level)] : loaded.issues;
      if (!loaded.workflow || issues.length)
        throw refuse(`workflow '${name}' cannot run on a ${level}: ${issues.map((i) => i.message).join("; ") || "invalid"}`, "fix the workflow file (W5, W8)", "invalid_workflow", issues);
      const wf = loaded.workflow;
      const loc = obs.stories[t.story];
      const sliceFile = t.slice ? sf.slices.find((s) => s.key === t.slice) : null;
      const fmPath = loc ? (sliceFile ? join(loc.root, sliceFile.file) : storyFile(loc.specPath)) : null;
      const patchFm = () => {
        if (!fmPath || !loc) return null;
        const r = t.slice ? patchSliceFile(fmPath, { workflow: name }, loc.root) : patchStoryFile(fmPath, { workflow: name }, loc.root);
        if (!r.ok) throw failure(`cannot update ${fmPath}: ${r.reason}`, `fix ${fmPath}`, "frontmatter");
        return fmPath.startsWith(`${ctx.root}/`) ? fmPath.slice(ctx.root.length + 1) : fmPath;
      };

      if (!t.state) {
        // W9: before start the choice lives in frontmatter
        if (to !== undefined) throw refuse(`${t.key} has not started; --to applies only to a running unit (S7)`, cmd.workflow(t.key, name), "not_started");
        if (sf.claim.state === "other") throw claimHeld(sf.claim.blob, `ask ${sf.claim.blob.holder} to run it, or ${cmd.storyCheckout(t.story, { force: true })}`);
        if (t.slice ? !sliceFile?.frontmatter : !sf.frontmatter) throw refuse(`${t.key}'s frontmatter is missing or invalid`, cmd.status(t.story), "frontmatter");
        const previous = t.slice ? (sliceFile?.frontmatter?.workflow ?? null) : (sf.frontmatter?.workflow ?? null);
        const file = previous === name ? null : patchFm();
        return { unit: t.key, workflow: name, previous, started: false, changed: previous !== name, file };
      }

      const steps = Object.keys(wf.steps);
      const toHash = sha256(loaded.source);
      const out = await runHumanVerb(ctx, t, {
        verb: "workflow",
        mailbox: false,
        // as before: a second switch before the tick is written, not refused as a duplicate (S6)
        refuseDuplicate: false,
        check(t, st) {
          if (st.status === "done") throw refuse(`${t.key} is done`, cmd.status(t.story), "unit_done");
          if (to === undefined)
            throw refuse(`${t.key} already runs workflow ${st.workflow}; switching a started unit needs --to <step> (S7)`, cmd.workflow(t.key, name, { to: `<${steps.join("|")}>` }), "needs_to");
          if (!stepOf(wf, to)) throw refuse(`no step '${to}' in workflow ${name}`, cmd.workflow(t.key, name, { to: `<${steps.join("|")}>` }), "unknown_step");
        },
        // P6: the journal entry first, then the re-pin; state.json moves on the next tick (S5)
        build: (t, st) => humanReceipt(ctx, t, st, "workflow", { name, from_hash: st.workflow_hash, to_hash: toHash, to: to as string }),
      });
      pinWorkflow(t.runsDir as string, loaded.source, { replace: true });
      const file = patchFm();
      return { unit: t.key, workflow: name, previous: t.state.workflow, started: true, to, receipt: out.receipt, delivered: out.delivered, file, next: out.next };
    } finally {
      lock.release();
    }
  },
});
