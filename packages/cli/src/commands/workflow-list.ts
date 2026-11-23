/**
 * `norn workflow list`: every workflow this repo can start, with when to pick it and where it comes
 * from, a held one with what confirms it. Read only; outside a norn repo, the pack's alone.
 */
import type { WorkflowList, WorkflowListEntry } from "@norn/schema";
import { PACK_ALONE, readCatalog, workflowEntries } from "../catalog.ts";
import { defineCommand } from "../command.ts";
import { rendered, tableCell } from "../output.ts";

const SOURCE: Record<WorkflowListEntry["source"], string> = { pack: "pack", repo: "repo", "replaces-pack": "replaces pack" };

function state(w: WorkflowListEntry): string {
  if (w.state === "held") return `held: ${w.confirm} (${(w.changes ?? []).join("; ")})`;
  if (w.state === "invalid") return `invalid: ${w.problem}`;
  return "ok";
}

export const workflowListCommand = defineCommand({
  name: "workflow list",
  summary: "List every workflow this repo can start, with when to pick it and where it comes from",
  usage: "norn workflow list",
  async run(ctx) {
    const c = await readCatalog(ctx);
    const value: WorkflowList = { repo: c.repo, workflows: workflowEntries(c) };
    const rows = value.workflows.map((w) => `| \`${w.name}\` | ${SOURCE[w.source]}${w.file ? ` (${w.file})` : ""} | ${tableCell(state(w))} | ${tableCell(w.when ?? w.description ?? "")} |`);
    const md = ["| Workflow | Source | State | When |", "| --- | --- | --- | --- |", ...rows, "", c.repo === null ? PACK_ALONE : "Read one with norn workflow show <name>."];
    return rendered(value, md.join("\n"));
  },
});
