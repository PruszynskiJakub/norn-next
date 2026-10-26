import { type Static, Type } from "@sinclair/typebox";
import { Duration, Mode, NonEmpty, NonNegInt, PosInt, RemoteProvider } from "./common.ts";

const Name = Type.String({ pattern: "^[a-z][a-z0-9_-]*$" });
const Options = Type.Record(Type.String(), Type.Unknown());

export const AgentConfig = Type.Object(
  {
    /** Adapter id (`claude`, `codex`, `opencode`, `gemini`) or package name (X2). */
    adapter: NonEmpty,
    command: Type.Optional(NonEmpty),
    args: Type.Optional(Type.Array(Type.String())),
    model: Type.Optional(NonEmpty),
    env: Type.Optional(Type.Record(Type.String(), Type.String())),
    /**
     * QV5a: what a session of this agent can do to verify criteria (free strings matching criteria
     * `needs`, e.g. `browser`); default none. `norn done` refuses a `pass` verdict for a criterion
     * whose `needs` are not all here.
     */
    capabilities: Type.Optional(Type.Array(NonEmpty, { uniqueItems: true })),
  },
  { additionalProperties: false },
);
export type AgentConfig = Static<typeof AgentConfig>;

export const RunnerConfig = Type.Object(
  {
    /** `herdr`, `headless`, or a package name */
    adapter: NonEmpty,
    options: Type.Optional(Options),
  },
  { additionalProperties: false },
);
export type RunnerConfig = Static<typeof RunnerConfig>;

export const RemoteConfig = Type.Object(
  {
    provider: RemoteProvider,
    /** label marking issues norn picks up (GR1) */
    label: NonEmpty,
    /** GitHub Enterprise / self-hosted GitLab host */
    host: Type.Optional(NonEmpty),
    /** git remote name */
    git_remote: NonEmpty,
    sync_interval: Duration,
  },
  { additionalProperties: false },
);
export type RemoteConfig = Static<typeof RemoteConfig>;

export const SlotConfig = Type.Object(
  {
    min: NonNegInt,
    max: NonNegInt,
    port_base: PosInt,
    ports_per_slot: PosInt,
    /** Extra per-slot env in `.env.norn` (K4); `{slot}` and `{port_base}` are substituted. */
    env: Type.Optional(Type.Record(Type.String({ pattern: "^[A-Z_][A-Z0-9_]*$" }), Type.String())),
  },
  { additionalProperties: false },
);
export type SlotConfig = Static<typeof SlotConfig>;

export const NotifierConfig = Type.Object(
  {
    /** `os`, `ntfy`, `webhook`, `herdr` (HC14), or a package name */
    adapter: NonEmpty,
    options: Type.Optional(Options),
  },
  { additionalProperties: false },
);
export type NotifierConfig = Static<typeof NotifierConfig>;

export const LimitDefaults = Type.Object(
  {
    /** default agent step deadline */
    deadline: Duration,
    /** default max nudges per step entry (silent/timeout/stalled) */
    nudges: NonNegInt,
    /** default max fresh retries per step entry (died) */
    retries: NonNegInt,
    /** no hook, git or file activity for this long → stalled */
    stalled: Duration,
    /** HC2: an attended agent waiting this long for its person shows under Your turn (`0s` = at once) */
    attended_wait: Duration,
  },
  { additionalProperties: false },
);
export type LimitDefaults = Static<typeof LimitDefaults>;

