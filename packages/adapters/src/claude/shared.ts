/**
 * Helpers shared by the agent adapters (claude, codex, gemini, opencode). Claude Code, Codex and
 * Gemini CLI all use the same hook config shape:
 *   { "hooks": { "<Event>": [ { "matcher"?: "...", "hooks": [ { "type": "command", "command": "..." } ] } ] } }
 * so one merge/unmerge implementation serves all three (A1).
 */
import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { HookFact, HookEventKind } from "@norn/schema";
import { SLICE_KEY_PATTERN, STORY_KEY_PATTERN, ULID_PATTERN, validateHookFact } from "@norn/schema";
import type { AgentLaunchRequest, PortError } from "@norn/core";

/** A1: every norn-installed hook command ends with this shell comment; it is the ownership marker. */
export const NORN_HOOK_MARKER = "# norn-owned";

export function portError(code: string, message: string, retryable = false): PortError {
  return Object.assign(new Error(message), { code, retryable });
}

// ------------------------------------------------------------------ files

/** S1: temp file in the same dir → fsync → rename. (Store has no generic helper yet.) */
export function atomicWrite(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  const fd = openSync(tmp, "w");
  try {
    writeSync(fd, content);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, path);
}

function readText(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}

export type JsonObject = Record<string, unknown>;

const isObject = (v: unknown): v is JsonObject => typeof v === "object" && v !== null && !Array.isArray(v);

/** Read a JSON object file; missing → {}; invalid → PortError (never guess, S2). */
export function readJsonObject(path: string): JsonObject {
  const text = readText(path);
  if (text === null || text.trim() === "") return {};
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    throw portError("invalid_json", `${path} is not valid JSON; fix or remove it, then re-run`);
  }
  if (!isObject(v)) throw portError("invalid_json", `${path} must contain a JSON object`);
  return v;
}

/** Write `next` if its serialization differs from the file; returns true when written. */
export function writeJsonIfChanged(path: string, next: JsonObject): boolean {
  const text = `${JSON.stringify(next, null, 2)}\n`;
  if (readText(path) === text) return false;
  atomicWrite(path, text);
  return true;
}

// ------------------------------------------------------------------ hook config merge

export interface HookSpec {
  /** native event name, e.g. `Stop` */
  native: string;
  /** argument to `norn hook <arg>` */
  arg: string;
  /** set for tool events (matches every tool) */
  matcher?: string;
  /** extra fields on the hook entry (e.g. Gemini `name`, `timeout`) */
  extra?: JsonObject;
}

/** `<hookCommand> <arg> --agent <agent> # norn-owned`; agent names are `[a-z][a-z0-9_-]*` (config schema), shell-safe. */
export const hookCommandFor = (hookCommand: string, arg: string, agent: string) => `${hookCommand} ${arg} --agent ${agent} ${NORN_HOOK_MARKER}`;

const isNornHook = (h: unknown) => isObject(h) && typeof h.command === "string" && h.command.endsWith(NORN_HOOK_MARKER);

const hasNorn = (g: unknown) => isObject(g) && Array.isArray(g.hooks) && g.hooks.some(isNornHook);

/** Strip norn entries from a group list; groups left empty are dropped. */
function stripGroups(groups: unknown[]): unknown[] {
  return groups.flatMap((g) => {
    if (!hasNorn(g)) return [g];
    const rest = ((g as JsonObject).hooks as unknown[]).filter((h) => !isNornHook(h));
    return rest.length > 0 ? [{ ...(g as JsonObject), hooks: rest }] : [];
  });
}

/**
 * Remove norn-owned hook entries (all events, or those `which` selects); drop groups, events and
 * the `hooks` key when left empty. User hooks and key order are preserved. Pure.
 */
export function removeNornHooks(settings: JsonObject, which: (event: string) => boolean = () => true): JsonObject {
  if (!isObject(settings.hooks)) return settings;
  const hooks: JsonObject = {};
  for (const [event, groups] of Object.entries(settings.hooks)) {
    if (!Array.isArray(groups) || !which(event)) {
      hooks[event] = groups;
      continue;
    }
    const kept = stripGroups(groups);
    if (kept.length > 0) hooks[event] = kept;
  }
  const out = { ...settings };
  if (Object.keys(hooks).length > 0) out.hooks = hooks;
  else delete out.hooks;
  return out;
}

/**
 * Add or update norn hooks (A1). An existing norn group is replaced at its position, new ones are
 * appended after the user's groups; norn entries under events no longer installed are removed.
 * User hooks are untouched. Idempotent and pure.
 */
export function mergeNornHooks(settings: JsonObject, specs: HookSpec[], hookCommand: string, agent: string): JsonObject {
  const wanted = new Set(specs.map((s) => s.native));
  const base = removeNornHooks(settings, (e) => !wanted.has(e));
  const hooks: JsonObject = isObject(base.hooks) ? { ...base.hooks } : {};
  for (const spec of specs) {
    const entry = { type: "command", command: hookCommandFor(hookCommand, spec.arg, agent), ...(spec.extra ?? {}) };
    const group: JsonObject = { ...(spec.matcher !== undefined ? { matcher: spec.matcher } : {}), hooks: [entry] };
    const groups = Array.isArray(hooks[spec.native]) ? (hooks[spec.native] as unknown[]) : [];
    const at = groups.findIndex(hasNorn);
    const rest = stripGroups(groups);
    // position among the remaining groups: count user groups that came before the old norn group
    const pos = at < 0 ? rest.length : stripGroups(groups.slice(0, at)).length;
    rest.splice(pos, 0, group);
    hooks[spec.native] = rest;
  }
  return { ...base, hooks };
}

