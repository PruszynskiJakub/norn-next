/**
 * The GitHub tracker: issues through `gh`. It is never a state store: labels it sets are display for
 * people, and nothing norn decides is read back from an issue's labels or comments.
 */
import {
  type EffectMeta,
  fail,
  formatStoryKey,
  type HostContext,
  ok,
  parseJson,
  type PluginResult,
  type Tracker,
  type TrackerEffect,
  type TrackerEffectOutcome,
  type TrackerItem,
  validateTrackerEffect,
} from "@norn/plugin-api";
import type { GithubConfig } from "./config.ts";
import { isMissingIssue } from "./failure.ts";
import { createGh, type Gh } from "./gh.ts";
import { hasMarker, isReceiptId, withMarker } from "./marker.ts";
import { fromNode, GhIssue, GhIssueComments, GhIssueLabels, GhIssuePage, GhIssues, GhLabels, INTAKE_QUERY, ISSUE_FIELDS, toItem } from "./wire.ts";

export const GITHUB_KEY_PREFIX = "gh";

/** Intake reads this many issues at most, far above any backlog norn is pointed at. */
const INTAKE_LIMIT = 500;

/**
 * How far back a replayed `create` looks among the issues this login opened. A replay follows its
 * first attempt within a tick or two, so the issue it made is among the newest. The listing is
 * GitHub's issue list, never its search, because search lags behind a fresh issue and a replay
 * would then miss it and open a second one.
 */
const REPLAY_LOOKBACK = "100";

type Outcome = PluginResult<TrackerEffectOutcome>;

const ISSUE_URL = /\/issues\/(\d+)/;
const lastUrl = (stdout: string): string | undefined =>
  stdout
    .trim()
    .split("\n")
    .map((l) => l.trim())
    .reverse()
    .find((l) => l.startsWith("https://"));

