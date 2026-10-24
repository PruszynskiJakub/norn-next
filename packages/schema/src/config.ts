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
    /** `os`, `ntfy`, `webhook`, or a package name */
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
  agents: { claude: { adapter: "claude" } },
  default_agent: "claude",
  runner: null,
  remote: { provider: "gh", label: "norn", git_remote: "origin", sync_interval: "5m" },
  default_workflow: "story",
  default_slice_workflow: "slice",
  default_mode: "manual",
  max_agents: 2,
  max_checks: 2,
  slots: { min: 1, max: 9, port_base: 4000, ports_per_slot: 10 },
  notifiers: [{ adapter: "os" }],
  watch_interval: "30s",
  claim: { lease: "10m", renew: "3m" },
  limits: { deadline: "60m", nudges: 2, retries: 1, stalled: "15m" },
};

const minDefined = (a: number, b: number | undefined) => (b === undefined ? a : Math.min(a, b));

function layer(base: ResolvedConfig, l: ConfigLayer): ResolvedConfig {
  return {
    agents: { ...base.agents, ...l.agents },
    default_agent: l.default_agent ?? base.default_agent,
    runner: l.runner === undefined ? base.runner : l.runner,
    remote: { ...base.remote, ...l.remote },
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
