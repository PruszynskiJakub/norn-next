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
 *
 * In a shared store, the story is carried on from the remote's record: run data this clone wrote and
 * never published (a late report, a receipt written before the claim moved away) diverged from what
 * the holders since published, and is dropped for it, kept under a ref the output names. A story this
 * machine already holds whose run data diverged is carried on from the remote's record only with
 * `--force`, as no takeover says the remote's record is the one to keep.
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

/** Whether this clone's run data of the story and the remote's diverged; a store that cannot tell has nothing to carry on from. */
async function divergedHere(env: RuntimeEnv, key: string): Promise<boolean> {
  const store = env.slots.store;
  if (!store.capabilities.shared || !store.diverged) return false;
  const split = await store.diverged(key);
  if (!split.ok) throw failure(`cannot tell whether the run data of ${key} diverged: ${split.failure.message}`, `norn story take ${key} again`, split.failure.code);
  return split.value;
}

interface Dropped {
  commit: string;
  kept_at: string | null;
}

async function adoptRemote(env: RuntimeEnv, key: string): Promise<Dropped | null> {
  const adopt = env.slots.store.adoptRemote;
  if (!adopt) return null;
  const r = await adopt(key);
  if (!r.ok) throw failure(`cannot carry ${key} on from the remote's record: ${r.failure.message}`, `norn story take ${key} --force again`, r.failure.code);
  return r.value.dropped === null ? null : { commit: r.value.dropped, kept_at: r.value.kept_at ?? null };
}

function droppedText(key: string, d: Dropped): string {
  return `This clone's run data of ${key} that the remote never had was dropped for the remote's record${d.kept_at ? `; it is kept at ${d.kept_at}` : ""}.`;
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
      const split = await divergedHere(env, key);
      if (split && !force)
        throw refuse(
          `${key} is held by this machine, and its run data here and on the remote diverged, so no flush can publish it`,
          `norn story take ${key} --force carries it on from the remote's record, keeping this clone's part under a ref`,
          "store_diverged",
        );
      const dropped = split ? await adoptRemote(env, key) : null;
      const value = { story: key, holder, taken: false, expires_at: held.expires_at, version: held.version, ...(dropped && { dropped }) };
      const text = `${key} is already held by this machine (${holder}) until ${held.expires_at}; nothing to take.`;
      return rendered(value, dropped ? `${text} ${droppedText(key, dropped)}` : text);
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
    const dropped = (await divergedHere(env, key)) ? await adoptRemote(env, key) : null;
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
    const value = {
      story: key,
      holder,
      taken: true,
      from: held?.holder ?? null,
      expired: held ? !live : null,
      expires_at: claim.expires_at,
      version: claim.version,
      receipt_id: id,
      ...wrote.value,
      ...(dropped && { dropped }),
    };
    const from = held ? ` from ${held.holder}${live ? "" : " (expired)"}` : "";
    const said = `Took the claim of ${key}${from} for ${holder}, until ${claim.expires_at}. The next tick here carries it on.`;
    return rendered(value, dropped ? `${said} ${droppedText(key, dropped)}` : said);
  },
});
