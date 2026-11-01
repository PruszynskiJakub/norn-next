/**
 * `norn story edit [<unit>] --auto|--manual | --workflow <name> [--at <step>]`.
 *
 * `--auto|--manual` (B30, §6, MO1): switch who starts unattended agent steps. Writes a `mode`
 * receipt on the story unit; the next tick stores it in `runs/_story/state.json`. A running agent is
 * not stopped (MO3). Needs the claim here (T8); mode never goes through the mailbox. Mode is per
 * story: a slice target, or a slice worktree, means its story (B55).
 *
 * `--workflow <name> [--at <step>] [--force]` (B31, B32, W9, S7). Before the unit starts: set `workflow:` in its
 * story/slice frontmatter. A started slice: only with `--at`; journals a `workflow` receipt (from/to
 * hash) and re-pins its `workflow.yaml` to the new workflow, which the next tick applies by entering
 * `--at`. A started story (gh-71 D1, D3, D4): starts a new round — refused while the claim is held
 * elsewhere, for an unknown workflow or step, or while the round is unfinished without `--force` (with it:
 * while an agent runs a step of the round or a slice is unfinished); otherwise writes only a `round`
 * receipt into the current round, which the next tick applies (`round.start`). Runs under the tick lock
 * so no tick sees a pin without its receipt.
 *
 * `--at <step>` alone (gh-71 B15, B16, D4, RD4): move the cursor of the current, unfinished round to a step
 * of its own pinned workflow, journaled as a `workflow` receipt with the same workflow and hash; counters
 * are kept. A finished round is refused: a new one starts with `--workflow`.
 */
import { join } from "node:path";
import { cmd, checkWorkflowLevel, roundFinished, sha256, stepOf, type StoryFacts } from "@norn/core";
import type { Mode, UnitState } from "@norn/schema";
import { acquireTickLock, patchSliceFile, patchStoryFile, pinWorkflow, storyFile, WORKFLOWS_DIR } from "@norn/store";
import { defineCommand, opt } from "../command.ts";
import type { Context } from "../context.ts";
import { busyError, claimHeld, failure, refuse, usageError } from "../output.ts";
import { parseUnitKey } from "../runtime/args.ts";
import { humanReceipt, refuseIfHeldElsewhere, resolveTarget, runHumanVerb } from "../runtime/human.ts";
import { targetKey, type TargetRule } from "../runtime/target.ts";

const USAGE = "norn story edit [<story|slice>] --auto|--manual | --workflow <name> [--at <step>] [--force] | --at <step>";

/** The units an edit applies to: not finished; a mode edit only the story units. */
const editable = (verb: "mode" | "workflow"): TargetRule => ({
  verb: "story edit",
  command: (key) => (verb === "mode" ? cmd.storyEdit(key, { mode: "auto" }) : cmd.storyEdit(key, { workflow: "<name>" })),
  none: "No story is open to edit",
  applies(_key, u) {
    // gh-71 B6: a story whose round is finished takes --workflow (a new round)
    if (verb === "mode") return !!u && u.status !== "done" && u.slice === null;
    return !!u && (u.status !== "done" || u.slice === null);
  },
});

async function editMode(ctx: Context, raw: string, mode: Mode) {
  // B55: mode is per story (MO1) — a slice means its story
  const t = await resolveTarget(ctx, parseUnitKey(raw).story);
  // T9: refused before anything (even a no-op) is computed from a possibly stale local copy
  const claim = await refuseIfHeldElsewhere(ctx, t.story, "story edit");
  let current: Mode = ctx.config.default_mode;
  const out = await runHumanVerb(ctx, t, {
    verb: "story edit",
    mailbox: false,
    claim,
    // MO1: every mode receipt applies, the last one wins — a second switch is no duplicate
    refuseDuplicate: false,
    check(t, st) {
      if (st.status === "done") throw refuse(`${t.key} is done`, cmd.storyView(t.story), "unit_done");
    },
    noop(t, st) {
      const previous: Mode = st.mode ?? ctx.config.default_mode;
      // a pending, not yet applied mode receipt wins over state.json
      const uf = t.story_facts?.units.find((u) => u.unit.key === t.key);
      const pending = uf?.unapplied.filter((r) => r.receipt.kind === "mode").at(-1)?.receipt;
      current = pending?.kind === "mode" ? pending.mode : previous;
      return current === mode;
    },
    build: (t, st) => humanReceipt(ctx, t, st, "mode", { mode, previous: current }),
  });
  if (!out) return { unit: t.key, mode, changed: false };
  return { unit: out.unit, mode, previous: current, changed: true, receipt: out.receipt, delivered: out.delivered, next: out.next };
}

/**
 * gh-71 D3 (B12, B13, RD3): what `--force` may not end — an agent running a step of the round (it would
 * keep writing to the branch), or a slice of the story that is not integrated or dropped.
 */
