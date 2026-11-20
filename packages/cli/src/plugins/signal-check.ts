/**
 * Which of the repo's workflow and shared files still route `stale` or `unpushed` under a waiting
 * step's `outcomes:`, the form written before signals had their own `on:` block. The loader still
 * takes it, so a unit that pinned such a revision decides as it did, which makes it a warning for
 * doctor and never a refusal. The raw files are read, not the loaded graph, because both forms load to
 * the same graph and only the text tells them apart. Only the repo's files are read: a pack's are its
 * plugin's to keep, with their own tests.
 */
import { REPO_WORKFLOWS_DIR, type RuntimeEnv } from "@norn/runtime";
import { parse } from "yaml";

/** The signals a waiting step routed under `outcomes:` before the `on:` block. */
const LEGACY_SIGNALS = ["stale", "unpushed"] as const;

interface Legacy {
  file: string;
  step: string;
  signals: string[];
}

function legacySteps(file: string, text: string, waits: (head: string) => boolean): Legacy[] {
  let doc: unknown;
  try {
    doc = parse(text);
  } catch {
    // a file that does not parse fails the workflows check, which names it
    return [];
  }
  const steps = (doc as { steps?: unknown } | null)?.steps;
  if (steps === null || typeof steps !== "object") return [];
  const out: Legacy[] = [];
  for (const [name, raw] of Object.entries(steps as Record<string, unknown>)) {
    if (raw === null || typeof raw !== "object") continue;
    const step = raw as Record<string, unknown>;
    // a step with an on: block is written in the new form, and the loader refuses a signal left under its outcomes:
    if (step.on !== undefined || !Object.keys(step).some(waits)) continue;
    const outcomes = step.outcomes;
    if (outcomes === null || typeof outcomes !== "object") continue;
    const signals = LEGACY_SIGNALS.filter((s) => Object.hasOwn(outcomes, s));
    if (signals.length) out.push({ file, step: name, signals });
  }
  return out;
}

/** A warning and its fix when a repo file routes a signal under a waiting step's `outcomes:`; null when none does. */
export function legacySignalWarning(env: RuntimeEnv): { warning: string; do_instead: string } | null {
  const waits = (head: string) => head === "gate" || env.slots.stepKinds[head]?.mode === "wait";
  const files = [
    ...Object.entries(env.repoWorkflows.workflows).map(([f, text]) => [`${REPO_WORKFLOWS_DIR}/${f}`, text] as const),
    ...Object.entries(env.repoWorkflows.shared).map(([f, text]) => [`${REPO_WORKFLOWS_DIR}/shared/${f}`, text] as const),
  ];
  const found = files.flatMap(([file, text]) => legacySteps(file, text, waits));
  if (found.length === 0) return null;
  const where = [...new Set(found.map((l) => l.file))]
    .map((file) => `${file} routes ${found.filter((l) => l.file === file).map((l) => `${l.signals.join(" and ")} under outcomes: (step ${l.step})`).join(", ")}`)
    .join("; ");
  return {
    warning: `${where}; it still loads, but a signal is routed under on:`,
    do_instead: `in ${[...new Set(found.map((l) => l.file))].join(", ")}, move ${[...new Set(found.flatMap((l) => l.signals))].join(" and ")} from each waiting step's outcomes: to an on: block beside it`,
  };
}