/** Fully resolved configuration (both layers merged over defaults). */
export const ResolvedConfig = Type.Object(
  {
    agents: Type.Record(Name, AgentConfig),
    default_agent: Name,
    /** null: no runner on this machine → effective mode manual (MO2) */
    runner: Type.Union([RunnerConfig, Type.Null()]),
    remote: RemoteConfig,
    /**
     * BS0: the branch stories are cut from, updated from (`git: update`) and PR'd into. null =
     * the remote's default branch, discovered as before. Never assumed to be `main`.
     */
    base_branch: Type.Union([NonEmpty, Type.Null()]),
    default_workflow: Name,
    default_slice_workflow: Name,
    default_mode: Mode,
    /** machine caps (K1); a repo layer can only lower them (K2) */
    max_agents: PosInt,
    max_checks: PosInt,
    slots: SlotConfig,
    notifiers: Type.Array(NotifierConfig),
    watch_interval: Duration,
    claim: Type.Object({ lease: Duration, renew: Duration }, { additionalProperties: false }),
    limits: LimitDefaults,
  },
  { additionalProperties: false },
);
export type ResolvedConfig = Static<typeof ResolvedConfig>;

/** One config layer (`~/.norn/config.yaml` or `.agents/norn/config.yaml`): everything optional. */
export const ConfigLayer = Type.Object(
  {
    $schema: Type.Optional(Type.String()),
    agents: Type.Optional(Type.Record(Name, AgentConfig)),
    default_agent: Type.Optional(Name),
    runner: Type.Optional(Type.Union([RunnerConfig, Type.Null()])),
    remote: Type.Optional(Type.Partial(RemoteConfig, { additionalProperties: false })),
    base_branch: Type.Optional(Type.Union([NonEmpty, Type.Null()])),
    default_workflow: Type.Optional(Name),
    default_slice_workflow: Type.Optional(Name),
    default_mode: Type.Optional(Mode),
    max_agents: Type.Optional(PosInt),
    max_checks: Type.Optional(PosInt),
    slots: Type.Optional(Type.Partial(SlotConfig, { additionalProperties: false })),
    notifiers: Type.Optional(Type.Array(NotifierConfig)),
    watch_interval: Type.Optional(Duration),
    claim: Type.Optional(Type.Partial(Type.Object({ lease: Duration, renew: Duration }), { additionalProperties: false })),
    limits: Type.Optional(Type.Partial(LimitDefaults, { additionalProperties: false })),
  },
  { $id: "https://norn.dev/schema/config.json", title: "norn config layer", additionalProperties: false },
);
export type ConfigLayer = Static<typeof ConfigLayer>;

export const DEFAULT_CONFIG: ResolvedConfig = {
  /**
   * Claude sessions run in Claude Code's `auto` permission mode (AGENTS.md decision; PRD §20 defers
   * permission profiles). A layer that defines `agents.claude` replaces this entry, args included.
   */
  agents: { claude: { adapter: "claude", args: ["--permission-mode", "auto"] } },
  default_agent: "claude",
  runner: null,
  remote: { provider: "gh", label: "norn", git_remote: "origin", sync_interval: "5m" },
  base_branch: null,
  default_workflow: "story",
  default_slice_workflow: "slice",
  default_mode: "manual",
  max_agents: 2,
  max_checks: 2,
  slots: { min: 1, max: 9, port_base: 4000, ports_per_slot: 10 },
  notifiers: [{ adapter: "os" }],
  watch_interval: "30s",
  claim: { lease: "10m", renew: "3m" },
  limits: { deadline: "60m", nudges: 2, retries: 1, stalled: "15m", attended_wait: "2m" },
};

const minDefined = (a: number, b: number | undefined) => (b === undefined ? a : Math.min(a, b));

function layer(base: ResolvedConfig, l: ConfigLayer): ResolvedConfig {
  return {
    agents: { ...base.agents, ...l.agents },
    default_agent: l.default_agent ?? base.default_agent,
    runner: l.runner === undefined ? base.runner : l.runner,
    remote: { ...base.remote, ...l.remote },
    base_branch: l.base_branch === undefined ? base.base_branch : l.base_branch,
    default_workflow: l.default_workflow ?? base.default_workflow,
    default_slice_workflow: l.default_slice_workflow ?? base.default_slice_workflow,
    default_mode: l.default_mode ?? base.default_mode,
    max_agents: l.max_agents ?? base.max_agents,
    max_checks: l.max_checks ?? base.max_checks,
    slots: { ...base.slots, ...l.slots },
    notifiers: l.notifiers ?? base.notifiers,
    watch_interval: l.watch_interval ?? base.watch_interval,
    claim: { ...base.claim, ...l.claim },
    limits: { ...base.limits, ...l.limits },
  };
}

