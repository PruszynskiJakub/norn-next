/**
 * `norn story take <key> [--force] [--reason <text>]`: move a story's claim to this machine, so its
 * next tick carries the story on. A claim nobody holds is taken; this machine's is left as it is;
 * another holder's, live or expired, only with `--force`, since that holder may still be acting on the
 * story. The store decides by compare-and-swap against the version read, so of two people taking one
 * story at once exactly one wins.
 *
 * The takeover is recorded as a `claim.taken` receipt on the story's own unit, after the claim is
 * this machine's: in a shared store only the holder writes a story's run data, so a receipt written
 * first would sit on a copy the remote's holder never merges with, and would claim a takeover a lost
 * race never made.
 */
import type { ClaimRecord } from "@norn/plugin-api";
import { parseUnitId, type PluginResult, RUN_ENV } from "@norn/plugin-api";
import type { RuntimeEnv } from "@norn/runtime";
import { defineCommand, opt } from "../command.ts";
import { failure, refuse, rendered } from "../output.ts";
import { receiptId, syncStore } from "./person-support.ts";

const USAGE = "norn story take <key> [--force] [--reason <text>]";

/** The claim written for this machine: a takeover where the store offers one, else an acquire, which only an expired or free claim lets through. */
function take(env: RuntimeEnv, key: string, held: ClaimRecord | null, live: boolean): Promise<PluginResult<ClaimRecord>> {
  const claims = env.slots.store.claims;
  const ttl = env.config.kernel.claimTtlMs;
  const version = held?.version ?? null;
  if (env.slots.store.capabilities.takeover && claims.takeOver) return claims.takeOver(key, env.config.holder, ttl, version);
  if (held && live)
    throw refuse(
      `store ${env.slots.store.name} cannot take over a live claim; ${held.holder} holds ${key} until ${held.expires_at}`,
      `wait until ${held.expires_at}, then norn story take ${key} --force`,
      "takeover_unsupported",
    );
  return claims.acquire(key, env.config.holder, ttl, version);
}

export const storyTakeCommand = defineCommand({
  name: "story take",
  acts: true,
  summary: "Take a story's claim to this machine, so its next tick carries the story on",
  usage: USAGE,
  options: {
    force: { type: "boolean" },
    reason: { type: "string" },
  },
  optionHelp: {
    "--force": "take over a claim another machine holds, live or expired",
    "--reason <text>": "why, kept on the record",
  },
  positionals: { min: 1, max: 1 },
  async run(ctx, args) {
    const key = args.positionals[0] as string;
    const force = opt.bool(args, "force");
    const reason = opt.str(args, "reason")?.trim() || undefined;
    // a step agent moving its story to another machine would cut its own run off mid-step
    if (ctx.env[RUN_ENV.run]) throw refuse(`a step agent may not take a claim (run ${ctx.env[RUN_ENV.run]})`, "a person takes it, outside any norn run", "agent_take");
    const ref = parseUnitId(key);
    if (!ref) throw refuse(`${key} is not a story key`, "norn story list", "unknown_story");
    if (ref.slice !== null) throw refuse(`a claim is a story's, not a slice's (${key})`, `norn story take ${ref.story}`, "not_a_story");
    const env = await ctx.runtimeEnv();
    const holder = env.config.holder;
    await syncStore(env, key, `norn story take ${key}`);

    const read = await env.slots.store.claims.read(key);
    if (!read.ok) throw failure(`cannot read the claim of ${key}: ${read.failure.message}`, "try again", read.failure.code);
    const held = read.value;
    if (held?.holder === holder) {
      const value = { story: key, holder, taken: false, expires_at: held.expires_at, version: held.version };
      return rendered(value, `${key} is already held by this machine (${holder}) until ${held.expires_at}; nothing to take.`);
    }
    if (!held) {
      const listed = await env.slots.store.listUnits({ story: key });
      if (!listed.ok) throw failure(`cannot list the units of ${key}: ${listed.failure.message}`, "try again", listed.failure.code);
      if (listed.value.length === 0) throw refuse(`${key} has no run state and no claim`, "norn story list", "unknown_story");
    }
    const live = held !== null && Date.parse(env.ctx.now()) < Date.parse(held.expires_at);
    if (held && !force) {
      const until = live ? `until ${held.expires_at}` : `(expired at ${held.expires_at})`;
      throw refuse(`${key} is held by ${held.holder} ${until}`, `norn story take ${key} --force, once ${held.holder} no longer acts on it`, "claim_held", {
        holder: held.holder,
        expires_at: held.expires_at,
        expired: !live,
      });
    }

    const took = await take(env, key, held, live);
    if (!took.ok) {
      if (took.failure.code === "conflict") throw refuse(`the claim of ${key} changed while taking it: ${took.failure.message}`, `norn story take ${key} again`, "claim_moved");
      throw failure(`cannot take the claim of ${key}: ${took.failure.message}`, `norn story take ${key} again`, took.failure.code);
    }
    const claim = took.value;
    // what the old holder flushed before it saw the claim move is fetched before this machine writes beside it
    await syncStore(env, key, `norn story take ${key}`);
    const id = receiptId("claim-taken", `v${claim.version}`);
    const data = {
      kind: "claim.taken" as const,
      ...(held && { from: held.holder, from_expires_at: held.expires_at }),
      to: holder,
      version: claim.version,
      by: holder,
      ...(reason && { reason }),
    };
    const wrote = await env.journal.record(key, { id, data });
    // the claim is this machine's either way; only the record of how it came here is missing
    if (!wrote.ok) throw failure(`took the claim of ${key} but could not record it: ${wrote.failure.message}`, `norn story view ${key}`, wrote.failure.code);
    const value = { story: key, holder, taken: true, from: held?.holder ?? null, expired: held ? !live : null, expires_at: claim.expires_at, version: claim.version, receipt_id: id, ...wrote.value };
    const from = held ? ` from ${held.holder}${live ? "" : " (expired)"}` : "";
    return rendered(value, `Took the claim of ${key}${from} for ${holder}, until ${claim.expires_at}. The next tick here carries it on.`);
  },
});
