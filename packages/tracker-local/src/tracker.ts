/**
 * The local tracker: items as files in a folder, for a repo with no host. Like every tracker it is
 * never a state store: it holds what a person would see on an issue (title, body, labels, comments),
 * and norn's run state never lives here.
 */
import {
  type EffectMeta,
  fail,
  formatStoryKey,
  type HostContext,
  ok,
  type PluginResult,
  type Tracker,
  type TrackerEffect,
  type TrackerEffectOutcome,
  type TrackerItem,
  validateTrackerEffect,
} from "@norn/plugin-api";
import { DEFAULT_KEY_PREFIX, type LocalTrackerConfig } from "./config.ts";
import { type ItemFile, isReceiptId, parseItem, renderItem } from "./item-file.ts";

const NAME = "local";
const ITEM_FILE_RE = /^([1-9][0-9]*)\.md$/;
/** How many taken ids create steps past before it gives up; each miss means another creator won that id. */
const CREATE_ATTEMPTS = 64;
const WHOAMI_TIMEOUT_MS = 5000;

type Held = { id: number; path: string; item: ItemFile };

const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export function createLocalTracker(ctx: HostContext, config: LocalTrackerConfig): Tracker {
  const keyPrefix = config.keyPrefix ?? DEFAULT_KEY_PREFIX;
  const dir = (config.dir ?? `${ctx.repo.dataDir}/tracker`).replace(/\/+$/, "");
  const pathOf = (id: number) => `${dir}/${id}.md`;
  const keyOf = (id: number) => formatStoryKey(keyPrefix, id);

  /** Every IO rejection becomes a failure here, since a provider call never throws. */
  async function io<T>(what: string, fn: () => Promise<T>): Promise<PluginResult<T>> {
    try {
      return ok(await fn());
    } catch (e) {
      return fail("unavailable", `local tracker: ${what}: ${errText(e)}`);
    }
  }

  async function readHeld(id: number): Promise<PluginResult<Held | null>> {
    const path = pathOf(id);
    const text = await io(`read ${path}`, () => ctx.files.read(path));
    if (!text.ok) return text;
    if (text.value === null) return ok(null);
    const parsed = parseItem(text.value);
    // a file norn cannot read is named for a person to fix; reading past it could act on a wrong item
    if (!parsed.ok) return fail("invalid", `local tracker: malformed item file ${path}: ${parsed.problem}`, false);
    return ok({ id, path, item: parsed.value });
  }

  async function ids(): Promise<PluginResult<number[]>> {
    const names = await io(`list ${dir}`, () => ctx.files.list(dir));
    if (!names.ok) return names;
    const out: number[] = [];
    for (const n of names.value) {
      const m = ITEM_FILE_RE.exec(n);
      if (m && Number.isSafeInteger(Number(m[1]))) out.push(Number(m[1]));
    }
    return ok(out.sort((a, b) => a - b));
  }

  async function readAll(): Promise<PluginResult<Held[]>> {
    const all = await ids();
    if (!all.ok) return all;
    const out: Held[] = [];
    for (const id of all.value) {
      const h = await readHeld(id);
      if (!h.ok) return h;
      if (h.value) out.push(h.value);
    }
    return ok(out);
  }

  const view = (h: Held): TrackerItem => ({
    id: h.id,
    key: keyOf(h.id),
    title: h.item.frontmatter.title,
    body: h.item.body,
    open: h.item.frontmatter.open,
    assignees: [...h.item.frontmatter.assignees],
    labels: [...h.item.frontmatter.labels],
    updated_at: h.item.frontmatter.updated_at,
  });

  const outcome = (kind: TrackerEffect["kind"], id: number | undefined, replayed: boolean): TrackerEffectOutcome => ({
    kind,
    replayed,
    ...(id !== undefined && { id, key: keyOf(id) }),
  });

  async function whoami(): Promise<PluginResult<string>> {
    if (config.user) return ok(config.user);
    let out: Awaited<ReturnType<HostContext["exec"]>>;
    try {
      out = await ctx.exec(["git", "config", "user.email"], { cwd: ctx.repo.root, timeoutMs: WHOAMI_TIMEOUT_MS });
    } catch (e) {
      return fail("unavailable", `local tracker: git config user.email: ${errText(e)}`);
    }
    const email = out.stdout.trim();
    if (out.code === 0 && !out.timedOut && email) return ok(email);
    return fail("auth", "local tracker: no user: set `user` in the tracker config or `git config user.email`", false);
  }

  async function create(effect: Extract<TrackerEffect, { kind: "create" }>, receipt: string): Promise<PluginResult<TrackerEffectOutcome>> {
    // the receipt can be on any item, and an unreadable file might be the one holding it
    const all = await readAll();
    if (!all.ok) return all;
    const made = all.value.find((h) => h.item.frontmatter.receipts[receipt] !== undefined);
    if (made) return ok(outcome("create", made.id, true));
    const at = ctx.now();
    const text = renderItem({
      frontmatter: {
        title: effect.title,
        open: true,
        assignees: effect.assignee ? [effect.assignee] : [],
        labels: [...new Set(effect.labels)],
        created_at: at,
        updated_at: at,
        receipts: { [receipt]: "create" },
      },
      body: effect.body,
      comments: [],
    });
    let id = Math.max(0, ...all.value.map((h) => h.id)) + 1;
    for (let attempt = 0; attempt < CREATE_ATTEMPTS; attempt++, id++) {
      const path = pathOf(id);
      // exclusive create is the id allocation: two creators racing for one id cannot both win it
      const won = await io(`create ${path}`, () => ctx.files.create(path, text));
      if (!won.ok) return won;
      if (won.value) return ok(outcome("create", id, false));
    }
    return fail("conflict", `local tracker: no free item id after ${CREATE_ATTEMPTS} attempts in ${dir}`);
  }

  /** Apply an item effect to the item just read; true when what a person sees changed. */
  function apply(item: ItemFile, effect: Exclude<TrackerEffect, { kind: "create" | "ensure_labels" }>, receipt: string, at: string): boolean {
    const fm = item.frontmatter;
    switch (effect.kind) {
      case "assign":
        if (fm.assignees.includes(effect.user)) return false;
        fm.assignees = [...fm.assignees, effect.user];
        return true;
      case "comment":
        item.comments = [...item.comments, { receipt_id: receipt, at, body: effect.body }];
        return true;
      case "close":
        if (!fm.open) return false;
        fm.open = false;
        return true;
      case "labels": {
        const next = [...fm.labels.filter((l) => !effect.remove.includes(l))];
        for (const l of effect.add) if (!next.includes(l)) next.push(l);
        const changed = next.length !== fm.labels.length || next.some((l, i) => l !== fm.labels[i]);
        fm.labels = next;
        return changed;
      }
    }
  }

  async function perform(effect: TrackerEffect, meta: EffectMeta): Promise<PluginResult<TrackerEffectOutcome>> {
    const valid = validateTrackerEffect(effect);
    if (!valid.ok) return fail("invalid", `local tracker: malformed effect: ${valid.errors.map((e) => `${e.path || "/"} ${e.message}`).join("; ")}`, false);
    if (!isReceiptId(meta?.receipt_id ?? "")) return fail("invalid", `local tracker: unusable receipt id ${JSON.stringify(meta?.receipt_id)}`, false);
    const receipt = meta.receipt_id;
    if (effect.kind === "ensure_labels") {
      // labels exist on an item the moment it carries them, so there is nothing to define; the folder is
      // still read, so an unreachable tracker answers with a failure rather than a success it cannot back
      const reachable = await ids();
      return reachable.ok ? ok(outcome("ensure_labels", undefined, false)) : reachable;
    }
    if (effect.kind === "create") return create(effect, receipt);
    const held = await readHeld(effect.id);
    if (!held.ok) return held;
    if (!held.value) return fail("not_found", `local tracker: no item ${keyOf(effect.id)} (${pathOf(effect.id)})`, false);
    const { item, path } = held.value;
    if (item.frontmatter.receipts[receipt] !== undefined) return ok(outcome(effect.kind, effect.id, true));
    const at = ctx.now();
    const changed = apply(item, effect, receipt, at);
    item.frontmatter.receipts = { ...item.frontmatter.receipts, [receipt]: effect.kind };
    if (changed) item.frontmatter.updated_at = at;
    // one write carries the change and its receipt, so a replay never finds one without the other
    const written = await io(`write ${path}`, () => ctx.files.write(path, renderItem(item)));
    if (!written.ok) return written;
    return ok(outcome(effect.kind, effect.id, false));
  }

  return {
    name: NAME,
    keyPrefix,
    capabilities: { assign: true, labels: true, comment: true, create: true, close: true },
    whoami,
    intake: async (q) => {
      let who: string | null = q.assignee;
      if (q.assignee === "me") {
        const me = await whoami();
        if (!me.ok) return me;
        who = me.value;
      }
      const all = await readAll();
      if (!all.ok) return all;
      return ok(
        all.value
          .filter(({ item: { frontmatter: fm } }) => fm.open && fm.labels.includes(q.label) && (who === null || fm.assignees.includes(who)))
          .map(view),
      );
    },
    get: async (id) => {
      if (!Number.isSafeInteger(id) || id < 1) return ok(null);
      const h = await readHeld(id);
      if (!h.ok) return h;
      return ok(h.value ? view(h.value) : null);
    },
    perform,
  };
}