/**
 * Merge defaults ← user ← repo (K2). The repo layer overrides everything except
 * machine caps (`max_agents`, `max_checks`, slot range), which it can only lower/narrow.
 * Inputs must already be validated layers. Pure.
 */
export function resolveConfig(user: ConfigLayer = {}, repo: ConfigLayer = {}): ResolvedConfig {
  const u = layer(DEFAULT_CONFIG, user);
  const r = layer(u, repo);
  return {
    ...r,
    max_agents: minDefined(u.max_agents, repo.max_agents),
    max_checks: minDefined(u.max_checks, repo.max_checks),
    slots: {
      ...r.slots,
      min: Math.max(u.slots.min, repo.slots?.min ?? u.slots.min),
      max: minDefined(u.slots.max, repo.slots?.max),
    },
  };
}

/** Who a setting belongs to, for `norn config`: usually set in the user layer (machine, person) or the repo layer (team). */
export type ConfigGroup = "machine" | "person" | "team";

export interface ConfigEntry {
  /** dotted path, e.g. `default_mode`, `limits.deadline`, `agents.claude` */
  key: string;
  value: unknown;
  /** the layer whose value is in effect */
  source: "built-in" | "user" | "repo";
  group: ConfigGroup;
  /** set when the repo layer sets this key but its value does not apply (machine caps, K2) */
  repo_ignored?: unknown;
}

const GROUP: Record<keyof ResolvedConfig, ConfigGroup> = {
  runner: "machine",
  max_agents: "machine",
  max_checks: "machine",
  slots: "machine",
  notifiers: "machine",
  agents: "person",
  default_agent: "person",
  default_mode: "person",
  remote: "team",
  base_branch: "team",
  default_workflow: "team",
  default_slice_workflow: "team",
  watch_interval: "team",
  claim: "team",
  limits: "team",
};

/** Keys whose layers merge key by key (`agents` per agent name), so each child is its own entry. */
const MERGED = new Set<keyof ResolvedConfig>(["agents", "remote", "slots", "claim", "limits"]);

function equal(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => equal((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

function at(layer: object, path: readonly string[]): unknown {
  let v: unknown = layer;
  for (const p of path) v = typeof v === "object" && v !== null ? (v as Record<string, unknown>)[p] : undefined;
  return v;
}

/**
 * Every resolved setting with the layer it came from (K2), for `norn config`. A key is
 * credited to the last layer that sets it to the value in effect; a repo value that a
 * machine cap rule ignores is reported as `repo_ignored`. Pure.
 */
export function explainConfig(user: ConfigLayer = {}, repo: ConfigLayer = {}): ConfigEntry[] {
  const resolved = resolveConfig(user, repo);
  const entries: ConfigEntry[] = [];
  const add = (path: string[], group: ConfigGroup) => {
    const value = at(resolved, path);
    const r = at(repo, path);
    const u = at(user, path);
    const entry: ConfigEntry = { key: path.join("."), value, source: "built-in", group };
    if (r !== undefined && equal(r, value)) entry.source = "repo";
    else if (u !== undefined && equal(u, value)) entry.source = "user";
    if (r !== undefined && !equal(r, value)) entry.repo_ignored = r;
    entries.push(entry);
  };
  for (const key of Object.keys(resolved) as Array<keyof ResolvedConfig>) {
    const value = resolved[key];
    if (MERGED.has(key) && typeof value === "object" && value !== null) {
      for (const child of Object.keys(value)) add([key, child], GROUP[key]);
    } else add([key], GROUP[key]);
  }
  return entries;
}