function refuseWhileWorking(story: StoryFacts, st: UnitState): void {
  if (st.status === "running" && st.run)
    throw refuse(`an agent is running ${st.step} of ${st.story}'s ${st.workflow} round; stop it first`, cmd.runCancel(st.story), "agent_running");
  const open = story.slices.find((s) => s.frontmatter?.status !== "integrated" && s.frontmatter?.status !== "dropped");
  if (open) throw refuse(`slice ${open.key} is not finished; finish or drop it first`, cmd.storyView(open.key), "slice_unfinished");
}

async function editWorkflow(ctx: Context, raw: string, name: string, at: string | undefined, force: boolean) {
  const key = parseUnitKey(raw);
  const lock = await acquireTickLock(ctx.root, { note: "norn story edit --workflow", now: () => ctx.clock.iso() });
  if (!lock.ok) throw busyError("a tick is running", "retry when it finishes", "tick_locked");
  try {
    const t = await resolveTarget(ctx, key.key);
    const obs = t.obs;
    const sf = t.story_facts;
    if (!obs || !sf) throw refuse(`${t.story} is not in this checkout`, cmd.storyCheckout(t.story), "story_not_local");
    // gh-71 D3 (B18): a new round is refused first while another clone holds the story's claim
    const round = !t.slice && !!t.state;
    const claim = round ? await refuseIfHeldElsewhere(ctx, t.story, "story edit") : undefined;
    const listed = Object.keys(obs.workflows).sort();
    const loaded = obs.workflows[name];
    if (!loaded) throw refuse(`no workflow '${name}' in ${WORKFLOWS_DIR}/`, cmd.storyEdit(t.key, { workflow: `<${listed.join("|")}>` }), "unknown_workflow");
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
      if (at !== undefined) throw refuse(`${t.key} has not started; --at applies only to a running unit (S7)`, cmd.storyEdit(t.key, { workflow: name }), "not_started");
      if (sf.claim.state === "other") throw claimHeld(sf.claim.blob, `ask ${sf.claim.blob.holder} to run it, or ${cmd.storyCheckout(t.story, { force: true })}`);
      if (t.slice ? !sliceFile?.frontmatter : !sf.frontmatter) throw refuse(`${t.key}'s frontmatter is missing or invalid`, cmd.storyView(t.story), "frontmatter");
      const previous = t.slice ? (sliceFile?.frontmatter?.workflow ?? null) : (sf.frontmatter?.workflow ?? null);
      const file = previous === name ? null : patchFm();
      return { unit: t.key, workflow: name, previous, started: false, changed: previous !== name, file };
    }

    const steps = `<${Object.keys(wf.steps).join("|")}>`;
    const toHash = sha256(loaded.source);
    if (round) {
      // gh-71 D3 (B9): the step the new round starts at must be one of the workflow's
      const to = at ?? wf.start;
      if (!stepOf(wf, to)) throw refuse(`no step '${to}' in workflow ${name}`, cmd.storyEdit(t.key, { workflow: name, at: steps }), "unknown_step");
      const out = await runHumanVerb(ctx, t, {
        verb: "story edit",
        mailbox: false,
        ...(claim ? { claim } : {}),
        check(t, st) {
          if (roundFinished(st)) return;
          // gh-71 D3 (B10): an unfinished round is ended only on purpose
          if (!force)
            throw refuse(`${t.story}'s ${st.workflow} round is not finished; pass --force to end it and start a ${name} round`, cmd.storyEdit(t.story, { workflow: name, force: true, ...(at ? { at } : {}) }), "round_unfinished");
          refuseWhileWorking(sf, st);
        },
        // gh-71 D1 (P6, S5): only the receipt; the next tick ends the round and starts the next one.
        // B14: `--force` on a finished round is the same edit as without it
        build: (t, st) => humanReceipt(ctx, t, st, "round", { workflow: name, workflow_hash: toHash, to, forced: !roundFinished(st), left_at: st.step }),
      });
      return { unit: t.key, workflow: name, previous: t.state.workflow, started: true, round: (t.state.round ?? 1) + 1, to, receipt: out.receipt, delivered: out.delivered, next: out.next };
    }
    const out = await runHumanVerb(ctx, t, {
      verb: "story edit",
      mailbox: false,
      // as before: a second switch before the tick is written, not refused as a duplicate (S6)
      refuseDuplicate: false,
      check(t, st) {
        if (st.status === "done") throw refuse(`${t.key} is done`, cmd.storyView(t.story), "unit_done");
        // B32, S7: the step a started unit lands on is always explicit
        if (at === undefined) throw refuse(`${t.key} already runs workflow ${st.workflow}; switching a started unit needs --at <step> (S7)`, cmd.storyEdit(t.key, { workflow: name, at: steps }), "needs_to");
        if (!stepOf(wf, at)) throw refuse(`no step '${at}' in workflow ${name}`, cmd.storyEdit(t.key, { workflow: name, at: steps }), "unknown_step");
      },
      // P6: the journal entry first, then the re-pin; state.json moves on the next tick (S5)
      build: (t, st) => humanReceipt(ctx, t, st, "workflow", { name, from_hash: st.workflow_hash, to_hash: toHash, to: at as string }),
    });
    pinWorkflow(t.runsDir as string, loaded.source, { replace: true });
    const file = patchFm();
    return { unit: t.key, workflow: name, previous: t.state.workflow, started: true, to: at, receipt: out.receipt, delivered: out.delivered, file, next: out.next };
  } finally {
    lock.release();
  }
}

