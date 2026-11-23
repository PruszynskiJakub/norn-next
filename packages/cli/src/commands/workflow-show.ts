/**
 * `norn workflow show <name>`: one workflow as norn runs it, a repo override included: its steps with
 * their outcomes and where each leads, the counters with their maximums, the gates and each step's
 * skills. `--mermaid` prints its graph as docs/workflows.md draws it, and takes no `--json`, since the
 * graph is text. Read only; outside a norn repo, the pack's.
 */
import { PACK_ALONE, readCatalog, shownWorkflow, workflowShow } from "../catalog.ts";
import { defineCommand, opt } from "../command.ts";
import { raw, rendered, usageError } from "../output.ts";
import { workflowMermaid } from "../workflows-page.ts";

const SOURCE = { pack: "the pack", repo: "the repo", "replaces-pack": "the repo, replacing the pack's" } as const;

export const workflowShowCommand = defineCommand({
  name: "workflow show",
  summary: "Show a workflow as norn runs it: steps, outcomes, counters, gates and skills, or its graph",
  usage: "norn workflow show <name> [--mermaid]",
  options: { mermaid: { type: "boolean" } },
  optionHelp: { "--mermaid": "print the workflow's Mermaid graph, as docs/workflows.md draws it, instead (no --json)" },
  positionals: { min: 1, max: 1 },
  async run(ctx, args) {
    const name = args.positionals[0] as string;
    const mermaid = opt.bool(args, "mermaid");
    if (mermaid && args.json) throw usageError("--mermaid prints the graph as text and takes no --json", `norn workflow show ${name} --json, or norn workflow show ${name} --mermaid`);
    const c = await readCatalog(ctx);
    const { entry, workflow } = shownWorkflow(c, name);
    if (mermaid) return raw(`${workflowMermaid(workflow)}\n`, 0);
    const value = workflowShow(c, entry, workflow);
    const max = new Map(value.counters.map((k) => [k.name, k.max]));
    const md = [`# Workflow \`${name}\``, "", `From ${SOURCE[entry.source]}${entry.file ? ` (${entry.file})` : ""}.`];
    if (entry.state === "held") md.push(`Held for the person's confirmation (${(entry.changes ?? []).join("; ")}): shown as it runs once confirmed with ${entry.confirm}.`);
    md.push("");
    if (value.when) md.push(`When: ${value.when}`, "");
    if (value.description) md.push(value.description, "");
    md.push(`Starts at \`${value.start}\`.`, "", "## Steps", "");
    for (const s of value.steps) {
      const kind = s.role ? `${s.kind} · ${s.role}` : s.kind;
      md.push(`- \`${s.name}\` (${kind})${s.skills.length ? `, skills: ${s.skills.join(", ")}` : ""}`);
      for (const o of s.outcomes) md.push(`  - ${o.outcome} → \`${o.to}\`${o.counter ? ` ⟳${o.counter}≤${max.get(o.counter) ?? "?"}` : ""}`);
    }
    md.push("", "## Counters", "", ...(value.counters.length ? value.counters.map((k) => `- \`${k.name}\` ≤${k.max}${k.reset_on.length ? `, reset on ${k.reset_on.join(", ")}` : ""}`) : ["None."]));
    md.push("", "## Gates", "", ...(value.gates.length ? value.gates.map((g) => `- \`${g}\``) : ["None."]));
    if (c.repo === null) md.push("", PACK_ALONE);
    return rendered(value, md.join("\n"));
  },
});
