/**
 * The GitHub forge: pull requests and their checks through `gh`. It is never a state store: whether
 * a step finished is norn's record, never read back from a pull request's title, labels or body.
 */
import {
  type ChangeRequest,
  type ChecksReport,
  type ChecksSummary,
  type EffectMeta,
  fail,
  type Forge,
  type ForgeEffect,
  type ForgeEffectOutcome,
  type HostContext,
  ok,
  parseJson,
  type PluginResult,
  validateForgeEffect,
} from "@norn/plugin-api";
import type { Static, TSchema } from "@sinclair/typebox";
import type { GithubConfig } from "./config.ts";
import { classify } from "./failure.ts";
import { createGh, type Gh } from "./gh.ts";
import { hasMarker, isReceiptId, markersIn, withMarker } from "./marker.ts";
import { GhCheckRows, GhChecks, GhMergeable, GhPr, GhPrs, GhPrsByBranch, PR_FIELDS, toChange } from "./wire.ts";

/** How many branches one GraphQL query asks about: one alias each, well inside GitHub's query cost. */
export const BRANCHES_PER_QUERY = 50;

const PR_NODE = "number url title state isDraft headRefName headRefOid baseRefName mergedAt mergeCommit { oid }";

/**
 * One aliased `pullRequests(headRefName:)` per branch, newest first, every state. Branch names go in
 * as JSON string literals, which GraphQL reads the same way, so no branch name can break the query.
 */
export function changesQuery(branches: readonly string[]): string {
  const fields = branches.map((b, i) => `b${i}: pullRequests(headRefName: ${JSON.stringify(b)}, first: 1, orderBy: { field: CREATED_AT, direction: DESC }) { nodes { ${PR_NODE} } }`);
  return `query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { ${fields.join(" ")} } }`;
}

/**
 * `gh pr checks --json bucket` buckets (pass, fail, pending, skipping, cancel) folded into one: a
 * failed or cancelled check wins, then a pending one; no check at all is `none`.
 */
export function summarize(buckets: readonly string[]): ChecksSummary {
  if (buckets.length === 0) return "none";
  if (buckets.some((b) => b === "fail" || b === "cancel")) return "failure";
  if (buckets.some((b) => b === "pending")) return "pending";
  return "success";
}

const PR_URL = /\/pull\/(\d+)/;
/** the buckets of a check that failed or was cut short: neither may pass for green */
const FAILED: ReadonlySet<string> = new Set(["fail", "cancel"]);
const NO_CHECKS = /no checks reported/i;

type Outcome = PluginResult<ForgeEffectOutcome>;

