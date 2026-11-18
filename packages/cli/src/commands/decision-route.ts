/**
 * Where a person's decision on a story goes (`story answer`, `story approve`, `story reject`). A
 * story's record is written by the machine holding its claim: a receipt written on another machine
 * of a shared store stays in that machine's copy, which the holder never fetches and which no
 * longer moves up to the remote's. So while another holder has the claim, the decision goes to the
 * story's mailbox instead, and the holder's tick imports it as the same receipt.
 */
import { type MailboxLetter, type ReceiptIntent, validateMailboxLetter } from "@norn/kernel";
import type { ClaimRecord, Store } from "@norn/plugin-api";
import type { RuntimeEnv } from "@norn/runtime";
import { failure, refuse } from "../output.ts";

export type DecisionRoute = { via: "local" } | { via: "mailbox"; holder: string; expires_at: string; expired: boolean };

/**
 * Local while this machine holds the claim or nobody does; the mailbox while another holder has it,
 * expired or not: an expired claim still names whose record it is until a person takes the story,
 * and a takeover's tick imports the same mailbox. A store without a mailbox writes locally only when
 * it is one record every holder reads; a shared one refuses rather than strand the receipt.
 */
export function decisionRoute(story: string, claim: ClaimRecord | null, me: string, store: Pick<Store, "name" | "capabilities" | "mailbox">, now: string, retry: string): DecisionRoute {
  if (claim === null || claim.holder === me) return { via: "local" };
  const expired = Date.parse(now) >= Date.parse(claim.expires_at);
  if (store.capabilities.mailbox && store.mailbox) return { via: "mailbox", holder: claim.holder, expires_at: claim.expires_at, expired };
  if (!store.capabilities.shared) return { via: "local" };
  const until = expired ? `(expired at ${claim.expires_at})` : `until ${claim.expires_at}`;
  throw refuse(
    `${story} is held by ${claim.holder} ${until}, and store ${store.name} has no mailbox to send the decision to it`,
    `${retry} on the machine of ${claim.holder} | norn story take ${story} --force, then ${retry}`,
    "claim_held",
    { holder: claim.holder, expires_at: claim.expires_at, expired },
  );
}

/** The route for a decision on `story`, from its claim as the store has it now. */
export async function routeDecision(env: RuntimeEnv, story: string, retry: string): Promise<DecisionRoute> {
  const claim = await env.slots.store.claims.read(story);
  if (!claim.ok) throw failure(`cannot read the claim of ${story}: ${claim.failure.message}`, "try again", claim.failure.code);
  return decisionRoute(story, claim.value, env.config.holder, env.slots.store, env.ctx.now(), retry);
}

export type Delivered = { via: "local"; seq: number; replayed: boolean } | { via: "mailbox"; holder: string; replayed: boolean };

/**
 * Write the receipt on this machine's record, or send it as a letter under the receipt's own id:
 * the id is built from what the decision answers, so sending it again is a replay, and the holder
 * imports it as a receipt of that same id, one a decision made on the holder itself would match.
 */
export async function deliverDecision(env: RuntimeEnv, route: DecisionRoute, unit: string, intent: ReceiptIntent, retry: string): Promise<Delivered> {
  if (route.via === "local") {
    const wrote = await env.journal.record(unit, intent);
    if (!wrote.ok) throw failure(`cannot record the decision on ${unit}: ${wrote.failure.message}`, `${retry} again`, wrote.failure.code);
    return { via: "local", ...wrote.value };
  }
  const story = unit.split("/")[0] as string;
  const letter: MailboxLetter = { unit, receipt: intent.data };
  // a letter the holder's import would refuse is acknowledged there unread; refusing it here tells the person
  const checked = validateMailboxLetter(letter);
  if (!checked.ok) throw failure(`the decision on ${unit} is not a letter the holder can import`, `${retry} on the machine of ${route.holder}`, "invalid");
  const mailbox = env.slots.store.mailbox as NonNullable<Store["mailbox"]>;
  const sent = await mailbox.send(story, { id: intent.id, from: env.config.holder, data: letter });
  if (!sent.ok) throw failure(`cannot send the decision on ${unit} to ${route.holder}: ${sent.failure.message}`, `${retry} again`, sent.failure.code);
  return { via: "mailbox", holder: route.holder, replayed: sent.value.replayed };
}

/** What the person reads after a decision: where it went, and what applies it. */
export function deliveredLine(d: Delivered, what: string): string {
  const again = d.replayed ? (d.via === "local" ? " (recorded before)" : " (sent before)") : "";
  if (d.via === "local") return `Recorded ${what}${again}.`;
  return `Sent ${what} to ${d.holder}${again}; its next tick applies it.`;
}
