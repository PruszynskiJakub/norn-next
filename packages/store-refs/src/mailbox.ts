/**
 * A story's mailbox as one ref on the remote, pushed under a lease on every change like a claim.
 * Pending messages are filed `<seq>-<id>.json` so send order reads off the tree; an acknowledged
 * message leaves a marker under its id, so sending it again is still a replay.
 */
import { isStoreId, isStoryUnit, ok, parseJson, type PluginResult, type StoreMailbox, StoredMessage } from "@norn/plugin-api";
import { mutate, read, remoteCell } from "./cell.ts";
import { corrupt, invalid, type RefsContext, toJson } from "./context.ts";
import { readBlobs } from "./git.ts";
import { ACKED_DIR, MESSAGES_DIR, mailboxRef, type SeqFile, seqFiles, seqName } from "./layout.ts";
import type { Snapshot } from "./tree.ts";

function pending(snap: Snapshot, story: string): PluginResult<SeqFile[]> {
  const files = seqFiles(snap, MESSAGES_DIR);
  return files === null ? corrupt(`${story}: a message file is misnamed`) : ok(files);
}

export function refsMailbox(rc: RefsContext): StoreMailbox {
  const cell = (story: string) => remoteCell(rc.git, rc.remote, mailboxRef(story));
  return {
    send: async (story, m) => {
      if (!isStoryUnit(story)) return invalid(`not a story: ${JSON.stringify(story)}`);
      if (!isStoreId(m.id)) return invalid(`not a message id: ${JSON.stringify(m.id)}`);
      if (typeof m.from !== "string" || m.from === "") return invalid("a message needs a sender");
      const json = toJson(m.data);
      if (json === null) return invalid("message data is not JSON");
      return mutate<{ replayed: boolean }>(rc, cell(story), async (snap) => {
        const files = pending(snap, story);
        if (!files.ok) return files;
        if (files.value.some((f) => f.id === m.id) || snap.files.has(`${ACKED_DIR}/${m.id}`)) return ok({ result: { replayed: true } });
        const seq = (files.value.at(-1)?.seq ?? 0) + 1;
        const text = `{"id":${JSON.stringify(m.id)},"from":${JSON.stringify(m.from)},"at":${JSON.stringify(rc.now())},"data":${json}}`;
        return ok({ result: { replayed: false }, writes: new Map([[`${MESSAGES_DIR}/${seqName(seq, m.id)}`, text]]) });
      });
    },
    receive: async (story) => {
      if (!isStoryUnit(story)) return invalid(`not a story: ${JSON.stringify(story)}`);
      const snap = await read(rc.git, cell(story));
      if (!snap.ok) return snap;
      const files = pending(snap.value, story);
      if (!files.ok) return files;
      const texts = await readBlobs(rc.git, files.value.map((f) => f.sha));
      if (!texts.ok) return texts;
      const out: StoredMessage[] = [];
      for (const f of files.value) {
        const msg = parseJson(StoredMessage, texts.value.get(f.sha) as string, `${story} message ${f.id}`);
        if (!msg.ok) return msg;
        if (msg.value.id !== f.id) return corrupt(`${story}: message filed as ${f.id} holds ${msg.value.id}`);
        out.push(msg.value);
      }
      return ok(out);
    },
    ack: async (story, ids) => {
      if (!isStoryUnit(story)) return invalid(`not a story: ${JSON.stringify(story)}`);
      if (!Array.isArray(ids)) return invalid("ack takes a list of message ids");
      const wanted = new Set(ids);
      return mutate(rc, cell(story), async (snap) => {
        const files = pending(snap, story);
        if (!files.ok) return files;
        const writes = new Map<string, string | null>();
        for (const f of files.value) {
          if (!wanted.has(f.id)) continue;
          writes.set(f.path, null);
          writes.set(`${ACKED_DIR}/${f.id}`, "");
        }
        return ok({ result: null, writes });
      });
    },
  };
}