/** True iff every spec has a norn-owned entry under its event. */
export function hasNornHooks(settings: JsonObject, specs: HookSpec[]): boolean {
  if (!isObject(settings.hooks)) return false;
  const hooks = settings.hooks;
  return specs.every((s) => Array.isArray(hooks[s.native]) && (hooks[s.native] as unknown[]).some(hasNorn));
}

/** installHooks/uninstallHooks/hooksInstalled over one JSON settings file. */
export function jsonHookInstaller(adapterName: string, settingsPath: (repoRoot: string) => string, specs: HookSpec[]) {
  return {
    async installHooks(repoRoot: string, hookCommand: string, agent: string = adapterName) {
      const path = settingsPath(repoRoot);
      const next = mergeNornHooks(readJsonObject(path), specs, hookCommand, agent);
      return { changed: writeJsonIfChanged(path, next) ? [path] : [] };
    },
    async uninstallHooks(repoRoot: string) {
      const path = settingsPath(repoRoot);
      if (readText(path) === null) return { changed: [] };
      return { changed: writeJsonIfChanged(path, removeNornHooks(readJsonObject(path))) ? [path] : [] };
    },
    async hooksInstalled(repoRoot: string) {
      return hasNornHooks(readJsonObject(settingsPath(repoRoot)), specs);
    },
  };
}

// ------------------------------------------------------------------ hook facts

const str = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined);
export const field = (payload: unknown, key: string): string | undefined => (isObject(payload) ? str(payload[key]) : undefined);
export const objField = (payload: unknown, key: string): JsonObject | undefined =>
  isObject(payload) && isObject(payload[key]) ? (payload[key] as JsonObject) : undefined;

const match = (pattern: string, v: string | undefined) => (v !== undefined && new RegExp(pattern).test(v) ? v : undefined);

/**
 * Build a validated HookFact. Story/slice/run come from the launch env (A6) and are dropped
 * when malformed. Returns null when no cwd is known or the fact does not validate.
 */
export function buildFact(
  parts: { event: HookEventKind; agent: string; native: string; payload: unknown; at: string } & Partial<
    Pick<HookFact, "agent_session_id" | "transcript" | "tool" | "command" | "message">
  >,
  env: Record<string, string | undefined>,
): HookFact | null {
  const cwd = field(parts.payload, "cwd") ?? str(env.PWD);
  if (!cwd) return null;
  const fact: Record<string, unknown> = { event: parts.event, at: parts.at, agent: parts.agent, native: parts.native, cwd };
  const opt: Record<string, string | undefined> = {
    story: match(STORY_KEY_PATTERN, env.NORN_STORY),
    slice: match(SLICE_KEY_PATTERN, env.NORN_SLICE),
    run_id: match(ULID_PATTERN, env.NORN_RUN),
    agent_session_id: str(parts.agent_session_id),
    transcript: str(parts.transcript),
    tool: str(parts.tool),
    command: parts.command,
    message: parts.message,
  };
  for (const [k, v] of Object.entries(opt)) if (v !== undefined) fact[k] = v;
  const r = validateHookFact(fact);
  return r.ok ? r.value : null;
}

/** kebab-case CLI arg for a native event name: `UserPromptSubmit` → `user-prompt-submit`. */
export const kebab = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();

/** Resolve the native event: payload `hook_event_name` wins, else the `norn hook <arg>` argument. */
export function nativeEvent(arg: string, payload: unknown, natives: readonly string[]): string | undefined {
  const fromPayload = field(payload, "hook_event_name");
  if (fromPayload && natives.includes(fromPayload)) return fromPayload;
  return natives.find((n) => n === arg || kebab(n) === arg);
}

// ------------------------------------------------------------------ launch + transcripts

/** Common env merge for launchCommand: config env, then norn env (A6) wins. */
export const launchEnv = (req: AgentLaunchRequest) => ({ ...(req.config.env ?? {}), ...req.env });

/** Read a JSONL file; unparsable lines are skipped. null if the file is unreadable. */
export async function readJsonl(path: string): Promise<JsonObject[] | null> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    return null;
  }
  const out: JsonObject[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const v = JSON.parse(line);
      if (isObject(v)) out.push(v);
    } catch {
      // partial trailing line while the agent is writing — ignore
    }
  }
  return out;
}

export async function readJsonFile(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return null;
  }
}

/** Concatenate text parts of a content value (string, or array of {type,text}). */
export function textOf(content: unknown, types: readonly string[] = ["text"]): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((p): p is JsonObject => isObject(p) && typeof p.text === "string" && (p.type === undefined || types.includes(p.type as string)))
    .map((p) => p.text as string)
    .join("\n");
}

export { isObject };
