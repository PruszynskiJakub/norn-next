/**
 * `norn mode <story> auto|manual` (§6, MO1): switch who starts unattended agent steps. Writes a
 * `mode` receipt on the story unit; the next tick stores it in `runs/_story/state.json`. A
 * running agent is not stopped (MO3). Needs the claim here (T8); mode never goes through the mailbox.
 */
import type { Mode } from "@norn/schema";
import { defineCommand } from "../command.ts";
import { refuse, usageError } from "../output.ts";
import { claimRoute, deliver, humanReceipt, parseUnitKey, refuseIfHeldElsewhere, resolveTarget, started } from "../runtime/human.ts";

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
    const claim = await refuseIfHeldElsewhere(ctx, t.story, "mode");
    const st = started(t);
    if (st.status === "done") throw refuse(`${t.key} is done`, `norn status ${t.key}`, "unit_done");
    const previous: Mode = st.mode ?? ctx.config.default_mode;
    // a pending, not yet applied mode receipt wins over state.json
    const uf = t.story_facts?.units.find((u) => u.unit.key === t.key);
    const pending = uf?.unapplied.filter((r) => r.receipt.kind === "mode").at(-1)?.receipt;
    const current = pending?.kind === "mode" ? pending.mode : previous;
    if (current === mode) return { unit: t.key, mode, changed: false };
    const route = await claimRoute(ctx, t, { mailbox: false, verb: "mode", claim });
    const receipt = humanReceipt(ctx, t, st, "mode", { mode, previous: current });
    const delivered = await deliver(ctx, t, route, receipt);
    return { unit: t.key, mode, previous: current, changed: true, receipt, delivered, next: "norn tick" };
  },
});