async function moveCursor(ctx: Context, raw: string, at: string) {
  const key = parseUnitKey(raw);
  const lock = await acquireTickLock(ctx.root, { note: "norn story edit --at", now: () => ctx.clock.iso() });
  if (!lock.ok) throw busyError("a tick is running", "retry when it finishes", "tick_locked");
  try {
    const t = await resolveTarget(ctx, key.key);
    if (!t.state) throw refuse(`${t.key} has not started; --at applies only to a running unit (S7)`, cmd.storyEdit(t.key, { workflow: "<name>" }), "not_started");
    // gh-71 D3 (B18, T9): refused first while another clone holds the story's claim
    const claim = await refuseIfHeldElsewhere(ctx, t.story, "story edit");
    const out = await runHumanVerb(ctx, t, {
      verb: "story edit",
      mailbox: false,
      claim,
      // as a workflow switch: a second move before the tick is written, not refused as a duplicate (S6)
      refuseDuplicate: false,
      check(t, st) {
        // gh-71 B16 (RD4): a finished round is never revived; the next one starts with --workflow
        if (t.slice === null && roundFinished(st))
          throw refuse(`${t.story}'s ${st.workflow} round is finished; start a new round with ${cmd.storyEdit(t.story, { workflow: "<name>" })}`, cmd.storyEdit(t.story, { workflow: "<name>" }), "round_finished");
        if (st.status === "done") throw refuse(`${t.key} is done`, cmd.storyView(t.story), "unit_done");
        // gh-71 B15 (D4): a step of the round's own pinned workflow
        const steps = t.workflow ? Object.keys(t.workflow.steps) : [];
        if (!t.workflow || !stepOf(t.workflow, at))
          throw refuse(`no step '${at}' in ${t.key}'s ${st.workflow} workflow`, cmd.storyEdit(t.key, { at: `<${steps.join("|")}>` }), "unknown_step");
      },
      // gh-71 D4: journaled as today's workflow receipt, same workflow and hash; the tick enters `at`, counters kept
      build: (t, st) => humanReceipt(ctx, t, st, "workflow", { name: st.workflow, from_hash: st.workflow_hash, to_hash: st.workflow_hash, to: at }),
    });
    return { unit: out.unit, workflow: t.state.workflow, started: true, to: at, ...(t.slice === null ? { round: t.state.round ?? 1 } : {}), receipt: out.receipt, delivered: out.delivered, next: out.next };
  } finally {
    lock.release();
  }
}

export const storyEditCommand = defineCommand({
  name: "story edit",
  summary: "Switch a story between auto and manual mode, or choose a unit's workflow (B30–B32, MO1, W9, S7)",
  usage: USAGE,
  optionHelp: {
    "--auto": "the heartbeat starts the story's agent steps (MO1)",
    "--manual": "a person starts the story's agent steps (MO1)",
    "--workflow <name>": "the unit's workflow: set before it starts; on a started story, the next round's; on a started slice, switched with --at",
    "--at <step>": "with --workflow: the step the new round (story) or the switched slice lands on (S7); alone: move the current round's cursor to that step",
    "--force": "with --workflow on a story (not a slice): end its unfinished round (recorded as ended by you) and start the new one",
  },
  options: { auto: { type: "boolean" }, manual: { type: "boolean" }, workflow: { type: "string" }, at: { type: "string" }, force: { type: "boolean" } },
  positionals: { max: 1 },
  async run(ctx, args) {
    const auto = opt.bool(args, "auto");
    const manual = opt.bool(args, "manual");
    const workflow = opt.str(args, "workflow");
    const at = opt.str(args, "at");
    const force = opt.bool(args, "force");
    if (auto && manual) throw usageError("story edit: --auto and --manual exclude each other", USAGE);
    if ((auto || manual) && (workflow !== undefined || at !== undefined)) throw usageError("story edit: change the mode or the workflow, one at a time", USAGE);
    if (force && workflow === undefined) throw usageError("story edit: --force needs --workflow", USAGE);
    if (!auto && !manual && workflow === undefined && at === undefined) throw usageError("story edit: nothing to change (pass --auto, --manual, --workflow <name> or --at <step>)", USAGE);
    const raw = await targetKey(ctx, args.positionals[0], args.json === true, editable(auto || manual ? "mode" : "workflow"));
    // gh-71 RD3: --force ends a story's round; a slice switches in place (D4) and has no round to end
    if (force && parseUnitKey(raw).slice !== null) throw usageError("story edit: --force applies to a story, not a slice", USAGE);
    if (workflow !== undefined) return editWorkflow(ctx, raw, workflow, at, force);
    // gh-71 B15 (D3): --at alone moves the cursor inside the current round
    if (at !== undefined) return moveCursor(ctx, raw, at);
    return editMode(ctx, raw, auto ? "auto" : "manual");
  },
});
