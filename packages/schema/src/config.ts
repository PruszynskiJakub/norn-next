/**
 * Configuration in three files (K2, gh-64): the user file `~/.norn/config.yaml` (this machine
 * and your defaults), the local file `.agents/norn.config.local.yaml` (you, in this repo) and the
 * team file `.agents/norn.config.yaml`. Each takes its own keys; everything else is built in,
 * derived or fixed. `resolveConfig` merges them with the derived values into the one
 * `ResolvedConfig` decide, the views and the commands read, and explains where each value came from.
 */
import { type Static, type TSchema, Type } from "@sinclair/typebox";
import { Duration, Mode, NonEmpty, RemoteProvider } from "./common.ts";
import { parseDuration } from "./ids.ts";
import { check, type SchemaError } from "./check.ts";

// ---------------------------------------------------------------- names and fixed values

/** The coding agents norn ships (X2: no third-party agents). */
export const AGENT_NAMES = ["claude", "codex", "opencode", "gemini"] as const;
export type AgentName = (typeof AGENT_NAMES)[number];
export const isAgentName = (n: unknown): n is AgentName => typeof n === "string" && (AGENT_NAMES as readonly string[]).includes(n);

/** B33: slots 1–9, 10 ports each, slot `n` from port `4000 + 10·n`. */
export const SLOTS = { min: 1, max: 9, port_base: 4000, ports_per_slot: 10 } as const;
/** B30: the label marking issues norn takes in (GR1). */
export const ISSUE_LABEL = "norn";
/** B32: how often the remote is synced (GR1); `norn sync` forces one. */
export const SYNC_INTERVAL = "5m";
/** B27, HC2: an attended run waiting this long for its person shows under Your turn. */
export const ATTENDED_WAIT = "2m";
/** B34: the tick interval when none is recorded. */
export const DEFAULT_INTERVAL = "30s";
/** W2a: the limits of a step whose workflow and step set none. */
export const BUILT_IN_LIMITS = { deadline: "60m", nudges: 2, retries: 1, stalled: "15m" } as const;

/** Where each file lives, as a person names it in a message. */
export const CONFIG_FILES = {
  user: "~/.norn/config.yaml",
  local: ".agents/norn.config.local.yaml",
  repo: ".agents/norn.config.yaml",
} as const;
export type ConfigFileKind = keyof typeof CONFIG_FILES;

// ---------------------------------------------------------------- the three file schemas

const Url = Type.String({ pattern: "^https?://\\S+$", description: "http or https URL" });

export const AgentEntry = Type.Object(
  {
    model: Type.Optional(NonEmpty),
    /** replaces the built-in list whole (B15) */
    args: Type.Optional(Type.Array(Type.String())),
  },
  { additionalProperties: false },
);
export type AgentEntry = Static<typeof AgentEntry>;

const AgentNameSchema = Type.Union(
  AGENT_NAMES.map((n) => Type.Literal(n)),
  { description: "claude, codex, opencode or gemini" },
);
const Agents = Type.Object(
  { claude: Type.Optional(AgentEntry), codex: Type.Optional(AgentEntry), opencode: Type.Optional(AgentEntry), gemini: Type.Optional(AgentEntry) },
  { additionalProperties: false, description: "per agent: model and args, merged over the built-in entry" },
);

const personal = {
  mode: Type.Optional(Mode),
  agent: Type.Optional(AgentNameSchema),
  agents: Type.Optional(Agents),
};

export const Notify = Type.Object(
  {
    /** OS notifications, on unless false */
    os: Type.Optional(Type.Boolean()),
    ntfy: Type.Optional(Url),
    webhook: Type.Optional(Url),
  },
  { additionalProperties: false },
);
export type Notify = Static<typeof Notify>;

export const TraceConfig = Type.Object(
  {
    /**
     * D11: how much trace `norn tidy` keeps, a duration like `14d`. A plain string here: the form and
     * the 14-day minimum are checked where the value is used (`norn tidy` refuses, `norn doctor` warns).
     */
    retain: Type.Optional(Type.String({ minLength: 1, description: "Duration like 14d, at least 14d (checked by norn tidy and norn doctor)" })),
  },
  { additionalProperties: false },
);

