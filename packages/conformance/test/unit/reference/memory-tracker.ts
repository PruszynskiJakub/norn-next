/**
 * The smallest tracker that keeps the contract, held in memory: the reference the suite is proven
 * against, and a model of what a real tracker must do with receipt ids.
 */
import type { SeedItem, TrackerWorld } from "@norn/conformance";
import {
  fail,
  formatStoryKey,
  ok,
  type PluginResult,
  type Tracker,
  type TrackerCapabilities,
  type TrackerEffect,
  type TrackerEffectOutcome,
  type TrackerItem,
  type TrackerLabel,
  validateTrackerEffect,
} from "@norn/plugin-api";

export interface MemoryTrackerOptions {
  me?: string;
  keyPrefix?: string;
  now: () => string;
  capabilities?: Partial<TrackerCapabilities>;
  /** a defect on purpose: create and comment forget their receipt ids, so a replay duplicates */
  forgetReceipts?: boolean;
}

interface Held {
  id: number;
  title: string;
  body: string;
  open: boolean;
  assignees: string[];
  labels: string[];
  updated_at: string;
  comments: string[];
}

const CAPABILITY: Record<TrackerEffect["kind"], keyof TrackerCapabilities> = {
  assign: "assign",
  comment: "comment",
  create: "create",
  close: "close",
  labels: "labels",
  ensure_labels: "labels",
};

export function memoryTracker(opts: MemoryTrackerOptions): TrackerWorld {
  const me = opts.me ?? "me";
  const keyPrefix = opts.keyPrefix ?? "mem";
  const capabilities: TrackerCapabilities = { assign: true, labels: true, comment: true, create: true, close: true, ...opts.capabilities };
  let items = new Map<number, Held>();
  const labels = new Map<string, TrackerLabel>();
  const receipts = new Map<string, TrackerEffectOutcome>();
  let failing = false;

  const view = (h: Held): TrackerItem => ({
    id: h.id,
    key: formatStoryKey(keyPrefix, h.id),
    title: h.title,
    body: h.body,
    open: h.open,
    assignees: [...h.assignees],
    labels: [...h.labels],
    url: `memory://items/${h.id}`,
    updated_at: h.updated_at,
  });
  const down = <T>(): PluginResult<T> => fail("unavailable", "memory tracker: down");

  function apply(effect: TrackerEffect): PluginResult<TrackerEffectOutcome> {
    const touch = (h: Held) => {
      h.updated_at = opts.now();
    };
    const done = (id?: number): PluginResult<TrackerEffectOutcome> =>
      ok({ kind: effect.kind, replayed: false, ...(id !== undefined && { id, key: formatStoryKey(keyPrefix, id) }) });
    if (effect.kind === "ensure_labels") {
      for (const l of effect.labels) if (!labels.has(l.name)) labels.set(l.name, { ...l });
      return done();
    }
    if (effect.kind === "create") {
      const id = Math.max(0, ...items.keys()) + 1;
      items.set(id, { id, title: effect.title, body: effect.body, open: true, assignees: effect.assignee ? [effect.assignee] : [], labels: [...effect.labels], updated_at: opts.now(), comments: [] });
      return done(id);
    }
    const h = items.get(effect.id);
    if (!h) return fail("not_found", `memory tracker: no item ${effect.id}`);
    if (effect.kind === "assign" && !h.assignees.includes(effect.user)) h.assignees.push(effect.user);
    if (effect.kind === "comment") h.comments.push(effect.body);
    if (effect.kind === "close") h.open = false;
    if (effect.kind === "labels") h.labels = [...h.labels.filter((l) => !effect.remove.includes(l)), ...effect.add.filter((l) => !h.labels.includes(l))];
    touch(h);
    return done(h.id);
  }

  const tracker: Tracker = {
    name: "memory",
    keyPrefix,
    capabilities,
    whoami: async () => (failing ? down() : ok(me)),
    intake: async (q) => {
      if (failing) return down();
      const who = q.assignee === "me" ? me : q.assignee;
      return ok([...items.values()].filter((h) => h.open && h.labels.includes(q.label) && (who === null || h.assignees.includes(who))).map(view));
    },
    get: async (id) => {
      if (failing) return down();
      const h = items.get(id);
      return ok(h ? view(h) : null);
    },
    perform: async (effect, meta) => {
      if (failing) return down();
      if (!validateTrackerEffect(effect).ok) return fail("invalid", "memory tracker: malformed effect");
      if (!capabilities[CAPABILITY[effect.kind]]) return fail("invalid", `memory tracker: cannot ${effect.kind}`);
      const seen = receipts.get(meta.receipt_id);
      if (seen) return ok({ ...seen, replayed: true });
      const r = apply(effect);
      if (r.ok && !(opts.forgetReceipts && (effect.kind === "create" || effect.kind === "comment"))) receipts.set(meta.receipt_id, r.value);
      return r;
    },
  };

  return {
    tracker,
    seed: async (seeded: SeedItem[]) => {
      items = new Map(seeded.map((s) => [s.id, { ...s, assignees: [...s.assignees], labels: [...s.labels], updated_at: opts.now(), comments: [] }]));
    },
    failing: (on) => {
      failing = on;
    },
    comments: async (id) => [...(items.get(id)?.comments ?? [])],
    definedLabels: async () => [...labels.values()].map((l) => ({ ...l })),
  };
}
