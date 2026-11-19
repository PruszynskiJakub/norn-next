/**
 * Forge "none": changes for a repo without a code host. Opening a change writes a local record; a
 * person reviews and merges with git, and the forge sees the merge in git. Like every forge it is
 * never a state store: the record says what was opened, never whether a step finished.
 */
import {
  type ChangeRequest,
  type ChangeRequestState,
  fail,
  type Forge,
  type ForgeEffect,
  type ForgeEffectOutcome,
  type HostContext,
  ok,
  type PluginResult,
  validateForgeEffect,
} from "@norn/plugin-api";
import { type Observed, observe, toChange } from "./observe.ts";
import { type ChangeRecord, encode, io, readAll, readRecord, recordPath } from "./record.ts";
import { baseTip, revParse } from "./git.ts";

/** How many taken ids `open` steps past before giving up: only racing writers take them. */
const ALLOCATE_TRIES = 16;

/** Write the record when a look changed it (a merge seen for the first time). */
async function keep(ctx: HostContext, before: ChangeRecord, o: Observed): Promise<PluginResult<Observed>> {
  if (o.record === before) return ok(o);
  const path = recordPath(ctx, o.record.id);
  const w = await io(`write ${path}`, () => ctx.files.write(path, encode(o.record)));
  return w.ok ? ok(o) : w;
}

async function look(ctx: HostContext, rec: ChangeRecord): Promise<PluginResult<Observed>> {
  const o = await observe(ctx, rec);
  return o.ok ? keep(ctx, rec, o.value) : o;
}

function outcome(kind: ForgeEffect["kind"], o: Observed, replayed: boolean): PluginResult<ForgeEffectOutcome> {
  return ok({ kind, change: toChange(o), replayed });
}

/** A ref name git would read as an option. */
const optionLike = (ref: string): boolean => ref.startsWith("-");

async function open(ctx: HostContext, e: Extract<ForgeEffect, { kind: "open" }>, receipt: string): Promise<PluginResult<ForgeEffectOutcome>> {
  const all = await readAll(ctx);
  if (!all.ok) return all;
  const seen = all.value.find((r) => r.receipts.includes(receipt));
  if (seen) {
    const o = await look(ctx, seen);
    return o.ok ? outcome("open", o.value, true) : o;
  }
  if (optionLike(e.head) || optionLike(e.base)) return fail("invalid", `forge none: ${e.head} or ${e.base} is not a branch name`, false);
  const head = await revParse(ctx, e.head);
  if (!head.ok) return head;
  if (head.value === null) return fail("not_found", `forge none: no branch ${e.head}`, false);
  const base = await baseTip(ctx, e.base);
  if (!base.ok) return base;
  if (base.value === null) return fail("not_found", `forge none: no branch ${e.base}`, false);
  let id = all.value.reduce((m, r) => Math.max(m, r.id), 0) + 1;
  for (let i = 0; i < ALLOCATE_TRIES; i++, id++) {
    const rec: ChangeRecord = {
      id,
      head_branch: e.head,
      base_branch: e.base,
      title: e.title,
      body: e.body,
      draft: e.draft,
      opened_at: ctx.now(),
      receipts: [receipt],
      base_sha_at_open: base.value,
      head_sha: head.value,
    };
    const path = recordPath(ctx, id);
    // exclusive create, so two writers racing for one id cannot both open change `id`
    const made = await io(`create ${path}`, () => ctx.files.create(path, encode(rec)));
    if (!made.ok) return made;
    if (!made.value) continue;
    const o = await look(ctx, rec);
    return o.ok ? outcome("open", o.value, false) : o;
  }
  return fail("conflict", `forge none: change ids ${id - ALLOCATE_TRIES}..${id - 1} were all taken`);
}

async function change(ctx: HostContext, e: Exclude<ForgeEffect, { kind: "open" }>, receipt: string): Promise<PluginResult<ForgeEffectOutcome>> {
  const rec = await readRecord(ctx, e.id);
  if (!rec.ok) return rec;
  if (rec.value === null) return fail("not_found", `forge none: no change ${e.id}`, false);
  // look before writing: a git failure then leaves the record as it was
  const o = await observe(ctx, rec.value);
  if (!o.ok) return o;
  if (rec.value.receipts.includes(receipt)) {
    const kept = await keep(ctx, rec.value, o.value);
    return kept.ok ? outcome(e.kind, kept.value, true) : kept;
  }
  const state: ChangeRequestState = o.value.state;
  if (e.kind === "ready" && state !== "open") return fail("conflict", `forge none: change ${e.id} is ${state}`, false);
  const next: ChangeRecord = { ...o.value.record, receipts: [...o.value.record.receipts, receipt] };
  if (e.kind === "ready") next.draft = false;
  if (e.kind === "update") {
    if (e.title !== undefined) next.title = e.title;
    if (e.body !== undefined) next.body = e.body;
  }
  const kept = await keep(ctx, rec.value, { ...o.value, record: next });
  return kept.ok ? outcome(e.kind, kept.value, false) : kept;
}

export function noneForge(ctx: HostContext): Forge {
  return {
    name: "none",
    capabilities: { draft: true, checks: false, raw_urls: false },
    findChanges: async (branches) => {
      if (branches.length === 0) return ok({});
      const all = await readAll(ctx);
      if (!all.ok) return all;
      const out: Record<string, ChangeRequest | null> = {};
      for (const b of branches) {
        // readAll is oldest first, so the last match is the newest change of the branch
        const rec = all.value.findLast((r) => r.head_branch === b);
        if (!rec) {
          out[b] = null;
          continue;
        }
        const o = await look(ctx, rec);
        if (!o.ok) return o;
        out[b] = toChange(o.value);
      }
      return ok(out);
    },
    checks: async (id) => {
      const rec = await readRecord(ctx, id);
      if (!rec.ok) return rec;
      return rec.value === null ? fail("not_found", `forge none: no change ${id}`, false) : ok("none");
    },
    perform: async (effect, meta) => {
      const v = validateForgeEffect(effect);
      if (!v.ok) return fail("invalid", `forge none: ${v.errors.map((x) => `${x.path || "/"} ${x.message}`).join("; ")}`, false);
      return v.value.kind === "open" ? open(ctx, v.value, meta.receipt_id) : change(ctx, v.value, meta.receipt_id);
    },
  };
}