export function createGithubForge(ctx: HostContext, config: GithubConfig): Forge {
  const gh: Gh = createGh(ctx, config);
  const done = (kind: ForgeEffect["kind"], change: ChangeRequest, replayed = false): Outcome => ok({ kind, change, replayed });
  const view = (id: number) => gh.json(GhPr, ["pr", "view", String(id), "--json", `${PR_FIELDS},body`]);

  /** `gh pr checks` rows with `fields`; an empty list when the pull request has no check at all. */
  async function checkRows<S extends TSchema>(id: number, fields: string, schema: S): Promise<PluginResult<Static<S>>> {
    const r = await gh.inRepoRaw(["pr", "checks", String(id), "--json", fields]);
    if (!r.ok) return r;
    const out = r.value;
    if (out.timedOut) return classify(out, "gh pr checks");
    // gh exits 8 while a check is pending and 1 when one failed, printing the JSON either way;
    // with no check at all it exits 1 saying so
    if (out.code !== 0 && NO_CHECKS.test(out.stderr)) return ok([] as Static<S>);
    const answered = out.code === 0 || ((out.code === 1 || out.code === 8) && out.stdout.trim() !== "");
    if (!answered) return classify(out, "gh pr checks");
    return parseJson(schema, out.stdout, "gh pr checks");
  }

  async function open(effect: Extract<ForgeEffect, { kind: "open" }>, receipt: string): Promise<Outcome> {
    // a branch's own pull requests are listed straight from the repository, never through search, which lags
    const ofHead = await gh.json(GhPrs, ["pr", "list", "--head", effect.head, "--state", "all", "--limit", "100", "--json", `${PR_FIELDS},body`]);
    if (!ofHead.ok) return ofHead;
    const seen = ofHead.value.find((p) => hasMarker(p.body, receipt));
    if (seen) return done("open", toChange(seen), true);
    const args = ["pr", "create", "--head", effect.head, "--base", effect.base, "--title", effect.title, "--body-file", "-", ...(effect.draft ? ["--draft"] : [])];
    const out = await gh.inRepo(args, withMarker(effect.body, receipt));
    if (!out.ok) return out;
    const m = PR_URL.exec(out.value);
    // the pull request may exist without its number reaching us; the marker lets the retry find it
    if (!m) return fail("unknown", `gh pr create: no pull request URL in its output: ${out.value.slice(0, 200)}`, true);
    const made = await view(Number(m[1]));
    if (!made.ok) return made;
    return done("open", toChange(made.value));
  }

  async function update(effect: Extract<ForgeEffect, { kind: "update" }>): Promise<Outcome> {
    const before = await view(effect.id);
    if (!before.ok) return before;
    const args = ["pr", "edit", String(effect.id)];
    if (effect.title !== undefined) args.push("--title", effect.title);
    let input: string | undefined;
    if (effect.body !== undefined) {
      // the open's marker stays, so that open performed again still finds this pull request
      input = [effect.body, ...markersIn(before.value.body)].filter((s) => s !== "").join("\n\n");
      args.push("--body-file", "-");
    }
    if (args.length === 3) return done("update", toChange(before.value));
    const out = await gh.inRepo(args, input);
    if (!out.ok) return out;
    return done("update", { ...toChange(before.value), ...(effect.title === undefined ? {} : { title: effect.title }) });
  }

  async function ready(effect: Extract<ForgeEffect, { kind: "ready" }>): Promise<Outcome> {
    const before = await view(effect.id);
    if (!before.ok) return before;
    const change = toChange(before.value);
    if (!change.draft) return done("ready", change);
    const out = await gh.inRepo(["pr", "ready", String(effect.id)]);
    if (!out.ok) return out;
    return done("ready", { ...change, draft: false });
  }

  return {
    name: "github",
    capabilities: { draft: true, checks: true, raw_urls: true },

    async findChanges(branches) {
      const found: Record<string, ChangeRequest | null> = {};
      const unique = [...new Set(branches)];
      if (unique.length === 0) return ok(found);
      const repo = await gh.repo();
      if (!repo.ok) return repo;
      const [owner, name] = repo.value.split("/") as [string, string];
      for (let at = 0; at < unique.length; at += BRANCHES_PER_QUERY) {
        const chunk = unique.slice(at, at + BRANCHES_PER_QUERY);
        // run, not inRepo: `gh api` has no -R and refuses one; the repository goes in as variables.
        // -f, not -F: -F would turn an all-digit owner into a number and break the query's String type
        const out = await gh.run(["api", "graphql", "-f", `owner=${owner}`, "-f", `name=${name}`, "-f", `query=${changesQuery(chunk)}`]);
        if (!out.ok) return out;
        const answer = parseJson(GhPrsByBranch, out.value, "gh api graphql");
        if (!answer.ok) return answer;
        const repository = answer.value.data.repository;
        if (repository === null) return fail("not_found", `github forge: no repository ${repo.value}`);
        chunk.forEach((b, i) => {
          const node = repository[`b${i}`]?.nodes[0];
          found[b] = node ? toChange(node) : null;
        });
      }
      return ok(found);
    },

    async checks(id) {
      const rows = await checkRows(id, "bucket", GhChecks);
      if (!rows.ok) return rows;
      return ok(summarize(rows.value.map((c) => c.bucket)));
    },

    async checkReport(id) {
      const rows = await checkRows(id, "name,bucket,link", GhCheckRows);
      if (!rows.ok) return rows;
      const summary = summarize(rows.value.map((c) => c.bucket));
      const failed = rows.value.filter((c) => FAILED.has(c.bucket)).map((c) => ({ name: c.name || "check", ...(c.link ? { url: c.link } : {}) }));
      const report: ChecksReport = { summary, failed: summary === "failure" ? failed : [] };
      if (summary === "success" || summary === "failure") return ok(report);
      // GitHub starts no check run on a pull request that conflicts with its base: unsettled checks then never settle
      const m = await gh.json(GhMergeable, ["pr", "view", String(id), "--json", "mergeable"]);
      if (!m.ok) return m;
      const state = m.value.mergeable.toUpperCase();
      return ok(state === "UNKNOWN" ? report : { ...report, conflicts: state === "CONFLICTING" });
    },

    async perform(effect: ForgeEffect, meta: EffectMeta): Promise<Outcome> {
      const valid = validateForgeEffect(effect);
      if (!valid.ok) return fail("invalid", `github forge: malformed effect: ${valid.errors.map((e) => `${e.path || "/"} ${e.message}`).join("; ")}`);
      if (!isReceiptId(meta.receipt_id)) return fail("invalid", `github forge: receipt id ${JSON.stringify(meta.receipt_id)} cannot be carried in a marker`);
      switch (effect.kind) {
        case "open":
          return open(effect, meta.receipt_id);
        case "update":
          return update(effect);
        case "ready":
          return ready(effect);
      }
    },
  };
}
