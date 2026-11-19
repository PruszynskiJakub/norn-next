/**
 * The wake stamp: one small file in the machine dir that every receipt recorded on this machine
 * rewrites, and that a detached check's wrapper rewrites when its command exits. A pause between ticks
 * (`norn watch`) reads it, so a report, a person's answer or a finished check ends the pause at once
 * instead of an interval later.
 *
 * The stamp is `<writer> <unit> <receipt id>`: unique per receipt, so two receipts never leave the same
 * text, and its first word names the runtime env that wrote it, so a watch can tell its own tick's
 * receipts from another process's. The stamp is written after the receipt it announces, so a tick that
 * wakes on it reads that receipt. It is only a hint, and the last writer wins: another process's stamp
 * overwritten by the watch's own tick before the pause read it is lost. Losing one costs at most an
 * interval, so a stamp that cannot be written never fails the receipt.
 *
 * Receipts another machine writes (a shared store's remote, a mailbox) reach this one only when a tick
 * syncs, so they never wake a pause here. A step kind that reports `running` and is polled across ticks
 * stamps nothing until the tick that sees it finish, so it is seen at the next interval.
 */
import type { HostContext, NewReceipt, Store } from "@norn/plugin-api";
import { ulid } from "@norn/schema";

export const WAKE_FILE = "runtime/wake";

export const wakePath = (ctx: HostContext): string => `${ctx.repo.dataDir}/${WAKE_FILE}`;

/** The writer a detached check's wrapper stamps as: never a runtime env's, so every watch wakes on it. */
export const CHECK_WAKE_WRITER = "check";

/** A writer id for one runtime env: two processes never share one. */
export function newWakeWriter(now: string): string {
  return ulid(Date.parse(now));
}

/** The stamp as it is now, or null when nothing was stamped yet or it cannot be read. */
export async function readWake(ctx: HostContext): Promise<string | null> {
  try {
    const text = await ctx.files.read(wakePath(ctx));
    return text === null ? null : text.trim();
  } catch {
    return null;
  }
}

/** The writer that left `stamp`. */
export function wakeWriterOf(stamp: string): string {
  const cut = stamp.indexOf(" ");
  return cut < 0 ? stamp : stamp.slice(0, cut);
}

async function stampWake(ctx: HostContext, writer: string, unit: string, id: string): Promise<void> {
  try {
    await ctx.files.write(wakePath(ctx), `${writer} ${unit} ${id}\n`);
  } catch {
    // a hint only: the next interval's tick reads the receipt anyway
  }
}

/** `store` with every receipt it newly takes followed by a stamp; a replay wrote nothing, so it stamps nothing. */
export function stampingReceipts(store: Store, ctx: HostContext, writer: string): Store {
  const appendReceipt = async (unit: string, r: NewReceipt) => {
    const wrote = await store.appendReceipt(unit, r);
    if (wrote.ok && !wrote.value.replayed) await stampWake(ctx, writer, unit, r.id);
    return wrote;
  };
  return new Proxy(store, {
    get(target, prop) {
      if (prop === "appendReceipt") return appendReceipt;
      const value: unknown = Reflect.get(target, prop, target);
      return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(target) : value;
    },
  });
}
