/**
 * `norn mode <story> auto|manual` (§6, MO1): switch who starts unattended agent steps. Writes a
 * `mode` receipt on the story unit; the next tick stores it in `runs/_story/state.json`. A
 * running agent is not stopped (MO3). Needs the claim here (T8); mode never goes through the mailbox.
 */
import type { Mode } from "@norn/schema";
import { defineCommand } from "../command.ts";
import { refuse, usageError } from "../output.ts";
import { humanReceipt, parseUnitKey, refuseIfHeldElsewhere, resolveTarget, runHumanVerb } from "../runtime/human.ts";

export const modeCommand = defineCommand({
  name: "mode",
  summary: "Switch a story between auto and manual mode (MO1)",
  usage: "norn mode <story> auto|manual",
  positionals: { min: 2, max: 2 },
  async run(ctx, args) {
    const [raw, m] = args.positionals as [string, string];
    if (m !== "auto" && m !== "manual") throw usageError(`mode must be auto or manual, not '${m}'`, "norn mode <story> auto|manual");
    const mode: Mode = m;
    const key = parseUnitKey(raw);
    if (key.slice) throw refuse(`mode is per story, not per slice (MO1)`, `norn mode ${key.story} ${mode}`, "story_only");
    const t = await resolveTarget(ctx, key.story);
    // T9: refused before anything (even a no-op) is computed from a possibly stale local copy
    const claim = await refuseIfHeldElsewhere(ctx, t.story, "mode");
    let current: Mode = ctx.config.default_mode;
    const out = await runHumanVerb(ctx, t, {
      verb: "mode",
      mailbox: false,
      claim,
      // MO1: every mode receipt applies, the last one wins — a second switch is no duplicate
      refuseDuplicate: false,
      check(t, st) {
        if (st.status === "done") throw refuse(`${t.key} is done`, `norn status ${t.key}`, "unit_done");
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
  },
});
