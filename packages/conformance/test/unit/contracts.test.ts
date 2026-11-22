/**
 * The tracker, forge, store, signal source and host files suites run against in-memory references, and against
 * references broken on purpose (as known failures), so the suites are shown both to pass a keeper of
 * the contract and to catch a breaker of it.
 */
import { forgeContract, hostFilesContract, memoryFiles, signalSourceContract, steppingClock, storeContract, trackerContract } from "@norn/conformance";
import { absentForge, memoryForge } from "./reference/memory-forge.ts";
import { memorySignalWorld } from "./reference/memory-signal.ts";
import { memoryStore } from "./reference/memory-store.ts";
import { memoryTracker } from "./reference/memory-tracker.ts";

const now = () => steppingClock("2026-11-17T10:00:00.000Z");

trackerContract("memory reference", () => memoryTracker({ now: now() }));

trackerContract("memory reference, read-only", () =>
  memoryTracker({ now: now(), keyPrefix: "ro", capabilities: { assign: false, labels: false, comment: false, create: false, close: false } }),
);

trackerContract("memory reference that forgets receipt ids", () => memoryTracker({ now: now(), forgetReceipts: true }), {
  failing: {
    "create is idempotent by receipt id": "replayed create opens a second item",
    "comment adds one comment, idempotent by receipt id": "replayed comment posts twice",
  },
});

forgeContract("memory reference", () => memoryForge({ now: now() }));

forgeContract("memory reference whose file URLs follow the newest commit", () => memoryForge({ now: now(), unpinned: true }), {
  failing: { "fileUrl: a forge that offers it serves raw URLs, and pins each form of a commit's file to that commit": "names the newest commit's file whatever commit is asked for" },
});

forgeContract("absent forge", () => absentForge(), { changes: false });

forgeContract("memory reference that picks the oldest change", () => memoryForge({ now: now(), oldestFirst: true }), {
  failing: { "findChanges picks the newest of a branch's changes, across branches": "answers with the oldest" },
});

storeContract("memory reference", () => memoryStore());

storeContract("memory reference that checks before it yields", () => memoryStore({ racy: true }), {
  failing: {
    "racing appenders never share or skip a seq": "two appenders take one seq",
    "racing appends of one id land once": "one id lands twice",
    "racing committers against one version: exactly one wins": "every committer wins",
    "racing acquirers: exactly one holds the claim": "every acquirer holds the claim",
    "racing takeovers: exactly one holds the claim": "every person takes the claim",
    "racing senders all land, once each": "a message lands twice",
  },
});

signalSourceContract("memory reference", () => memorySignalWorld());

signalSourceContract("memory reference that names each read anew", () => memorySignalWorld({ freshIds: true }), {
  failing: { "the same occurrence gives the same id on every read and every machine": "every read gets a new id" },
});

signalSourceContract("memory reference that notes what it saw", () => memorySignalWorld({ notes: true }), {
  failing: { "a read performs no effect": "every read writes a note" },
});

signalSourceContract("memory reference that guesses when it cannot tell", () => memorySignalWorld({ guesses: true }), {
  failing: { "a source that cannot tell answers a failure, never a signal or null": "answers null when its provider is down" },
});

hostFilesContract("memory files", () => ({ files: memoryFiles(), dir: "/work" }));

hostFilesContract("memory files without bytes", () => {
  const { readBytes: _r, writeBytes: _w, ...files } = memoryFiles();
  return { files, dir: "/work" };
});

hostFilesContract(
  "memory files that carry bytes as text",
  () => {
    const files = memoryFiles();
    return {
      dir: "/work",
      files: { ...files, writeBytes: (path: string, data: Uint8Array) => files.write(path, new TextDecoder().decode(data)) },
    };
  },
  { failing: { "bytes written with writeBytes read back identical with readBytes, every byte value": "decodes the bytes as UTF-8 on the way in" } },
);

hostFilesContract(
  "memory files with readBytes alone",
  () => {
    const { writeBytes: _w, ...files } = memoryFiles();
    return { files, dir: "/work" };
  },
  { failing: { "a host offers readBytes and writeBytes together or neither": "offers readBytes without writeBytes" } },
);
