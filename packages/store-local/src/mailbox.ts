/** A story's mailbox as one file, rewritten whole under its lock so a send or an ack lands entirely or not at all. */
import { type HostContext, ok, type PluginResult, type StoreMailbox } from "@norn/plugin-api";
import type { Layout } from "./layout.ts";
import { type LockTuning, withLock } from "./lock.ts";
import { MailboxFile, readRecord, toJson } from "./records.ts";

const EMPTY: MailboxFile = { messages: [], acked: [] };

/** The mailbox part; arguments are validated by the store before they reach here. */
export function mailbox(ctx: HostContext, at: Layout, tuning: LockTuning): StoreMailbox {
  const read = async (story: string): Promise<PluginResult<MailboxFile>> => {
    const r = await readRecord(ctx, at.mailbox(story), MailboxFile);
    return r.ok ? ok(r.value ?? EMPTY) : r;
  };
  const locked = <T>(story: string, fn: (box: MailboxFile) => Promise<PluginResult<T>>) =>
    withLock(ctx, `${at.mailbox(story)}.lock`, tuning, async () => {
      const box = await read(story);
      return box.ok ? fn(box.value) : box;
    });
  const save = (story: string, box: MailboxFile) => ctx.files.write(at.mailbox(story), toJson(box) as string);

  return {
    send: (story, m) =>
      locked<{ replayed: boolean }>(story, async (box) => {
        if (box.acked.includes(m.id) || box.messages.some((x) => x.id === m.id)) return ok({ replayed: true });
        await save(story, { ...box, messages: [...box.messages, { id: m.id, from: m.from, at: ctx.now(), data: m.data }] });
        return ok({ replayed: false });
      }),

    receive: async (story) => {
      const box = await read(story);
      return box.ok ? ok(box.value.messages) : box;
    },

    ack: (story, ids) =>
      locked(story, async (box) => {
        const drop = new Set(ids);
        const acked = box.messages.filter((m) => drop.has(m.id));
        // an id never sent is not recorded, or a later first send of it would read as a replay
        if (acked.length > 0) {
          await save(story, { messages: box.messages.filter((m) => !drop.has(m.id)), acked: [...box.acked, ...acked.map((m) => m.id)] });
        }
        return ok(null);
      }),
  };
}
