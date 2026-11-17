/**
 * The tracker and forge suites run against in-memory references, and against references broken on
 * purpose (as known failures), so the suites are shown both to pass a keeper of the contract and to
 * catch a breaker of it.
 */
import { forgeContract, steppingClock, trackerContract } from "@norn/conformance";
import { absentForge, memoryForge } from "./reference/memory-forge.ts";
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

forgeContract("absent forge", () => absentForge(), { changes: false });

forgeContract("memory reference that picks the oldest change", () => memoryForge({ now: now(), oldestFirst: true }), {
  failing: { "findChanges picks the newest of a branch's changes, across branches": "answers with the oldest" },
});
