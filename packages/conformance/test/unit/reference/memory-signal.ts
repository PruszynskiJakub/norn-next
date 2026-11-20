/**
 * The smallest signal source that keeps the contract, over a reviewer's verdicts held in memory, and
 * the same source broken on purpose in each way the suite must catch: the references the signal
 * source suite is proven against.
 */
import { memoryFiles, memoryHost, type SignalWorld } from "@norn/conformance";
import { fail, ok, type SignalReadInput } from "@norn/plugin-api";

export interface MemorySignalOptions {
  /** a defect on purpose: every read names its signal anew, so one review fires on every tick */
  freshIds?: boolean;
  /** a defect on purpose: every read writes a note of what it saw */
  notes?: boolean;
  /** a defect on purpose: a provider that is down reads as nothing happened */
  guesses?: boolean;
}

export function memorySignalWorld(opts: MemorySignalOptions = {}): SignalWorld {
  const files = memoryFiles();
  const ctx = memoryHost({ files });
  let review: number | null = null;
  let reviews = 0;
  let failing = false;
  let reads = 0;
  const input: SignalReadInput = { story: "gh-7", step: "ready", visit: "ready#1", since: "2026-11-17T10:00:00.000Z" };
  return {
    name: "changes-requested",
    ctx,
    input: () => structuredClone(input),
    source: {
      read: async (story) => {
        reads++;
        if (opts.notes) await files.write(`/machine/notes/${story.story}-${reads}`, String(review));
        if (failing) return opts.guesses ? ok(null) : fail("unavailable", "memory reviews: down");
        if (review === null) return ok(null);
        return ok({ type: "changes-requested", source: "memory", id: opts.freshIds ? `r${review}-${reads}` : `r${review}`, detail: { comments: ["rename it"] } });
      },
    },
    happen: (on) => {
      if (!on) review = null;
      else if (review === null) review = ++reviews;
    },
    failing: (on) => {
      failing = on;
    },
    again: () => {
      review = ++reviews;
    },
    effects: () => ({ files: files.snapshot() }),
  };
}
