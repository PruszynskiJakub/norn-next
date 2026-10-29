/**
 * decide (H3): `(facts, repo workflows, config) → Decision[]`, pure and deterministic.
 * At most one action per unit per tick; every decision records the rule that fired (O5).
 * Ids come from `deriveUlid(facts.tick_id, i)` and times from `facts.now`, so `norn why`
 * replays to identical output.
 *
 * Order per story: claim (T3–T6; a due renewal is a side action, R1.1) → corrupt (S2) → remote
 * lifecycle (GR6–GR8) → mailbox (T9),
 * then per unit: receipts (C2: receipts always win over runner facts) → workflow drift (S7)
 * → recovery commit → step semantics by type (§6, §10, W2). Ready steps are served in
 * queue order (K1): oldest story by intake, then slice number.
 */
import {
  type ResolvedConfig,
  slugify,
  specDir,
  type StoryFrontmatter,
  storyBranch,
  storyKey,
  type Workflow,
} from "@norn/schema";
import type { Decision } from "../actions.ts";
import { storyWorktreePath } from "../commands.ts";
import type { Facts, StoryFacts } from "../facts.ts";
import { sha256 } from "../hash.ts";
import { epoch } from "../time.ts";
import type { WorkflowIssue } from "../workflow.ts";
import { commitFor, Ctx, isSideAction } from "./receipts.ts";
import { decideStory } from "./story.ts";

export { LAUNCH_PROMPT_MS } from "./agent.ts";
export { isSideAction } from "./receipts.ts";

/** A repo workflow as loaded by the caller: parsed + validated (W5) with the exact file text. */
export interface LoadedWorkflow {
  name: string;
  /** null when the file failed schema validation */
  workflow: Workflow | null;
  /** exact file text, pinned verbatim at unit start (S7) */
  source: string;
  /** validateWorkflowDefinition issues (incl. skills); non-empty = refused (W5) */
  issues: WorkflowIssue[];
}
export type RepoWorkflows = Readonly<Record<string, LoadedWorkflow>>;

/** W9: the issue label that picks a story's workflow at intake (`norn:wf:<name>`). */
export const WF_LABEL = "norn:wf:";

/** The decision that is the unit's one action this tick (O5), else its side action, else null. */
export function unitDecision<D extends { unit: string; action: { kind: string; op?: unknown } }>(decisions: readonly D[], unit: string, unitOf: (d: D) => string = (d) => d.unit): D | null {
  const mine = decisions.filter((d) => unitOf(d) === unit);
  return mine.find((d) => !isSideAction(d.action)) ?? mine[0] ?? null;
}

export function decide(facts: Facts, workflows: RepoWorkflows, config: ResolvedConfig): Decision[] {
  const ctx = new Ctx(facts, workflows, config);
  const deadFiles = facts.machine.dead_lease_files ?? [];
  if (deadFiles.length) ctx.emit({ kind: "reclaim_leases", unit: null, rule: "leases.reclaim", files: [...deadFiles] });
  for (const story of queueOrder(facts.stories)) decideStory(ctx, story);
  intake(ctx);
  return ctx.decisions;
}

/** K1: oldest story by intake first (unknown intake last), then key. */
function queueOrder(stories: readonly StoryFacts[]): StoryFacts[] {
  const at = (s: StoryFacts) => (s.frontmatter ? epoch(s.frontmatter.intake_at) : Number.POSITIVE_INFINITY);
  return [...stories].sort((a, b) => at(a) - at(b) || a.key.localeCompare(b.key));
}

// ================================================================= repo level

function intake(ctx: Ctx): void {
  const { facts, config } = ctx;
  if (!facts.remote.issues) return;
  const known = new Set(facts.stories.map((s) => s.key));
  for (const issue of facts.remote.issues) {
    const provider = issue.provider;
    const key = storyKey(provider, issue.number);
    if (known.has(key) || issue.state !== "open") continue;
    const slug = slugify(issue.title);
    const branch = storyBranch(key, slug);
    const path = storyWorktreePath(facts.repo.root, key, slug);
    const labelled = issue.labels.find((l) => l.startsWith(WF_LABEL))?.slice(WF_LABEL.length);
    const workflow = labelled && ctx.workflows[labelled] ? labelled : config.default_workflow;
    const frontmatter: StoryFrontmatter = {
      id: key,
      slug,
      provider,
      number: issue.number,
      url: issue.url,
      title: issue.title,
      assignee: issue.assignees[0] ?? null,
      labels: [...issue.labels].sort(),
      workflow,
      status: "new",
      intake_at: ctx.nowIso,
      body_hash: sha256(issue.body),
    };
    const slot = ctx.slot();
    ctx.emit({
      kind: "intake_story",
      unit: null,
      rule: "remote.intake",
      issue,
      key,
      slug,
      worktree: { path, branch, from: facts.repo.default_branch, env: ctx.slotEnv(slot), slot },
      story_file: `${specDir(key, slug)}/story.md`,
      frontmatter,
      body: issue.body,
      commit: commitFor(ctx, key, null, `norn: intake ${key} ${issue.title}`, null, { path, branch, slice: null, push: false }),
    });
  }
}
