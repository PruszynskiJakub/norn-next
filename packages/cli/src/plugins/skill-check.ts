/**
 * Whether every skill a repo workflow's agent steps name can be found: the brief tells the agent to
 * use each by name, and one that is nowhere sends it looking for nothing. A skill is found when the
 * pack ships it or the repo keeps a folder of that name holding a `SKILL.md`, in `.agents/skills/` or
 * a harness's own skills folder. Only the repo's workflows are checked: a pack's are its plugin's to
 * keep whole, with their own tests.
 */
import { repoFileOf, type RuntimeEnv, SKILLS_DIR } from "@norn/runtime";
import { type CliFailure, refuse } from "../output.ts";

interface Missing {
  file: string;
  step: string;
  skill: string;
}

export async function skillFailure(env: RuntimeEnv): Promise<CliFailure | null> {
  const dirs = [...new Set([SKILLS_DIR, ...Object.values(env.slots.executors).map((h) => h.skillsDir ?? SKILLS_DIR)])];
  const found = new Map<string, boolean>();
  const exists = async (skill: string): Promise<boolean> => {
    if (env.slots.pack.skills[skill] !== undefined) return true;
    if (!found.has(skill)) {
      let there = false;
      for (const dir of dirs) if ((await env.ctx.files.read(`${env.ctx.repo.root}/${dir}/${skill}/SKILL.md`)) !== null) there = true;
      found.set(skill, there);
    }
    return found.get(skill) === true;
  };
  const missing: Missing[] = [];
  for (const [name, load] of Object.entries(env.workflows)) {
    const file = repoFileOf(env.repoWorkflows, name, "workflow");
    if (!load.ok || file === null) continue;
    for (const step of Object.values(load.workflow.graph.steps))
      for (const skill of step.agent?.skills ?? []) if (!(await exists(skill))) missing.push({ file, step: step.name, skill });
  }
  if (missing.length === 0) return null;
  const files = [...new Set(missing.map((m) => m.file))];
  const skills = [...new Set(missing.map((m) => m.skill))];
  const what = files.map((f) => `${f} names a skill neither the pack nor ${SKILLS_DIR}/ has: ${missing.filter((m) => m.file === f).map((m) => `${m.skill} (step ${m.step})`).join(", ")}`).join("; ");
  return refuse(what, `write ${skills.map((s) => `${SKILLS_DIR}/${s}/SKILL.md`).join(", ")}, or take ${skills.length === 1 ? "it" : "them"} out of ${files.join(", ")}`, "unknown_skill", {
    files,
    skills,
  });
}