/** `~/.norn/config.yaml`: this machine and your defaults for every repo. */
export const UserConfig = Type.Object(
  {
    $schema: Type.Optional(Type.String()),
    max_agents: Type.Optional(Type.Integer({ minimum: 1, maximum: 9, description: "agent sessions at once on this machine, 1–9 (there are 9 slots)" })),
    notify: Type.Optional(Notify),
    trace: Type.Optional(TraceConfig),
    ...personal,
  },
  { $id: "https://norn.dev/schema/user-config.json", title: "norn user config: this machine and your defaults", additionalProperties: false },
);
export type UserConfig = Static<typeof UserConfig>;

/** `.agents/norn.config.local.yaml`: you, in this repo (gitignored). */
export const LocalConfig = Type.Object(
  { $schema: Type.Optional(Type.String()), ...personal },
  { $id: "https://norn.dev/schema/local-config.json", title: "norn local config: you, in this repo", additionalProperties: false },
);
export type LocalConfig = Static<typeof LocalConfig>;

/** `.agents/norn.config.yaml`: the team (committed). */
export const RepoConfig = Type.Object(
  {
    $schema: Type.Optional(Type.String()),
    provider: Type.Optional(RemoteProvider),
    /** BS0: the branch stories are cut from and PR'd into; unset = the remote's default branch */
    base_branch: Type.Optional(Type.Union([NonEmpty, Type.Null()])),
    workflow: Type.Optional(Type.String({ pattern: "^[a-z][a-z0-9_-]*$", description: "workflow a new story starts in (default triage)" })),
    slice_workflow: Type.Optional(Type.String({ pattern: "^[a-z][a-z0-9_-]*$", description: "workflow a new slice starts in (default slice)" })),
  },
  { $id: "https://norn.dev/schema/repo-config.json", title: "norn team config", additionalProperties: false },
);
export type RepoConfig = Static<typeof RepoConfig>;

export const CONFIG_SCHEMAS: Record<ConfigFileKind, TSchema> = { user: UserConfig, local: LocalConfig, repo: RepoConfig };

export interface ConfigFiles {
  user?: UserConfig;
  local?: LocalConfig;
  repo?: RepoConfig;
}

// ---------------------------------------------------------------- the resolved config

const RunnerName = Type.Union([Type.Literal("herdr"), Type.Literal("headless")]);

/** Every setting in effect: the files merged over the built-in values, plus what norn derives. */
export const ResolvedConfig = Type.Object(
  {
    /** the agent for steps that name none */
    agent: Type.String({ minLength: 1 }),
    agents: Type.Record(Type.String(), AgentEntry),
    mode: Mode,
    /** B29: detected (herdr inside Herdr or when installed, else headless) */
    runner: Type.Object({ adapter: RunnerName }, { additionalProperties: false }),
    provider: RemoteProvider,
    label: NonEmpty,
    /** B31: derived git remote */
    git_remote: NonEmpty,
    sync_interval: Duration,
    base_branch: Type.Union([NonEmpty, Type.Null()]),
    workflow: NonEmpty,
    slice_workflow: NonEmpty,
    max_agents: Type.Integer({ minimum: 1, maximum: 9 }),
    notify: Type.Object({ os: Type.Boolean(), ntfy: Type.Optional(Url), webhook: Type.Optional(Url) }, { additionalProperties: false }),
    /** B34: the tick interval the checkout's heartbeat records */
    interval: Duration,
    /** B35: derived from `interval` */
    claim: Type.Object({ lease: Duration, renew: Duration }, { additionalProperties: false }),
    trace: Type.Object({ retain: Type.String({ minLength: 1 }) }, { additionalProperties: false }),
  },
  { additionalProperties: false },
);
export type ResolvedConfig = Static<typeof ResolvedConfig>;

/**
 * Built-in agent entries. Claude sessions run in Claude Code's `auto` permission mode (AGENTS.md
 * decision; per-step permission profiles are not built, docs/limitations.md). A file's entry merges over this field by field; `args` replaces whole (B14, B15).
 */
export const BUILT_IN_AGENTS: Record<string, AgentEntry> = { claude: { args: ["--permission-mode", "auto"] } };

/** What norn derives from the machine and the repo (D1); gathered by the cli context. */
export interface ConfigDerived {
  runner: { adapter: "herdr" | "headless"; reason: string };
  /** the URL of the derived git remote; null when the repo has none */
  remote_url: string | null;
  git_remote: { name: string; reason: string };
  /** the tick interval the heartbeat records; null = none recorded */
  interval: string | null;
}

