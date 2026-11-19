/**
 * `norn status`: show every story and unit, read-only. Units waiting for a person come first, as the
 * list of what needs doing, after any story whose run data here and on the remote diverged; then the rest of the stories, and the intake a tick has not taken yet.
 * A finished story (every unit ended done, nothing waiting on its record) is one line under Finished
 * while its item is open, and leaves the markdown once the item closed; `--json` lists every story.
 *
 * `--watch [--interval 5s] [--pane]`: the live cockpit in the terminal (`cockpit/watch.ts`), `--json`
 * prints its model once, `--pane` opens it in a pane below this one. `--segment [--ttl 30s]`: one
 * plain line for herdr's tab bar, read from this machine's record alone, and inside herdr each story's
 * `$norn` sidebar token; outside a norn repo an empty line, and never a refusal for herdr to show.
 */
import type { RuntimeEnv } from "@norn/runtime";
import { insideHerdr, labelStories } from "../cockpit/labels.ts";
import { finished } from "../cockpit/groups.ts";
import { cockpitModel } from "../cockpit/model.ts";
import { segmentLine } from "../cockpit/segment.ts";
import { openCockpitPane, placesOf, watchCockpit } from "../cockpit/watch.ts";
import { defineCommand, opt, type ParsedArgs } from "../command.ts";
import { durationMs } from "../config/derive.ts";
import { Duration } from "../config/schema.ts";
import type { CliContext } from "../context.ts";
import { gateNotes, type OpenNote } from "../notes.ts";
import { rendered, toFailure, usageError } from "../output.ts";
import { loadProjectView, type ProjectView, storyHead, type StoryView, unitLine, type UnitView } from "../views.ts";

const DURATION = new RegExp(Duration.pattern as string);

function duration(args: ParsedArgs, flag: "interval" | "ttl", fallback: string): number {
  const raw = opt.str(args, flag) ?? fallback;
  if (!DURATION.test(raw)) throw usageError(`--${flag} must be a duration such as ${fallback}, not ${JSON.stringify(raw)}`, `norn status ${flag === "ttl" ? "--segment" : "--watch"} --${flag} ${fallback}`);
  return durationMs(raw);
}

async function segment(ctx: CliContext, args: ParsedArgs) {
  const ttl = duration(args, "ttl", "30s");
  let env: RuntimeEnv;
  try {
    env = await ctx.runtimeEnv();
  } catch {
    // the focused pane is outside a norn repo: herdr shows nothing rather than an error
    return rendered({ segment: "", repo: null }, "");
  }
  const repo = env.ctx.repo.root;
  try {
    const view = await loadProjectView(env, { local: true });
    const line = segmentLine(view, repo);
    const labels = insideHerdr(ctx.env) ? await labelStories(env, view, ttl) : 0;
    return rendered({ segment: line, repo, labels }, line);
  } catch (e) {
    const line = `norn ! ${toFailure(e).body.error.split("\n")[0]}`;
    return rendered({ segment: line, repo }, line);
  }
}

async function watch(ctx: CliContext, args: ParsedArgs) {
  const interval = duration(args, "interval", "5s");
  const env = await ctx.runtimeEnv();
  if (opt.bool(args, "pane")) return openCockpitPane(ctx, env, args);
  if (args.json) {
    const view = await loadProjectView(env);
    const notes: OpenNote[] = [];
    for (const s of view.stories) notes.push(...(await gateNotes(env, s)));
    return cockpitModel(view, { repo: env.ctx.repo.root, places: placesOf(env), notes });
  }
  return watchCockpit(ctx, env, interval);
}

/** A gate's line names the notes still open on its unit, which a person reads before approving. */
function needsLine(s: StoryView, u: UnitView, notes: readonly OpenNote[]): string {
  const n = notes.filter((x) => x.unit === u.id).length;
  return `- ${unitLine(u)}${n > 0 ? ` (${n} open note${n === 1 ? "" : "s"}: norn story view ${s.key})` : ""}`;
}

function markdown(v: ProjectView, notes: readonly OpenNote[]): string {
  const out = ["# norn status", ""];
  const waiting = v.stories.flatMap((s) => s.units.filter((u) => u.waiting).map((u) => ({ s, u })));
  const unsynced = v.stories.filter((s) => s.unsynced?.waiting);
  if (waiting.length || unsynced.length)
    out.push("## Needs you", "", ...unsynced.map((s) => `- ${s.key}: run data unsynced: ${s.unsynced?.text} → ${s.unsynced?.next}`), ...waiting.map(({ s, u }) => needsLine(s, u, notes)), "");
  const done = v.stories.filter(finished);
  const going = v.stories.filter((s) => !finished(s));
  out.push("## Stories", "");
  if (going.length === 0) out.push(done.length === 0 ? "No stories yet." : "None in progress.");
  for (const s of going) out.push(`- ${storyHead(s)}`, ...s.units.map((u) => `  - ${unitLine(u)}`));
  const shown = done.filter((s) => s.open !== false);
  if (shown.length) out.push("", "## Finished", "", ...shown.map((s) => `- ${storyHead(s)}`));
  if (v.intake.length) out.push("", "## Intake", "", ...v.intake.map((i) => `- ${i.key} ${i.title}`));
  if (v.problems.length) out.push("", "## Problems", "", ...v.problems.map((p) => `- ${p}`));
  return out.join("\n");
}

export const statusCommand = defineCommand({
  name: "status",
  summary: "Show every story and unit, read-only; --watch: the live cockpit; --segment: one line for herdr's tab bar",
  usage: "norn status | norn status --watch [--interval 5s] [--pane] | norn status --segment [--ttl 30s]",
  options: {
    watch: { type: "boolean" },
    interval: { type: "string" },
    pane: { type: "boolean" },
    segment: { type: "boolean" },
    ttl: { type: "string" },
  },
  optionHelp: {
    "--watch": "the live cockpit: what needs you and every story, acted on by key; q or Esc quits",
    "--interval <duration>": "with --watch: how often it reads the stories again (default 5s)",
    "--pane": "with --watch: open it in a herdr pane below this one, leaving the focus here",
    "--segment": "one line for herdr's tab bar, empty outside a norn repo; inside herdr also each story's $norn sidebar token",
    "--ttl <duration>": "with --segment: how long a sidebar token stays without the next segment (default 30s)",
  },
  async run(ctx, args) {
    const given = (["watch", "interval", "pane", "segment", "ttl"] as const).filter((o) => args.values[o] !== undefined);
    // a flag of the other mode would be dropped without a word
    const clash = given.includes("segment") ? given.find((o) => o === "watch" || o === "interval" || o === "pane") : given.includes("watch") && given.includes("ttl") ? "ttl" : undefined;
    if (clash) throw usageError(`--${clash} does not go with --${clash === "ttl" ? "watch" : "segment"}`, "norn status --watch [--interval 5s] [--pane], or norn status --segment [--ttl 30s]");
    if (opt.bool(args, "segment")) return segment(ctx, args);
    if (opt.bool(args, "watch")) return watch(ctx, args);
    const stray = (["interval", "pane", "ttl"] as const).find((o) => args.values[o] !== undefined);
    if (stray) throw usageError(`--${stray} needs ${stray === "ttl" ? "--segment" : "--watch"}`, stray === "ttl" ? "norn status --segment" : "norn status --watch");
    const env = await ctx.runtimeEnv();
    const view = await loadProjectView(env);
    const notes: OpenNote[] = [];
    for (const s of view.stories) notes.push(...(await gateNotes(env, s)));
    return rendered({ ...view, notes }, markdown(view, notes));
  },
});
