/**
 * The smallest forge that keeps the contract, held in memory, and the smallest forge that holds no
 * changes at all: the references the forge suite is proven against.
 */
import type { ForgeWorld } from "@norn/conformance";
import { type ChangeRequest, type ChecksSummary, fail, type Forge, type ForgeEffectOutcome, ok, type PluginResult, validateForgeEffect } from "@norn/plugin-api";

export interface MemoryForgeOptions {
  now: () => string;
  /** a defect on purpose: findChanges answers with a branch's oldest change */
  oldestFirst?: boolean;
  /** a defect on purpose: fileUrl names the file at the newest commit, not the one asked for */
  unpinned?: boolean;
}

export function memoryForge(opts: MemoryForgeOptions): ForgeWorld {
  const changes: ChangeRequest[] = [];
  const checks = new Map<number, ChecksSummary>();
  const conflicting = new Set<number>();
  const receipts = new Map<string, number>();
  let failing = false;
  const down = <T>(): PluginResult<T> => fail("unavailable", "memory forge: down");
  const byId = (id: number) => changes.find((c) => c.id === id);
  const copy = (c: ChangeRequest): ChangeRequest => ({ ...c });

  const forge: Forge = {
    name: "memory",
    capabilities: { draft: true, checks: true, raw_urls: true },
    findChanges: async (branches) => {
      if (failing) return down();
      const out: Record<string, ChangeRequest | null> = {};
      for (const b of branches) {
        const of = changes.filter((c) => c.head_branch === b);
        const pick = opts.oldestFirst ? of[0] : of[of.length - 1];
        out[b] = pick ? copy(pick) : null;
      }
      return ok(out);
    },
    checks: async (id) => (failing ? down() : ok(checks.get(id) ?? "none")),
    checkReport: async (id) => {
      if (failing) return down();
      if (!byId(id)) return fail("not_found", `memory forge: no change ${id}`);
      const summary = checks.get(id) ?? "none";
      return ok({ summary, failed: summary === "failure" ? [{ name: "test", url: `memory://changes/${id}/checks/test` }] : [], conflicts: conflicting.has(id) });
    },
    fileUrl: async (commit, path, form) => {
      if (failing) return down();
      return ok(`memory://files/${opts.unpinned ? "latest" : commit}/${path}${form === "image" ? "?raw=true" : ""}`);
    },
    perform: async (effect, meta) => {
      if (failing) return down();
      if (!validateForgeEffect(effect).ok) return fail("invalid", "memory forge: malformed effect");
      const seen = receipts.get(meta.receipt_id);
      const replay = seen !== undefined ? byId(seen) : undefined;
      if (replay) return ok<ForgeEffectOutcome>({ kind: effect.kind, change: copy(replay), replayed: true });
      let c: ChangeRequest | undefined;
      if (effect.kind === "open") {
        c = { id: changes.length + 1, url: `memory://changes/${changes.length + 1}`, state: "open", draft: effect.draft, head_branch: effect.head, base_branch: effect.base, head_sha: "0".repeat(40), title: effect.title };
        changes.push(c);
      } else {
        c = byId(effect.id);
        if (!c) return fail("not_found", `memory forge: no change ${effect.id}`);
        if (effect.kind === "update" && effect.title !== undefined) c.title = effect.title;
        if (effect.kind === "ready") c.draft = false;
      }
      receipts.set(meta.receipt_id, c.id);
      return ok<ForgeEffectOutcome>({ kind: effect.kind, change: copy(c), replayed: false });
    },
  };

  return {
    forge,
    failing: (on) => {
      failing = on;
    },
    merge: async (id, sha) => {
      const c = byId(id);
      if (c) Object.assign(c, { state: "merged", merge_sha: sha, merged_at: opts.now() });
    },
    close: async (id) => {
      const c = byId(id);
      if (c) c.state = "closed";
    },
    setChecks: async (id, summary) => {
      checks.set(id, summary);
    },
    setConflicts: async (id, on) => {
      if (on) conflicting.add(id);
      else conflicting.delete(id);
    },
  };
}

/** No forge: no branch has a change, and every effect is refused. */
export function absentForge(): ForgeWorld {
  let failing = false;
  return {
    forge: {
      name: "absent",
      capabilities: { draft: false, checks: false, raw_urls: false },
      findChanges: async (branches) => (failing ? fail("unavailable", "down") : ok(Object.fromEntries(branches.map((b) => [b, null])))),
      checks: async () => ok("none"),
      perform: async (effect) => fail("invalid", `no forge: cannot ${effect.kind}`),
    },
    failing: (on) => {
      failing = on;
    },
  };
}