export const NO_DERIVED: ConfigDerived = {
  runner: { adapter: "headless", reason: "herdr not on PATH" },
  remote_url: null,
  git_remote: { name: "origin", reason: "no tracking remote" },
  interval: null,
};

/** Fully built-in values with nothing derived from a machine: tests and pure fallbacks. */
export const DEFAULT_CONFIG: ResolvedConfig = {
  agent: "claude",
  agents: structuredClone(BUILT_IN_AGENTS),
  mode: "manual",
  runner: { adapter: "headless" },
  provider: "gh",
  label: ISSUE_LABEL,
  git_remote: "origin",
  sync_interval: SYNC_INTERVAL,
  base_branch: null,
  workflow: "triage",
  slice_workflow: "slice",
  max_agents: 9,
  notify: { os: true },
  interval: DEFAULT_INTERVAL,
  claim: { lease: "10m", renew: "3m20s" },
  trace: { retain: "14d" },
};

/** How wiring selects one built-in runner or notifier adapter (not a config file key). */
export interface RunnerConfig {
  adapter: string;
  options?: Record<string, unknown>;
}
export type NotifierConfig = RunnerConfig;

// ---------------------------------------------------------------- problems

export type ConfigProblemCode = "config_invalid" | "config_wrong_file" | "config_moved";

export interface ConfigProblem {
  code: ConfigProblemCode;
  /** the file with the problem */
  file: ConfigFileKind;
  /** dotted key path */
  key: string;
  /** what is wrong, naming the key (no file) */
  message: string;
}

/** `` `file`: message `` */
export const problemText = (p: ConfigProblem) => `\`${CONFIG_FILES[p.file]}\`: ${p.message}`;

const MIGRATE = "; run `norn migrate`";

/** B39: every old or moved key and what replaced it (D2: checked first). */
const MOVED: Record<string, string> = {
  default_agent: "`default_agent` is now `agent`",
  default_mode: "`default_mode` is now `mode`",
  default_workflow: "`default_workflow` is now `workflow`",
  default_slice_workflow: "`default_slice_workflow` is now `slice_workflow`",
  "remote.provider": "`remote.provider` is now `provider`",
  "remote.label": "`remote.label` is gone: the label is always `norn`",
  "remote.git_remote": "`remote.git_remote` is gone: norn uses the remote the base branch tracks",
  "remote.host": "`remote.host` is gone: norn reads the host from the remote URL",
  "remote.sync_interval": "`remote.sync_interval` is gone: norn syncs about every 5 minutes",
  remote: "`remote` is gone: `provider` replaces it",
  runner: "`runner` is gone: norn detects it",
  notifiers: "`notifiers` is now `notify`",
  max_checks: "`max_checks` is gone: checks follow `max_agents`",
  slots: "`slots` is gone: slots are fixed at 1–9",
  watch_interval: "`watch_interval` is gone: use `norn watch --interval` or `norn tick --interval`",
  claim: "`claim` is gone: norn derives it from the tick interval",
  limits: "`limits` moved to each workflow's `defaults:`",
};
const MOVED_AGENT_FIELD: Record<string, string> = {
  adapter: "is gone: the entry's name is the agent",
  command: "is gone: the agent runs by its usual name from PATH",
  env: "is gone",
  capabilities: "is gone, with criteria `needs`",
};

const MACHINE_KEYS = ["max_agents", "notify", "trace"];
const PERSON_KEYS = ["mode", "agent", "agents"];
const TEAM_KEYS = ["provider", "base_branch", "workflow", "slice_workflow"];
const FILE_KEYS: Record<ConfigFileKind, string[]> = { user: [...MACHINE_KEYS, ...PERSON_KEYS], local: PERSON_KEYS, repo: TEAM_KEYS };

/** The file a top-level key belongs in, as a person reads it; null for an unknown key. */
function rightFile(key: string): string | null {
  if (MACHINE_KEYS.includes(key)) return `\`${CONFIG_FILES.user}\` (machine key)`;
  if (PERSON_KEYS.includes(key)) return `\`${CONFIG_FILES.local}\` or \`${CONFIG_FILES.user}\` (your key)`;
  if (TEAM_KEYS.includes(key)) return `\`${CONFIG_FILES.repo}\` (team key)`;
  return null;
}

