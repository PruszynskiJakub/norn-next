/**
 * `norn story create <title> [--body <text>] [--workflow <name>]`: create an item on the configured tracker.
 * The item is made the way intake takes it in: the intake label, the intake assignee, and the
 * workflow label when one is named, so the next tick starts it as a story. The labels are defined on
 * the tracker first, so a repository that never had them takes the item.
 */
import { ulid } from "@norn/schema";
import { defineCommand, opt } from "../command.ts";
import { ensureLabels, intakeLabel, workflowLabel } from "../labels.ts";
import { failure, refuse, rendered, usageError } from "../output.ts";

export const storyCreateCommand = defineCommand({
  name: "story create",
  acts: true,
  summary: "Create an item on the configured tracker (a GitHub issue, a local markdown file) with the intake label, so the next tick takes it in",
  usage: "norn story create <title> [--body <text>] [--workflow <name>]",
  options: {
    body: { type: "string" },
    workflow: { type: "string" },
  },
  optionHelp: {
    "--body <text>": "the item's body",
    "--workflow <name>": "the workflow the story takes at intake",
  },
  positionals: { min: 1, max: 1 },
  restJoined: true,
  async run(ctx, args) {
    const title = (args.positionals[0] as string).trim();
    if (!title) throw usageError("an empty title", 'norn story create "<title>"');
    const env = await ctx.runtimeEnv();
    const tracker = env.slots.tracker;
    if (!tracker.capabilities.create) throw refuse(`the ${tracker.name} tracker cannot create an item`, "create the item where the tracker keeps it, with the intake label", "unsupported");
    const workflow = opt.str(args, "workflow");
    if (workflow !== undefined && env.workflows[workflow]?.ok !== true) {
      const loading = Object.entries(env.workflows).flatMap(([name, w]) => (w.ok ? [name] : []));
      throw refuse(`no workflow ${workflow} loads`, `name one of ${loading.sort().join(", ")}`, "unknown_workflow");
    }
    const defined = [intakeLabel(env), ...(workflow ? [workflowLabel(env, workflow)] : [])];
    const labels = defined.map((l) => l.name);
    let assignee: string | undefined;
    if (env.config.intake.assignee === "me") {
      const me = await tracker.whoami();
      if (!me.ok) throw failure(`cannot tell who you are to the ${tracker.name} tracker: ${me.failure.message}`, "norn doctor", me.failure.code);
      assignee = me.value;
    } else if (env.config.intake.assignee !== null) assignee = env.config.intake.assignee;
    await ensureLabels(env, defined);
    // a person's create has no record to replay from; a retry makes a second item, as typing it twice would
    const made = await tracker.perform(
      { kind: "create", title, body: opt.str(args, "body") ?? "", labels, ...(assignee !== undefined && { assignee }) },
      { receipt_id: `create-${ulid()}` },
    );
    if (!made.ok) throw failure(`cannot create the item: ${made.failure.message}`, "norn doctor", made.failure.code);
    const value = { key: made.value.key ?? null, id: made.value.id ?? null, title, labels, ...(assignee !== undefined && { assignee }), ...(made.value.url && { url: made.value.url }) };
    return rendered(value, `Created ${value.key ?? "the item"}: ${title}. The next tick takes it in.`);
  },
});
