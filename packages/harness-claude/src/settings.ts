/**
 * norn's hook entries in a Claude Code settings object, merged in and stripped out. Pure. An entry
 * is norn's by the marker its command ends with, so a person's own hooks are never touched.
 */
import { CLAUDE_HOOKS, MATCHED_HOOKS } from "./hooks.ts";
import { isObject, type JsonObject } from "./payload.ts";

export const NORN_MARKER = "# norn-owned";

// the hook command already names the harness (`norn hook claude`): only the hook's own name follows it
export const hookCommandFor = (hookCommand: string, hook: string) => `${hookCommand} ${hook} ${NORN_MARKER}`;

const isNornHook = (h: unknown) => isObject(h) && typeof h.command === "string" && h.command.trimEnd().endsWith(NORN_MARKER);

/** A settings file's `hooks` must be an object of arrays; anything else is not guessed at. */
function hooksOf(settings: JsonObject): JsonObject {
  if (settings.hooks === undefined) return {};
  if (!isObject(settings.hooks)) throw new Error("Claude Code settings: `hooks` is not an object");
  return settings.hooks;
}

function stripGroups(groups: unknown[]): unknown[] {
  return groups.flatMap((g) => {
    if (!isObject(g) || !Array.isArray(g.hooks) || !g.hooks.some(isNornHook)) return [g];
    const rest = g.hooks.filter((h) => !isNornHook(h));
    return rest.length > 0 ? [{ ...g, hooks: rest }] : [];
  });
}

/** Settings without norn's entries; groups, events and the `hooks` key left empty are dropped. */
export function removeNornHooks(settings: JsonObject): JsonObject {
  const hooks: JsonObject = {};
  for (const [event, groups] of Object.entries(hooksOf(settings))) {
    const kept = Array.isArray(groups) ? stripGroups(groups) : groups;
    if (!Array.isArray(kept) || kept.length > 0) hooks[event] = kept;
  }
  return withHooks(settings, hooks);
}

/** `settings` with `hooks` replaced where it stood, so a person's key order survives; empty drops it. */
function withHooks(settings: JsonObject, hooks: JsonObject): JsonObject {
  const keep = Object.keys(hooks).length > 0;
  const out: JsonObject = {};
  for (const [k, v] of Object.entries(settings)) {
    if (k !== "hooks") out[k] = v;
    else if (keep) out.hooks = hooks;
  }
  if (keep && !("hooks" in out)) out.hooks = hooks;
  return out;
}

/** Settings with exactly one norn entry per wired hook, after the person's own. */
export function mergeNornHooks(settings: JsonObject, hookCommand: string): JsonObject {
  const base = removeNornHooks(settings);
  const hooks: JsonObject = { ...hooksOf(base) };
  for (const hook of CLAUDE_HOOKS) {
    const existing = hooks[hook];
    if (existing !== undefined && !Array.isArray(existing)) throw new Error(`Claude Code settings: \`hooks.${hook}\` is not a list`);
    const group = { ...(MATCHED_HOOKS.has(hook) && { matcher: "*" }), hooks: [{ type: "command", command: hookCommandFor(hookCommand, hook) }] };
    hooks[hook] = [...(existing ?? []), group];
  }
  return withHooks(settings, hooks);
}