const isMap = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * B5–B8, B17, B19, B39, B53 (D2): the problems of one file's parsed YAML, in order moved, wrong
 * file, invalid. `null` / empty means the file sets nothing. What the moved and wrong-file passes
 * leave is checked against the file's own schema (the one an editor uses, B50). Pure.
 */
export function checkConfigFile(file: ConfigFileKind, value: unknown): ConfigProblem[] {
  if (value === null || value === undefined) return [];
  const out: ConfigProblem[] = [];
  const add = (code: ConfigProblemCode, key: string, message: string) => out.push({ code, file, key, message });
  if (!isMap(value)) {
    add("config_invalid", "", "the file must be a map of keys");
    return out;
  }
  const rest: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value)) {
    if (key === "remote" && isMap(v)) {
      const children = Object.keys(v);
      for (const c of children.length ? children : [""]) {
        const k = c ? `remote.${c}` : "remote";
        add("config_moved", k, `${MOVED[k] ?? MOVED.remote}${MIGRATE}`);
      }
      continue;
    }
    if (MOVED[key]) {
      add("config_moved", key, `${MOVED[key]}${MIGRATE}`);
      continue;
    }
    if (key !== "$schema" && !FILE_KEYS[file].includes(key)) {
      const right = rightFile(key);
      if (right) add("config_wrong_file", key, `\`${key}\` belongs in ${right}`);
      else add("config_invalid", key, `unknown key \`${key}\``);
      continue;
    }
    rest[key] = key === "agents" ? withoutMovedAgentFields(v, add) : v;
  }
  const r = check(CONFIG_SCHEMAS[file], rest);
  if (r.ok) return out;
  const seen = new Set<string>();
  for (const e of r.errors) {
    const { key, message } = invalidProblem(e);
    if (seen.has(key)) continue;
    seen.add(key);
    add("config_invalid", key, message);
  }
  return out;
}

/** B39: an agent entry's removed fields are moved problems; the rest goes on to the schema. */
function withoutMovedAgentFields(v: unknown, add: (code: ConfigProblemCode, key: string, message: string) => void): unknown {
  if (!isMap(v)) return v;
  const agents: Record<string, unknown> = {};
  for (const [name, entry] of Object.entries(v)) {
    if (!isMap(entry)) {
      agents[name] = entry;
      continue;
    }
    const kept: Record<string, unknown> = {};
    for (const [field, fv] of Object.entries(entry)) {
      const k = `agents.${name}.${field}`;
      if (MOVED_AGENT_FIELD[field]) add("config_moved", k, `\`${k}\` ${MOVED_AGENT_FIELD[field]}${MIGRATE}`);
      else kept[field] = fv;
    }
    agents[name] = kept;
  }
  return agents;
}

/** What a person reads for each key the schema rejects (`*` stands for an agent name). */
const INVALID: Record<string, string> = {
  mode: "`mode` must be manual or auto",
  agent: `\`agent\` must be one of ${AGENT_NAMES.join(", ")}`,
  agents: "`agents` must be a map of agent names",
  "agents.*": "`agents.*` must be a map with `model` and `args`",
  "agents.*.model": "`agents.*.model` must be a model name",
  "agents.*.args": "`agents.*.args` must be a list of strings",
  max_agents: "`max_agents` must be 1–9 (there are 9 slots)",
  notify: "`notify` must be a map with `os`, `ntfy`, `webhook`",
  "notify.os": "`notify.os` must be true or false",
  "notify.ntfy": "`notify.ntfy` must be an http or https URL",
  "notify.webhook": "`notify.webhook` must be an http or https URL",
  trace: "`trace` must be a map with `retain`",
  "trace.retain": "`trace.retain` must be a duration like 14d",
  provider: "`provider` must be gh or glab",
  base_branch: "`base_branch` must be a branch name",
  workflow: "`workflow` must be a workflow name",
  slice_workflow: "`slice_workflow` must be a workflow name",
  $schema: "`$schema` must be a path or URL",
};

