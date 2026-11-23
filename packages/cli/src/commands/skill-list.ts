/**
 * `norn skill list`: every skill an agent in this repo can use, with when it applies and where it
 * comes from: the pack, the repo's `.agents/skills/` or a harness's own skills folder. The same lookup
 * doctor's unseen-skill warning checks against. Read only; outside a norn repo, the pack's alone.
 */
import type { SkillList, SkillListEntry } from "@norn/schema";
import { PACK_ALONE, readCatalog } from "../catalog.ts";
import { defineCommand } from "../command.ts";
import { rendered, tableCell } from "../output.ts";

const from = (s: SkillListEntry): string => (s.source === "pack" ? "pack" : s.source === "harness" ? `${s.harness} (${s.path})` : `repo (${s.path})`);

export const skillListCommand = defineCommand({
  name: "skill list",
  summary: "List every skill an agent in this repo can use, with when it applies and where it comes from",
  usage: "norn skill list",
  async run(ctx) {
    const c = await readCatalog(ctx);
    const value: SkillList = { repo: c.repo, skills: await c.skills() };
    const rows = value.skills.map((s) => `| \`${s.name}\` | ${tableCell(from(s))} | ${tableCell(s.use_when ?? s.description ?? "")} |`);
    const md = ["| Skill | From | Use when |", "| --- | --- | --- |", ...rows];
    if (c.repo === null) md.push("", PACK_ALONE);
    return rendered(value, md.join("\n"));
  },
});