export function createGithubTracker(ctx: HostContext, config: GithubConfig): Tracker {
  const gh: Gh = createGh(ctx, config);
  async function whoami(): Promise<PluginResult<string>> {
    const out = await gh.run(["api", "user", "--jq", ".login"]);
    if (!out.ok) return out;
    const login = out.value.trim();
    return login ? ok(login) : fail("auth", "gh api user named no login");
  }
  // gh's login does not change under a running tracker, and intake resolves `me` on every tick;
  // whoami itself still asks, so a probe of gh's auth reads it live
  let me: string | undefined;
  async function myLogin(): Promise<PluginResult<string>> {
    if (me !== undefined) return ok(me);
    const login = await whoami();
    if (login.ok) me = login.value;
    return login;
  }
  const done = (kind: TrackerEffect["kind"], id?: number, url?: string, replayed = false): Outcome =>
    ok({ kind, replayed, ...(id === undefined ? {} : { id, key: formatStoryKey(GITHUB_KEY_PREFIX, id) }), ...(url === undefined ? {} : { url }) });

  async function create(effect: Extract<TrackerEffect, { kind: "create" }>, receipt: string): Promise<Outcome> {
    const mine = await gh.json(GhIssues, ["issue", "list", "--author", "@me", "--state", "all", "--limit", REPLAY_LOOKBACK, "--json", ISSUE_FIELDS]);
    if (!mine.ok) return mine;
    const seen = mine.value.find((i) => hasMarker(i.body, receipt));
    if (seen) return done("create", seen.number, seen.url, true);
    const args = ["issue", "create", "--title", effect.title, "--body-file", "-", ...effect.labels.flatMap((l) => ["--label", l])];
    if (effect.assignee !== undefined) args.push("--assignee", effect.assignee);
    const out = await gh.inRepo(args, withMarker(effect.body, receipt));
    if (!out.ok) return out;
    const url = lastUrl(out.value);
    const m = ISSUE_URL.exec(url ?? "");
    // the issue may exist without its number reaching us; the marker lets the retry find it
    if (!url || !m) return fail("unknown", `gh issue create: no issue URL in its output: ${out.value.slice(0, 200)}`, true);
    return done("create", Number(m[1]), url);
  }

  async function comment(effect: Extract<TrackerEffect, { kind: "comment" }>, receipt: string): Promise<Outcome> {
    const existing = await gh.json(GhIssueComments, ["issue", "view", String(effect.id), "--json", "comments"]);
    if (!existing.ok) return existing;
    const seen = existing.value.comments.find((c) => hasMarker(c.body, receipt));
    if (seen) return done("comment", effect.id, seen.url, true);
    const out = await gh.inRepo(["issue", "comment", String(effect.id), "--body-file", "-"], withMarker(effect.body, receipt));
    if (!out.ok) return out;
    return done("comment", effect.id, lastUrl(out.value));
  }

  async function labels(effect: Extract<TrackerEffect, { kind: "labels" }>): Promise<Outcome> {
    // gh refuses to remove a label the repository lacks, so remove only what the issue carries
    const current = await gh.json(GhIssueLabels, ["issue", "view", String(effect.id), "--json", "labels"]);
    if (!current.ok) return current;
    const has = new Set(current.value.labels.map((l) => l.name));
    const remove = effect.remove.filter((l) => has.has(l));
    const add = effect.add.filter((l) => !has.has(l) && !remove.includes(l));
    if (add.length === 0 && remove.length === 0) return done("labels", effect.id);
    const out = await gh.inRepo(["issue", "edit", String(effect.id), ...add.flatMap((l) => ["--add-label", l]), ...remove.flatMap((l) => ["--remove-label", l])]);
    if (!out.ok) return out;
    return done("labels", effect.id);
  }

  /**
   * Labels are created one call each, so an outage midway leaves the earlier ones defined. That is
   * harmless: performing it again creates only what is still missing. An existing label is never
   * restyled (no `--force`): a person may have chosen its colour.
   */
  async function ensureLabels(effect: Extract<TrackerEffect, { kind: "ensure_labels" }>): Promise<Outcome> {
    const defined = await gh.json(GhLabels, ["label", "list", "--limit", "1000", "--json", "name"]);
    if (!defined.ok) return defined;
    // GitHub label names are case-insensitive
    const have = new Set(defined.value.map((l) => l.name.toLowerCase()));
    for (const l of effect.labels) {
      if (have.has(l.name.toLowerCase())) continue;
      const out = await gh.inRepo(["label", "create", l.name, "--color", l.color, "--description", l.description]);
      if (!out.ok && out.failure.code !== "conflict") return out;
      have.add(l.name.toLowerCase());
    }
    return done("ensure_labels");
  }

  async function edit(kind: "assign" | "close", id: number, args: string[]): Promise<Outcome> {
    const out = await gh.inRepo(args);
    if (!out.ok) return out;
    return done(kind, id);
  }

  return {
    name: "github",
    keyPrefix: GITHUB_KEY_PREFIX,
    capabilities: { assign: true, labels: true, comment: true, create: true, close: true },

    whoami,

    async intake(q) {
      let assignee: string | null = q.assignee;
      if (assignee === "me") {
        const login = await myLogin();
        if (!login.ok) return login;
        assignee = login.value;
      }
      const repo = await gh.repo();
      if (!repo.ok) return repo;
      const [owner, name] = repo.value.split("/") as [string, string];
      const items: TrackerItem[] = [];
      let after: string | null = null;
      do {
        // -f, not -F: -F would turn an all-digit owner or label into a number and break the query's String type
        const vars = [`owner=${owner}`, `name=${name}`, `label=${q.label}`, ...(assignee === null ? [] : [`assignee=${assignee}`]), ...(after === null ? [] : [`after=${after}`])];
        const out = await gh.run(["api", "graphql", ...vars.flatMap((v) => ["-f", v]), "-f", `query=${INTAKE_QUERY}`]);
        if (!out.ok) return out;
        const page = parseJson(GhIssuePage, out.value, "gh api graphql");
        if (!page.ok) return page;
        const issues = page.value.data.repository?.issues;
        if (!issues) return fail("not_found", `github tracker: no repository ${repo.value}`);
        items.push(...issues.nodes.map((n) => toItem(fromNode(n), GITHUB_KEY_PREFIX)));
        after = issues.pageInfo.hasNextPage ? (issues.pageInfo.endCursor ?? null) : null;
      } while (after !== null && items.length < INTAKE_LIMIT);
      // open only is the contract, whatever the query's filter let through
      return ok(items.filter((i) => i.open));
    },

    async get(id): Promise<PluginResult<TrackerItem | null>> {
      const row = await gh.json(GhIssue, ["issue", "view", String(id), "--json", ISSUE_FIELDS]);
      if (!row.ok) return isMissingIssue(row.failure) ? ok(null) : row;
      return ok(toItem(row.value, GITHUB_KEY_PREFIX));
    },

    async perform(effect: TrackerEffect, meta: EffectMeta): Promise<Outcome> {
      const valid = validateTrackerEffect(effect);
      if (!valid.ok) return fail("invalid", `github tracker: malformed effect: ${valid.errors.map((e) => `${e.path || "/"} ${e.message}`).join("; ")}`);
      if (!isReceiptId(meta.receipt_id)) return fail("invalid", `github tracker: receipt id ${JSON.stringify(meta.receipt_id)} cannot be carried in a marker`);
      switch (effect.kind) {
        case "create":
          return create(effect, meta.receipt_id);
        case "comment":
          return comment(effect, meta.receipt_id);
        case "labels":
          return labels(effect);
        case "ensure_labels":
          return ensureLabels(effect);
        case "assign":
          return edit("assign", effect.id, ["issue", "edit", String(effect.id), "--add-assignee", effect.user]);
        case "close":
          // closing a closed issue is a success in gh, which keeps a replay harmless
          return edit("close", effect.id, ["issue", "close", String(effect.id)]);
      }
    },
  };
}