/** D2: one schema error as a config_invalid problem on the key it names, in a person's words. */
function invalidProblem(e: SchemaError): { key: string; message: string } {
  const segs = e.path.split("/").filter(Boolean);
  const unknown = /^unknown property '(.+)'$/.exec(e.message)?.[1];
  if (unknown !== undefined) {
    const key = [...segs, unknown].join(".");
    if (segs.length === 1 && segs[0] === "agents") return { key, message: `unknown agent \`${unknown}\`: \`agents\` takes ${AGENT_NAMES.join(", ")}` };
    return { key, message: `unknown key \`${key}\`` };
  }
  // an element of a list is the list's problem (`agents.claude.args.0` → `agents.claude.args`)
  while (segs.length && /^\d+$/.test(segs.at(-1) as string)) segs.pop();
  const key = segs.join(".");
  const pattern = segs[0] === "agents" && segs[1] ? ["agents", "*", ...segs.slice(2)].join(".") : key;
  const message = INVALID[pattern]?.replace("*", segs[1] ?? "*") ?? `\`${key}\` ${e.message}`;
  return { key, message };
}

// ---------------------------------------------------------------- resolving and explaining

export type ConfigSource = "built-in" | "derived" | "user" | "local" | "repo";

export interface ConfigEntry {
  /** dotted path, e.g. `mode`, `agents.claude.model`, `claim.lease` */
  key: string;
  value: unknown;
  source: ConfigSource;
  /** for `derived`: why */
  reason?: string;
}

export interface ResolvedConfigResult {
  config: ResolvedConfig;
  entries: ConfigEntry[];
  problems: ConfigProblem[];
}

/** B22, B54 (D7): the provider a remote URL names; null = a host that is neither; "local" = a path. */
export function providerFromUrl(url: string): { provider: "gh" | "glab"; host: string } | { provider: null; host: string } | "local" {
  const m = /^(?:[a-z+]+:\/\/)?(?:[^@/\s]+@)?([^/:\s]+)[:/]/i.exec(url);
  if (!m || url.startsWith("/") || url.startsWith(".") || url.startsWith("file:")) return "local";
  const host = (m[1] as string).toLowerCase();
  if (host.includes("github")) return { provider: "gh", host };
  if (host.includes("gitlab")) return { provider: "glab", host };
  return { provider: null, host };
}

/** `ms` as a duration string (`3m20s`). */
export function durationText(ms: number): string {
  const parts: string[] = [];
  let rest = Math.round(ms / 1000);
  for (const [unit, s] of [
    ["d", 86400],
    ["h", 3600],
    ["m", 60],
    ["s", 1],
  ] as const) {
    const n = Math.floor(rest / s);
    if (n) parts.push(`${n}${unit}`);
    rest -= n * s;
  }
  return parts.join("") || "0s";
}

/** B35: lease = the larger of 10 minutes and 4 × interval, renewed every third of it. */
export function claimTiming(interval: string): { lease: string; renew: string } {
  const lease = Math.max(10 * 60_000, 4 * parseDuration(interval));
  return { lease: durationText(lease), renew: durationText(lease / 3) };
}

/**
 * Merge the three files over the built-in values with what norn derived (K2, B2–B4, B10–B17,
 * B22, B29, B31, B34, B35, B46, B54). The nearer file wins for your keys (local over user); maps
 * merge key by key, lists and scalars replace. Problems of every file come back with a config
 * that still holds the valid values. Pure.
 */
export function resolveConfig(files: ConfigFiles = {}, derived: ConfigDerived = NO_DERIVED): ResolvedConfigResult {
  const problems: ConfigProblem[] = [];
  const clean: Record<ConfigFileKind, Record<string, unknown>> = { user: {}, local: {}, repo: {} };
  for (const kind of ["user", "local", "repo"] as const) {
    const v = files[kind];
    const p = checkConfigFile(kind, v);
    problems.push(...p);
    if (!isMap(v)) continue;
    const bad = new Set(p.map((x) => x.key.split(".")[0]));
    for (const [k, val] of Object.entries(v)) if (k !== "$schema" && !bad.has(k) && val !== null) clean[kind][k] = val;
  }
  const entries: ConfigEntry[] = [];
  const entry = (key: string, value: unknown, source: ConfigSource, reason?: string) => entries.push({ key, value, source, ...(reason ? { reason } : {}) });
  const personal = <T>(key: string, builtIn: T): T => {
    for (const kind of ["local", "user"] as const)
      if (clean[kind][key] !== undefined) {
        entry(key, clean[kind][key], kind);
        return clean[kind][key] as T;
      }
    entry(key, builtIn, "built-in");
    return builtIn;
  };
  const team = <T>(key: string, builtIn: T): T => {
    if (clean.repo[key] !== undefined) {
      entry(key, clean.repo[key], "repo");
      return clean.repo[key] as T;
    }
    entry(key, builtIn, "built-in");
    return builtIn;
  };
  const machine = <T>(key: string, builtIn: T): T => {
    if (clean.user[key] !== undefined) {
      entry(key, clean.user[key], "user");
      return clean.user[key] as T;
    }
    entry(key, builtIn, "built-in");
    return builtIn;
  };

  const mode = personal<ResolvedConfig["mode"]>("mode", "manual");
  const agent = personal<string>("agent", "claude");
  // B14–B16: an entry merges field by field over the built-in one, then the user file's, then the local file's
  const agents: Record<string, AgentEntry> = {};
  const names = new Set([...Object.keys(BUILT_IN_AGENTS), ...Object.keys((clean.user.agents as object) ?? {}), ...Object.keys((clean.local.agents as object) ?? {})]);
  for (const name of [...names].sort()) {
    const merged: AgentEntry = {};
    for (const field of ["model", "args"] as const) {
      let value: unknown;
      let source: ConfigSource = "built-in";
      const builtIn = BUILT_IN_AGENTS[name]?.[field];
      if (builtIn !== undefined) value = builtIn;
      for (const kind of ["user", "local"] as const) {
        const v = ((clean[kind].agents as Record<string, AgentEntry | null> | undefined)?.[name] ?? undefined)?.[field];
        if (v !== undefined) {
          value = v;
          source = kind;
        }
      }
      if (value === undefined) continue;
      (merged as Record<string, unknown>)[field] = value;
      entry(`agents.${name}.${field}`, value, source);
    }
    agents[name] = merged;
  }

  entry("runner", derived.runner.adapter, "derived", derived.runner.reason);
  // B22, B54 (D7): provider from the team file, else the remote URL's host
  let provider: "gh" | "glab" = "gh";
  if (clean.repo.provider !== undefined) {
    provider = clean.repo.provider as "gh" | "glab";
    entry("provider", provider, "repo");
  } else {
    const p = derived.remote_url ? providerFromUrl(derived.remote_url) : "local";
    if (p === "local") entry("provider", "gh", "built-in");
    else if (p.provider) {
      provider = p.provider;
      entry("provider", provider, "derived", "remote URL");
    } else {
      entry("provider", "gh", "built-in");
      problems.push({ code: "config_invalid", file: "repo", key: "provider", message: `can't tell the provider from \`${p.host}\`: set \`provider\` in \`${CONFIG_FILES.repo}\`` });
    }
  }
  entry("label", ISSUE_LABEL, "built-in");
  entry("git_remote", derived.git_remote.name, "derived", derived.git_remote.reason);
  entry("sync_interval", SYNC_INTERVAL, "built-in");
  const base_branch = team<string | null>("base_branch", null);
  const workflow = team<string>("workflow", "triage");
  const slice_workflow = team<string>("slice_workflow", "slice");

  const max_agents = machine<number>("max_agents", 9);
  const notifyFile = (clean.user.notify ?? {}) as Notify;
  const notify: ResolvedConfig["notify"] = { os: notifyFile.os ?? true };
  entry("notify.os", notify.os, notifyFile.os === undefined ? "built-in" : "user");
  for (const c of ["ntfy", "webhook"] as const)
    if (notifyFile[c] !== undefined) {
      notify[c] = notifyFile[c];
      entry(`notify.${c}`, notifyFile[c], "user");
    }
  const retain = ((clean.user.trace as { retain?: string } | undefined)?.retain ?? undefined) as string | undefined;
  entry("trace.retain", retain ?? "14d", retain === undefined ? "built-in" : "user");

  const interval = derived.interval ?? DEFAULT_INTERVAL;
  entry("interval", interval, derived.interval ? "derived" : "built-in", derived.interval ? "recorded by the last watch or tick --interval" : undefined);
  const claim = claimTiming(interval);
  entry("claim.lease", claim.lease, "derived", `interval ${interval}`);
  entry("claim.renew", claim.renew, "derived", `interval ${interval}`);

  const config: ResolvedConfig = {
    agent,
    agents,
    mode,
    runner: { adapter: derived.runner.adapter },
    provider,
    label: ISSUE_LABEL,
    git_remote: derived.git_remote.name,
    sync_interval: SYNC_INTERVAL,
    base_branch,
    workflow,
    slice_workflow,
    max_agents,
    notify,
    interval,
    claim,
    trace: { retain: retain ?? "14d" },
  };
  return { config, entries, problems };
}

/**
 * The file a dotted key may be set in (`norn config set`, D4): `ok`, or the problem of setting it
 * there (moved, wrong file, unknown). Read off the same rules as loading. Pure.
 */
export function configKeyProblem(file: ConfigFileKind, key: string): ConfigProblem | null {
  const segs = key.split(".");
  const [top, ...rest] = segs as [string, ...string[]];
  const problem = (code: ConfigProblemCode, message: string): ConfigProblem => ({ code, file, key, message });
  const unknown = () => problem("config_invalid", `unknown key \`${key}\``);
  if (segs.some((s) => !s)) return unknown();
  const moved = MOVED[segs.slice(0, 2).join(".")] ?? MOVED[top];
  if (moved) return problem("config_moved", `${moved}${MIGRATE}`);
  if (!FILE_KEYS[file].includes(top)) {
    const right = rightFile(top);
    return right ? problem("config_wrong_file", `\`${top}\` belongs in ${right}`) : unknown();
  }
  const children: Record<string, (rest: string[]) => ConfigProblem | null> = {
    agents: ([name, field, ...more]) => {
      if (name === undefined) return null;
      if (!isAgentName(name)) return problem("config_invalid", `unknown agent \`${name}\`: \`agents\` takes ${AGENT_NAMES.join(", ")}`);
      if (field === undefined) return null;
      if (MOVED_AGENT_FIELD[field]) return problem("config_moved", `\`agents.${name}.${field}\` ${MOVED_AGENT_FIELD[field]}${MIGRATE}`);
      return (field === "model" || field === "args") && !more.length ? null : unknown();
    },
    notify: ([c, ...more]) => (c === undefined || (["os", "ntfy", "webhook"].includes(c) && !more.length) ? null : unknown()),
    trace: ([c, ...more]) => (c === undefined || (c === "retain" && !more.length) ? null : unknown()),
  };
  const child = children[top];
  if (child) return child(rest);
  return rest.length ? unknown() : null;
}

/**
 * A resolved config an older norn recorded in a tick's replay block, in today's shape, so
 * `norn run view --why` replays it (O5). Fields already in today's names pass through. Pure.
 */
export function legacyConfig(recorded: unknown): ResolvedConfig {
  const c = { ...(recorded as Record<string, unknown>) };
  const rename = (from: string, to: string) => {
    if (from in c) {
      if (!(to in c)) c[to] = c[from];
      delete c[from];
    }
  };
  rename("default_agent", "agent");
  rename("default_mode", "mode");
  rename("default_workflow", "workflow");
  rename("default_slice_workflow", "slice_workflow");
  rename("watch_interval", "interval");
  if (isMap(c.remote)) {
    for (const [k, v] of Object.entries(c.remote)) if (k !== "host" && !(k in c)) c[k] = v;
    delete c.remote;
  }
  delete c.host;
  if (c.runner === null) c.runner = { adapter: "headless" };
  else if (isMap(c.runner)) c.runner = { adapter: c.runner.adapter === "herdr" ? "herdr" : "headless" };
  if (Array.isArray(c.notifiers)) {
    c.notify ??= { os: c.notifiers.some((n) => isMap(n) && n.adapter === "os") };
    delete c.notifiers;
  }
  if (isMap(c.agents)) {
    const agents: Record<string, AgentEntry> = {};
    for (const [name, a] of Object.entries(c.agents))
      if (isMap(a)) agents[name] = { ...(typeof a.model === "string" ? { model: a.model } : {}), ...(Array.isArray(a.args) ? { args: a.args as string[] } : {}) };
    c.agents = agents;
  }
  for (const gone of ["max_checks", "slots", "limits"]) delete c[gone];
  return c as ResolvedConfig;
}
